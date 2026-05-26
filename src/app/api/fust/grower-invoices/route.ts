import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth, resolveSupplierId } from "@/lib/api-helpers";
import { logFustEvent } from "@/lib/fust-audit";
import { put } from "@vercel/blob";
import { generateInvoicePdf } from "@/features/fust/lib/invoice-pdf";
import { generateExactXml } from "@/features/fust/lib/invoice-xml";
import { getSupplierEmailBranding } from "@/lib/company-helpers";

const createInvoiceSchema = z.object({
  supplierId: z.string().uuid(),
  orderIds: z.array(z.string().uuid()).min(1),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional().nullable(),
});

const createFromRfhSchema = z.object({
  supplierId: z.string().uuid(),
  rfhInvoiceIds: z.array(z.string().uuid()).min(1),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional().nullable(),
});

async function generateInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `FI-${year}-`;
  const last = await prisma.fustGrowerInvoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  });
  if (last) {
    const lastNum = parseInt(last.invoiceNumber.replace(prefix, ""), 10);
    return `${prefix}${String(lastNum + 1).padStart(4, "0")}`;
  }
  return `${prefix}0001`;
}

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth(["finance", "admin", "supplier"]);
  if (error) return error;

  const params = request.nextUrl.searchParams;
  const role = session!.user.role;
  const requestedSupplierId = params.get("supplierId");
  const status = params.get("status");
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");
  const source = params.get("source");

  // Return allocated voucher data grouped by supplier for RFH-based invoicing
  if (source === "rfh") {
    const allocations = await prisma.rfhVoucherAllocation.findMany({
      where: {
        supplierId: { not: null },
        rfhInvoice: { status: { in: ["complete"] } },
      },
      include: {
        rfhInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            status: true,
            lines: true,
          },
        },
        supplier: {
          select: { id: true, code: true, name: true, company: true, companyEntity: { select: { name: true } } },
        },
        voucher: {
          select: { id: true, transactionNumber: true },
        },
      },
    });

    return NextResponse.json(allocations);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  // Suppliers can only see their own invoices
  if (role === "supplier") {
    where.supplierId = session!.user.supplierId;
  } else if (requestedSupplierId) {
    where.supplierId = requestedSupplierId;
  }

  if (status && status !== "all") {
    where.status = status;
  }

  if (dateFrom || dateTo) {
    where.invoiceDate = {};
    if (dateFrom) where.invoiceDate.gte = new Date(dateFrom);
    if (dateTo) where.invoiceDate.lte = new Date(dateTo);
  }

  const invoices = await prisma.fustGrowerInvoice.findMany({
    where,
    include: {
      supplier: {
        select: {
          id: true,
          code: true,
          name: true,
          company: true,
          companyEntity: { select: { name: true } },
        },
      },
      items: { select: { id: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { invoiceDate: "desc" },
  });

  // Map to include itemCount instead of full items array
  const result = invoices.map((inv) => ({
    ...inv,
    itemCount: inv.items.length,
    items: undefined,
  }));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const { error, session } = await requireAuth(["finance", "admin"]);
  if (error) return error;

  const body = await request.json();

  // Detect RFH allocation flow vs legacy order flow
  if (body.rfhInvoiceIds) {
    return handleCreateFromRfh(body, session!);
  }

  const parsed = createInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { supplierId, orderIds, invoiceDate, notes } = parsed.data;

  // 1. Validate supplier exists
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: {
      id: true,
      code: true,
      name: true,
      company: true,
      street: true,
      city: true,
      postalCode: true,
      country: true,
    },
  });
  if (!supplier) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  // 2. Validate all orders: delivered, belong to supplier, not already invoiced, not deleted
  const orders = await prisma.fustOrder.findMany({
    where: {
      id: { in: orderIds },
      supplierId,
      status: "delivered",
      invoicedAt: null,
      deletedAt: null,
    },
    include: {
      items: {
        include: {
          fustType: {
            select: {
              id: true,
              name: true,
              pricePerUnit: true,
              rentalPricePerUnit: true,
              depositArticleCode: true,
              rentalArticleCode: true,
            },
          },
        },
      },
    },
  });

  if (orders.length !== orderIds.length) {
    const foundIds = new Set(orders.map((o) => o.id));
    const missing = orderIds.filter((id) => !foundIds.has(id));
    return NextResponse.json(
      {
        error: "Some orders are invalid (not delivered, already invoiced, wrong supplier, or deleted)",
        invalidOrderIds: missing,
      },
      { status: 400 }
    );
  }

  // 3. Build invoice line items from delivery items
  const invoiceItems: Array<{
    orderId: string;
    fustTypeId: string;
    articleCode: string;
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    lineType: string;
  }> = [];

  for (const order of orders) {
    for (const orderItem of order.items) {
      const ft = orderItem.fustType;
      const qty = orderItem.deliveredQuantity ?? orderItem.quantity;

      // Deposit line (always)
      const depositUnitPrice = Number(ft.pricePerUnit);
      invoiceItems.push({
        orderId: order.id,
        fustTypeId: ft.id,
        articleCode: ft.depositArticleCode,
        description: `${ft.name} - Statiegeld`,
        quantity: qty,
        unitPrice: depositUnitPrice,
        totalPrice: qty * depositUnitPrice,
        lineType: "deposit",
      });

      // Rental line (only if rentalPricePerUnit > 0)
      const rentalUnitPrice = Number(ft.rentalPricePerUnit);
      if (rentalUnitPrice > 0) {
        invoiceItems.push({
          orderId: order.id,
          fustTypeId: ft.id,
          articleCode: ft.rentalArticleCode,
          description: `${ft.name} - Huur`,
          quantity: qty,
          unitPrice: rentalUnitPrice,
          totalPrice: qty * rentalUnitPrice,
          lineType: "rental",
        });
      }
    }
  }

  // 4. Calculate totals
  const subtotalExVat = invoiceItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const vatRate = 21;
  const vatAmount = Math.round(subtotalExVat * (vatRate / 100) * 100) / 100;
  const totalInclVat = Math.round((subtotalExVat + vatAmount) * 100) / 100;

  // 5. Generate invoice number
  const invoiceNumber = await generateInvoiceNumber();

  // 6. Generate PDF + XML BEFORE any DB writes (so failures don't leave orphaned data)
  const formattedDate = new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(invoiceDate));

  const branding = await getSupplierEmailBranding(supplierId);

  const pdfData = {
    invoiceNumber,
    invoiceDate: formattedDate,
    supplier: {
      code: supplier.code,
      name: supplier.name,
      company: supplier.company,
      street: supplier.street,
      city: supplier.city,
      postalCode: supplier.postalCode,
      country: supplier.country,
    },
    items: invoiceItems.map((item) => ({
      articleCode: item.articleCode,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
    })),
    subtotalExVat,
    vatRate,
    vatAmount,
    totalInclVat,
    notes: notes || null,
    branding: {
      companyName: branding.companyName,
      logoBase64: branding.logoBase64,
    },
  };

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateInvoicePdf(pdfData);
  } catch (err) {
    console.error("PDF generation failed:", err);
    return NextResponse.json(
      { error: "Failed to generate invoice PDF" },
      { status: 500 }
    );
  }

  const xmlContent = generateExactXml({
    invoiceNumber,
    invoiceDate, // ISO format for XML
    supplier: {
      code: supplier.code,
      name: supplier.company || supplier.name,
    },
    items: invoiceItems.map((item) => ({
      articleCode: item.articleCode,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      vatCode: "2", // 21% NL high tariff
    })),
  });

  // 7. Upload PDF and XML to Vercel Blob
  const pdfBlob = await put(
    `fust-grower-invoices/${invoiceNumber}.pdf`,
    pdfBuffer,
    { access: "public", contentType: "application/pdf" }
  );
  const xmlBlob = await put(
    `fust-grower-invoices/${invoiceNumber}.xml`,
    xmlContent,
    { access: "public", contentType: "application/xml" }
  );

  // 8. NOW commit to DB — invoice + mark orders as invoiced — only after PDF+XML are ready
  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.fustGrowerInvoice.create({
      data: {
        invoiceNumber,
        invoiceDate: new Date(invoiceDate),
        supplierId,
        subtotalExVat,
        vatRate,
        vatAmount,
        totalInclVat,
        status: "draft",
        notes: notes || null,
        createdById: session!.user.id,
        pdfUrl: pdfBlob.url,
        xmlUrl: xmlBlob.url,
        items: {
          create: invoiceItems.map((item) => ({
            orderId: item.orderId,
            fustTypeId: item.fustTypeId,
            articleCode: item.articleCode,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            lineType: item.lineType,
          })),
        },
      },
      include: {
        items: {
          include: {
            fustType: { select: { id: true, code: true, name: true } },
            order: { select: { id: true, orderNumber: true } },
          },
        },
        supplier: {
          select: {
            id: true,
            code: true,
            name: true,
            company: true,
          },
        },
        createdBy: { select: { name: true } },
      },
    });

    // Mark orders as invoiced
    await tx.fustOrder.updateMany({
      where: { id: { in: orderIds } },
      data: { invoicedAt: new Date() },
    });

    return created;
  });

  // 9. Audit log
  await logFustEvent({
    entityType: "grower_invoice",
    entityId: invoice.id,
    action: "grower_invoice_created",
    actorId: session!.user.id,
    actorName: session!.user.name,
    metadata: {
      invoiceNumber,
      supplierId,
      orderCount: orderIds.length,
      totalInclVat,
    },
  });

  return NextResponse.json(invoice, { status: 201 });
}

