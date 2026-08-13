import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { put } from "@vercel/blob";
import {
  parseRfhInvoicePdf,
  parseRfhDate,
} from "@/features/fust/lib/rfh-invoice-parser";
import { logFustEvent } from "@/lib/fust-audit";
import { z } from "zod";

const importEmailSchema = z.object({
  subject: z.string(),
  from: z.string().optional(),
  receivedDateTime: z.string().optional(),
  attachments: z.array(
    z.object({
      name: z.string(),
      contentType: z.string(),
      contentBytes: z.string(), // base64
    })
  ),
});

interface AttachmentResult {
  filename: string;
  success: boolean;
  invoiceId?: string;
  rfhInvoiceNumber?: string;
  error?: string;
}

export async function POST(request: NextRequest) {
  // API key auth
  const apiKey = process.env.IMPORT_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Import API key not configured" },
      { status: 500 }
    );
  }
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "") ?? "";
  if (token !== apiKey) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  // Parse and validate body
  const rawBody = await request.json();
  const validation = importEmailSchema.safeParse(rawBody);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const { subject, from, receivedDateTime, attachments } = validation.data;

  // Filter PDF attachments (by contentType or .pdf extension)
  const pdfAttachments = attachments.filter(
    (a) =>
      a.contentType === "application/pdf" ||
      a.name.toLowerCase().endsWith(".pdf")
  );

  if (pdfAttachments.length === 0) {
    return NextResponse.json(
      { error: "No PDF attachments found in email", subject, from },
      { status: 422 }
    );
  }

  // Pre-fetch companies and vouchers for matching (shared across attachments)
  const companies = await prisma.company.findMany({
    select: { id: true, name: true },
  });

  const results: AttachmentResult[] = [];

  for (const attachment of pdfAttachments) {
    try {
      const result = await processAttachment(attachment, {
        subject,
        from,
        receivedDateTime,
        companies,
      });
      results.push(result);
    } catch (err) {
      results.push({
        filename: attachment.name,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const allSuccess = results.every((r) => r.success);
  const anySuccess = results.some((r) => r.success);
  const status = allSuccess ? 201 : anySuccess ? 207 : 422;

  return NextResponse.json(
    {
      subject,
      from,
      receivedDateTime,
      attachmentCount: pdfAttachments.length,
      results,
    },
    { status }
  );
}

async function processAttachment(
  attachment: { name: string; contentType: string; contentBytes: string },
  context: {
    subject: string;
    from?: string;
    receivedDateTime?: string;
    companies: { id: string; name: string }[];
  }
): Promise<AttachmentResult> {
  const { name: filename, contentBytes } = attachment;

  // 1. Decode base64 to Buffer
  const buffer = Buffer.from(contentBytes, "base64");

  // 2. Parse PDF
  let parsed;
  try {
    parsed = await parseRfhInvoicePdf(buffer);
  } catch (err) {
    return {
      filename,
      success: false,
      error: `PDF parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 3. Skip if invoiceNumber or rfhInvoiceNumber not extracted
  if (!parsed.invoiceNumber) {
    return {
      filename,
      success: false,
      error: "Could not extract invoice number (Nummer) from PDF",
    };
  }
  if (!parsed.rfhInvoiceNumber) {
    return {
      filename,
      success: false,
      error:
        "Could not extract RFH invoice number (Factuurnummer) from PDF",
    };
  }

  // 4. Duplicate check (both invoiceNumber and rfhInvoiceNumber)
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
    return {
      filename,
      success: false,
      error: `Invoice already exists (${existing.rfhInvoiceNumber})`,
      invoiceId: existing.id,
      rfhInvoiceNumber: existing.rfhInvoiceNumber,
    };
  }

  // 5. Match company by name (case-insensitive contains on first word)
  let companyId: string | null = null;
  if (parsed.companyName) {
    const firstWord = parsed.companyName.split(/\s+/)[0];
    if (firstWord) {
      const match = context.companies.find((c) =>
        c.name.toLowerCase().includes(firstWord.toLowerCase())
      );
      if (match) {
        companyId = match.id;
      }
    }
  }

  // 6. Upload PDF to Vercel Blob
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
    return {
      filename,
      success: false,
      error: "Could not parse invoice date from PDF",
    };
  }

  // 7. Collect distinct voucher numbers and match against FustIssuanceVoucher
  const voucherNumbers = [
    ...new Set(parsed.lines.map((l) => l.voucherNumber)),
  ];

  const matchedVouchers =
    voucherNumbers.length > 0
      ? await prisma.fustIssuanceVoucher.findMany({
          where: { transactionNumber: { in: voucherNumbers } },
          select: { id: true, transactionNumber: true },
        })
      : [];
  const voucherMap = new Map(
    matchedVouchers.map((v) => [v.transactionNumber, v.id])
  );

  // 8. Create RfhInvoice + lines + allocations in $transaction
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
      select: { id: true, rfhInvoiceNumber: true },
    });

    return created;
  });

  // 9. Audit log (no actor -- system import)
  await logFustEvent({
    entityType: "rfh_invoice",
    entityId: invoice.id,
    action: "rfh_invoice_imported",
    metadata: {
      source: "email",
      filename,
      invoiceNumber: parsed.invoiceNumber,
      rfhInvoiceNumber: parsed.rfhInvoiceNumber,
      lineCount: parsed.lines.length,
      voucherCount: voucherNumbers.length,
      matchedVoucherCount: matchedVouchers.length,
    },
  });

  return {
    filename,
    success: true,
    invoiceId: invoice.id,
    rfhInvoiceNumber: invoice.rfhInvoiceNumber,
  };
}
