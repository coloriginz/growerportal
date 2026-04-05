import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { put } from "@vercel/blob";
import {
  parseIssuanceVoucherPdf,
  parseRfhDate,
} from "@/features/fust/lib/voucher-parser";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth(["finance", "admin"]);
  if (error) return error;
  void session;

  const params = request.nextUrl.searchParams;
  const matched = params.get("matched");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (matched === "true") {
    where.orderLinks = { some: {} };
  } else if (matched === "false") {
    where.orderLinks = { none: {} };
  }

  const vouchers = await prisma.fustIssuanceVoucher.findMany({
    where,
    include: {
      items: {
        include: {
          fustType: { select: { id: true, code: true, name: true } },
        },
      },
      orderLinks: {
        include: {
          order: {
            include: {
              grower: {
                select: { id: true, code: true, name: true, company: true },
              },
              items: {
                include: { fustType: { select: { id: true, code: true, name: true } } },
              },
            },
          },
        },
      },
    },
    orderBy: { transactionDate: "desc" },
  });

  return NextResponse.json(vouchers);
}

export async function POST(request: NextRequest) {
  const { error, session } = await requireAuth(["finance", "admin"]);
  if (error) return error;
  void session;

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
  const parsed = await parseIssuanceVoucherPdf(buffer);

  if (!parsed.transactionNumber) {
    return NextResponse.json(
      {
        error: "Could not extract transaction number from PDF",
        debug: parsed,
      },
      { status: 422 }
    );
  }

  // Duplicate check
  const existing = await prisma.fustIssuanceVoucher.findUnique({
    where: { transactionNumber: parsed.transactionNumber },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Voucher with this transaction number already exists", transactionNumber: parsed.transactionNumber },
      { status: 409 }
    );
  }

  // Store in Vercel Blob
  const blob = await put(
    `fust-vouchers/${Date.now()}-${file.name}`,
    buffer,
    { access: "public", contentType: file.type }
  );

  // Parse dates
  const transactionDate = parsed.transactionDate
    ? parseRfhDate(parsed.transactionDate)
    : null;
  const creationDate = parsed.creationDate
    ? parseRfhDate(parsed.creationDate)
    : null;

  // Match fust codes against FustType table
  const fustTypes = await prisma.fustType.findMany();
  const fustTypeByCode = new Map(
    fustTypes.map((ft) => [ft.code.toLowerCase(), ft])
  );

  const itemsToCreate = parsed.items.map((item) => {
    const fustType = fustTypeByCode.get(item.fustCode.toLowerCase());
    return {
      fustCode: item.fustCode,
      description: item.description,
      quantity: item.quantity,
      fustTypeId: fustType?.id ?? null,
    };
  });

  const voucher = await prisma.fustIssuanceVoucher.create({
    data: {
      transactionNumber: parsed.transactionNumber,
      type: parsed.type,
      transactionDate: transactionDate || new Date(),
      creationDate,
      location: parsed.location,
      customerNumber: parsed.customerNumber,
      customerName: parsed.customerName,
      transporterName: parsed.transporterName,
      cardNumber: parsed.cardNumber,
      pdfUrl: blob.url,
      items: {
        create: itemsToCreate,
      },
    },
    include: {
      items: {
        include: {
          fustType: { select: { id: true, code: true, name: true } },
        },
      },
      orderLinks: true,
    },
  });

  return NextResponse.json(voucher, { status: 201 });
}
