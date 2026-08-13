import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { put } from "@vercel/blob";
import {
  parseRfhInvoicePdf,
  parseRfhDate,
} from "@/features/fust/lib/rfh-invoice-parser";
import { logFustEvent } from "@/lib/fust-audit";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth(["admin", "finance"]);
  if (error) return error;
  void session;

  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const companyId = params.get("companyId");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (status && status !== "all") {
    where.status = status;
  }
  if (companyId) {
    where.companyId = companyId;
  }

  const invoices = await prisma.rfhInvoice.findMany({
    where,
    include: {
      company: { select: { id: true, name: true, slug: true } },
      allocations: { select: { id: true, voucherNumber: true, supplierId: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { invoiceDate: "desc" },
  });

  // Enrich with voucher/allocation counts
  const enriched = invoices.map((inv) => {
    const voucherCount = inv.allocations.length;
    const allocatedCount = inv.allocations.filter(
      (a) => a.supplierId !== null
    ).length;
    return {
      ...inv,
      voucherCount,
      allocatedCount,
    };
  });

  return NextResponse.json(enriched);
}

export async function POST(request: NextRequest) {
  const { error, session } = await requireAuth(["admin", "finance"]);
  if (error) return error;

  // Parse multipart form data
  const formData = await request.formData();
  const file = formData.get("file") as File;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.type !== "application/pdf") {
    return NextResponse.json(
      { error: "Only PDF files are accepted" },
      { status: 400 }
    );
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Parse the PDF
  let parsed;
  try {
    parsed = await parseRfhInvoicePdf(buffer);
  } catch (err) {
    console.error("[RfhInvoice] PDF parse error:", err);
    return NextResponse.json(
      { error: "Failed to parse PDF" },
      { status: 422 }
    );
  }

  // Validate required fields were extracted
  if (!parsed.invoiceNumber) {
    return NextResponse.json(
      { error: "Could not extract invoice number (Nummer) from PDF" },
      { status: 422 }
    );
  }
  if (!parsed.rfhInvoiceNumber) {
    return NextResponse.json(
      {
        error:
          "Could not extract RFH invoice number (Factuurnummer) from PDF",
      },
      { status: 422 }
    );
  }

  // Duplicate check
  const existing = await prisma.rfhInvoice.findFirst({
    where: {
      OR: [
        { invoiceNumber: parsed.invoiceNumber },
        { rfhInvoiceNumber: parsed.rfhInvoiceNumber },
      ],
    },
    select: { id: true, invoiceNumber: true, rfhInvoiceNumber: true },
  });
  if (existing) {
    return NextResponse.json(
      {
        error: `Invoice already exists (${existing.rfhInvoiceNumber})`,
        existingId: existing.id,
      },
      { status: 409 }
    );
  }

  // Match company by first word of parsed company name
  let companyId: string | null = null;
  if (parsed.companyName) {
    const firstWord = parsed.companyName.split(/\s+/)[0];
    if (firstWord) {
      const company = await prisma.company.findFirst({
        where: { name: { contains: firstWord, mode: "insensitive" } },
        select: { id: true },
      });
      if (company) {
        companyId = company.id;
      }
    }
  }

  // Upload PDF to Vercel Blob
  const blob = await put(
    `rfh-invoices/${parsed.rfhInvoiceNumber}.pdf`,
    buffer,
    { access: "public", contentType: "application/pdf" }
  );

  // Parse invoice date
  const invoiceDate = parsed.invoiceDate
    ? parseRfhDate(parsed.invoiceDate)
    : null;
  if (!invoiceDate) {
    return NextResponse.json(
      { error: "Could not parse invoice date from PDF" },
      { status: 422 }
    );
  }

  // Collect distinct voucher numbers from parsed lines
  const voucherNumbers = [
    ...new Set(parsed.lines.map((l) => l.voucherNumber)),
  ];

  // Find matching issuance vouchers by transaction number
  const matchedVouchers = voucherNumbers.length > 0
    ? await prisma.fustIssuanceVoucher.findMany({
        where: { transactionNumber: { in: voucherNumbers } },
        select: { id: true, transactionNumber: true },
      })
    : [];
  const voucherMap = new Map(
    matchedVouchers.map((v) => [v.transactionNumber, v.id])
  );

  // Create RfhInvoice + lines + allocations in a transaction
  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.rfhInvoice.create({
      data: {
        invoiceNumber: parsed.invoiceNumber!,
        rfhInvoiceNumber: parsed.rfhInvoiceNumber!,
        invoiceDate,
        companyId,
        totalStatiegeld: parsed.totalStatiegeld ?? 0,
        totalFusthuur: parsed.totalFusthuur ?? 0,
        pdfUrl: blob.url,
        status: "open",
        lines: {
          create: parsed.lines.map((line) => ({
            date: parseRfhDate(line.date) ?? invoiceDate,
            fustCode: line.fustCode,
            description: line.description,
            transactionType: line.transactionType,
            location: line.location,
            voucherNumber: line.voucherNumber,
            quantity: line.quantity,
            statiegeldPrice: line.statiegeldPrice,
            statiegeldAmount: line.statiegeldAmount,
            fusthuurPrice: line.fusthuurPrice,
            fusthuurAmount: line.fusthuurAmount,
            vatCode: line.vatCode,
          })),
        },
        allocations: {
          create: voucherNumbers.map((vn) => ({
            voucherNumber: vn,
            voucherId: voucherMap.get(vn) ?? null,
          })),
        },
      },
      include: {
        company: { select: { id: true, name: true, slug: true } },
        allocations: {
          select: { id: true, voucherNumber: true, supplierId: true },
        },
        _count: { select: { lines: true } },
      },
    });

    return created;
  });

  // Audit log
  await logFustEvent({
    entityType: "rfh_invoice",
    entityId: invoice.id,
    action: "rfh_invoice_imported",
    actorId: session!.user.id,
    actorName: session!.user.name,
    metadata: {
      invoiceNumber: parsed.invoiceNumber,
      rfhInvoiceNumber: parsed.rfhInvoiceNumber,
      lineCount: parsed.lines.length,
      voucherCount: voucherNumbers.length,
      matchedVoucherCount: matchedVouchers.length,
    },
  });

  return NextResponse.json(invoice, { status: 201 });
}