// ─── RFH Allocation-based invoice creation ─────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCreateFromRfh(body: unknown, session: any) {
  const parsed = createFromRfhSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { supplierId, rfhInvoiceIds, invoiceDate, notes } = parsed.data;

  // 1. Validate supplier exists
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: {
      id: true,
      code: true,
      name: true,
      company: true,
      street: true,
      city: true,
      postalCode: true,
      country: true,
    },
  });
  if (!supplier) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  // 2. Load all allocations for the given RFH invoices + supplier
  const allocations = await prisma.rfhVoucherAllocation.findMany({
    where: {
      rfhInvoiceId: { in: rfhInvoiceIds },
      supplierId,
    },
    include: {
      rfhInvoice: {
        include: { lines: true },
      },
    },
  });

  if (allocations.length === 0) {
    return NextResponse.json(
      { error: "No allocations found for the given RFH invoices and supplier" },
      { status: 400 }
    );
  }

  // 3. Build invoice items from RFH invoice lines
  // Collect all voucher numbers allocated to this supplier
  const allocatedVoucherNumbers = new Set(allocations.map((a) => a.voucherNumber));

  // Gather all lines from the RFH invoices that match allocated voucher numbers
  const relevantLines: Array<{
    fustCode: string;
    description: string;
    quantity: number;
    statiegeldPrice: number;
    statiegeldAmount: number;
    fusthuurPrice: number;
    fusthuurAmount: number;
    vatCode: string;
  }> = [];

  const processedInvoiceIds = new Set<string>();
  for (const alloc of allocations) {
    processedInvoiceIds.add(alloc.rfhInvoiceId);
    for (const line of alloc.rfhInvoice.lines) {
      if (allocatedVoucherNumbers.has(line.voucherNumber)) {
        relevantLines.push({
          fustCode: line.fustCode,
          description: line.description,
          quantity: line.quantity,
          statiegeldPrice: Number(line.statiegeldPrice ?? 0),
          statiegeldAmount: Number(line.statiegeldAmount ?? 0),
          fusthuurPrice: Number(line.fusthuurPrice ?? 0),
          fusthuurAmount: Number(line.fusthuurAmount ?? 0),
          vatCode: line.vatCode,
        });
      }
    }
  }

  // Group by fustCode and line type, sum amounts
  const groupedItems = new Map<
    string,
    {
      articleCode: string;
      description: string;
      quantity: number;
      totalPrice: number;
      lineType: string;
      fustCode: string;
    }
  >();

  for (const line of relevantLines) {
    // Statiegeld line (AG)
    if (line.statiegeldAmount !== 0) {
      const key = `${line.fustCode}-deposit`;
      const existing = groupedItems.get(key);
      if (existing) {
        existing.quantity += line.quantity;
        existing.totalPrice += line.statiegeldAmount;
      } else {
        groupedItems.set(key, {
          articleCode: "2907",
          description: `${line.description} - Statiegeld`,
          quantity: line.quantity,
          totalPrice: line.statiegeldAmount,
          lineType: "deposit",
          fustCode: line.fustCode,
        });
      }
    }

    // Fusthuur line (NE)
    if (line.fusthuurAmount !== 0) {
      const key = `${line.fustCode}-rental`;
      const existing = groupedItems.get(key);
      if (existing) {
        existing.quantity += line.quantity;
        existing.totalPrice += line.fusthuurAmount;
      } else {
        groupedItems.set(key, {
          articleCode: "2908",
          description: `${line.description} - Huur`,
          quantity: line.quantity,
          totalPrice: line.fusthuurAmount,
          lineType: "rental",
          fustCode: line.fustCode,
        });
      }
    }
  }

  const invoiceItems = Array.from(groupedItems.values()).map((item) => ({
    orderId: null as string | null,
    fustTypeId: null as string | null,
    articleCode: item.articleCode,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.quantity !== 0 ? Math.round((item.totalPrice / item.quantity) * 100) / 100 : 0,
    totalPrice: Math.round(item.totalPrice * 100) / 100,
    lineType: item.lineType,
  }));

  // 4. Calculate totals
  const subtotalExVat = invoiceItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const vatRate = 21;
  const vatAmount = Math.round(subtotalExVat * (vatRate / 100) * 100) / 100;
  const totalInclVat = Math.round((subtotalExVat + vatAmount) * 100) / 100;

  // 5. Generate invoice number
  const invoiceNumber = await generateInvoiceNumber();

  // 6. Generate PDF + XML
  const formattedDate = new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(invoiceDate));

  const branding = await getSupplierEmailBranding(supplierId);

  const pdfData = {
    invoiceNumber,
    invoiceDate: formattedDate,
    supplier: {
      code: supplier.code,
      name: supplier.name,
      company: supplier.company,
      street: supplier.street,
      city: supplier.city,
      postalCode: supplier.postalCode,
      country: supplier.country,
    },
    items: invoiceItems.map((item) => ({
      articleCode: item.articleCode,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
    })),
    subtotalExVat,
    vatRate,
    vatAmount,
    totalInclVat,
    notes: notes || null,
    branding: {
      companyName: branding.companyName,
      logoBase64: branding.logoBase64,
    },
  };

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateInvoicePdf(pdfData);
  } catch (err) {
    console.error("PDF generation failed:", err);
    return NextResponse.json(
      { error: "Failed to generate invoice PDF" },
      { status: 500 }
    );
  }

  const xmlContent = generateExactXml({
    invoiceNumber,
    invoiceDate,
    supplier: {
      code: supplier.code,
      name: supplier.company || supplier.name,
    },
    items: invoiceItems.map((item) => ({
      articleCode: item.articleCode,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      vatCode: "2",
    })),
  });

  // 7. Upload PDF and XML to Vercel Blob
  const pdfBlob = await put(
    `fust-grower-invoices/${invoiceNumber}.pdf`,
    pdfBuffer,
    { access: "public", contentType: "application/pdf" }
  );
  const xmlBlob = await put(
    `fust-grower-invoices/${invoiceNumber}.xml`,
    xmlContent,
    { access: "public", contentType: "application/xml" }
  );

  // 8. Commit to DB
  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.fustGrowerInvoice.create({
      data: {
        invoiceNumber,
        invoiceDate: new Date(invoiceDate),
        supplierId,
        subtotalExVat,
        vatRate,
        vatAmount,
        totalInclVat,
        status: "draft",
        notes: notes || null,
        createdById: session.user.id,
        pdfUrl: pdfBlob.url,
        xmlUrl: xmlBlob.url,
        items: {
          create: invoiceItems.map((item) => ({
            orderId: item.orderId,
            fustTypeId: item.fustTypeId,
            articleCode: item.articleCode,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            lineType: item.lineType,
          })),
        },
      },
      include: {
        items: true,
        supplier: {
          select: {
            id: true,
            code: true,
            name: true,
            company: true,
          },
        },
        createdBy: { select: { name: true } },
      },
    });

    // Update RFH invoice status to "invoiced"
    await tx.rfhInvoice.updateMany({
      where: { id: { in: Array.from(processedInvoiceIds) } },
      data: { status: "invoiced" },
    });

    return created;
  });

  // 9. Audit log
  await logFustEvent({
    entityType: "grower_invoice",
    entityId: invoice.id,
    action: "grower_invoice_created",
    actorId: session.user.id,
    actorName: session.user.name,
    metadata: {
      invoiceNumber,
      supplierId,
      rfhInvoiceCount: rfhInvoiceIds.length,
      allocationCount: allocations.length,
      totalInclVat,
      source: "rfh",
    },
  });

  return NextResponse.json(invoice, { status: 201 });
}
