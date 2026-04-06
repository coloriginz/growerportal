import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { put } from "@vercel/blob";
import { parseFustInvoicePdf } from "@/features/fust/lib/invoice-parser";
import { logFustEvent } from "@/lib/fust-audit";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth(["finance", "admin"]);
  if (error) return error;
  void session;

  const params = request.nextUrl.searchParams;
  const status = params.get("status");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (status && status !== "all") {
    where.status = status;
  }

  const invoices = await prisma.fustInvoice.findMany({
    where,
    include: {
      items: {
        include: { fustType: { select: { id: true, code: true, name: true } } },
      },
      charges: {
        include: {
          grower: { select: { id: true, code: true, name: true, company: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(invoices);
}

export async function POST(request: NextRequest) {
  const { error, session } = await requireAuth(["finance", "admin"]);
  if (error) return error;

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

  // Store in Vercel Blob
  const blob = await put(
    `fust-invoices/${Date.now()}-${file.name}`,
    buffer,
    { access: "public", contentType: file.type }
  );

  // Try to parse the PDF
  const parsed = await parseFustInvoicePdf(buffer);

  // Parse the invoice date if found
  let invoiceDate: Date | null = null;
  if (parsed.invoiceDate) {
    // Try common date formats: dd-mm-yyyy, dd/mm/yyyy, dd.mm.yyyy
    const parts = parsed.invoiceDate.split(/[-/.]/);
    if (parts.length === 3) {
      const day = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1;
      const year =
        parseInt(parts[2]) < 100 ? 2000 + parseInt(parts[2]) : parseInt(parts[2]);
      invoiceDate = new Date(year, month, day);
      if (isNaN(invoiceDate.getTime())) invoiceDate = null;
    }
  }

  // Match parsed items against FustType table
  const fustTypes = await prisma.fustType.findMany();
  const fustTypeByCode = new Map(fustTypes.map((ft) => [ft.code.toLowerCase(), ft]));

  const itemsToCreate = parsed.items
    .map((item) => {
      const fustType = fustTypeByCode.get(item.fustCode.toLowerCase());
      if (!fustType) return null;
      return {
        fustTypeId: fustType.id,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      };
    })
    .filter(Boolean) as Array<{
    fustTypeId: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;

  const totalAmount =
    parsed.totalAmount ||
    itemsToCreate.reduce((sum, i) => sum + i.totalPrice, 0);

  const invoice = await prisma.fustInvoice.create({
    data: {
      invoiceNumber: parsed.invoiceNumber,
      invoiceDate,
      totalAmount,
      status: itemsToCreate.length > 0 ? "matched" : "pending",
      pdfUrl: blob.url,
      items: {
        create: itemsToCreate,
      },
    },
    include: {
      items: {
        include: { fustType: { select: { id: true, code: true, name: true } } },
      },
      charges: true,
    },
  });

  // Audit: invoice uploaded
  await logFustEvent({
    entityType: "invoice",
    entityId: invoice.id,
    action: "invoice_uploaded",
    actorId: session!.user.id,
    actorName: session!.user.name,
    metadata: { invoiceNumber: parsed.invoiceNumber, itemCount: itemsToCreate.length },
  });

  return NextResponse.json(invoice, { status: 201 });
}
