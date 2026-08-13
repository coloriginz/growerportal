import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { generateInvoicePdf } from "@/features/fust/lib/invoice-pdf";
import { getSupplierEmailBranding } from "@/lib/company-helpers";

const previewSchema = z.object({
  supplierId: z.string().uuid(),
  orderIds: z.array(z.string().uuid()).min(1).optional(),
  rfhInvoiceIds: z.array(z.string().uuid()).min(1).optional(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional().nullable(),
});

export async function POST(request: NextRequest) {
  const { error } = await requireAuth(["finance", "admin"]);
  if (error) return error;

  const body = await request.json();
  const parsed = previewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { supplierId, invoiceDate, notes } = parsed.data;

  // Validate supplier
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

  let invoiceItems: Array<{
    articleCode: string;
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;

  if (parsed.data.rfhInvoiceIds) {
    // RFH allocation flow
    invoiceItems = await buildItemsFromRfh(parsed.data.rfhInvoiceIds, supplierId);
  } else if (parsed.data.orderIds) {
    // Legacy order flow
    invoiceItems = await buildItemsFromOrders(parsed.data.orderIds, supplierId);
  } else {
    return NextResponse.json(
      { error: "Either orderIds or rfhInvoiceIds required" },
      { status: 400 }
    );
  }

  // Calculate totals
  const subtotalExVat = invoiceItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const vatRate = 21;
  const vatAmount = Math.round(subtotalExVat * (vatRate / 100) * 100) / 100;
  const totalInclVat = Math.round((subtotalExVat + vatAmount) * 100) / 100;

  // Format date
  const formattedDate = new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(invoiceDate));

  // Get branding
  const branding = await getSupplierEmailBranding(supplierId);

  // Generate preview PDF (no DB writes, no Blob upload)
  try {
    const pdfBuffer = await generateInvoicePdf({
      invoiceNumber: "PREVIEW",
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
      items: invoiceItems,
      subtotalExVat,
      vatRate,
      vatAmount,
      totalInclVat,
      notes: notes || null,
      branding: {
        companyName: branding.companyName,
        logoBase64: branding.logoBase64,
      },
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=\"preview-invoice.pdf\"",
      },
    });
  } catch (err) {
    console.error("Preview PDF generation failed:", err);
    return NextResponse.json(
      { error: "Failed to generate preview PDF" },
      { status: 500 }
    );
  }
}

async function buildItemsFromRfh(
  rfhInvoiceIds: string[],
  supplierId: string
): Promise<Array<{ articleCode: string; description: string; quantity: number; unitPrice: number; totalPrice: number }>> {
  const allocations = await prisma.rfhVoucherAllocation.findMany({
    where: {
      rfhInvoiceId: { in: rfhInvoiceIds },
      supplierId,
    },
    include: {
      rfhInvoice: { include: { lines: true } },
    },
  });

  const allocatedVoucherNumbers = new Set(allocations.map((a) => a.voucherNumber));

  const grouped = new Map<string, { articleCode: string; description: string; quantity: number; totalPrice: number }>();

  for (const alloc of allocations) {
    for (const line of alloc.rfhInvoice.lines) {
      if (!allocatedVoucherNumbers.has(line.voucherNumber)) continue;

      const statiegeldAmount = Number(line.statiegeldAmount ?? 0);
      const fusthuurAmount = Number(line.fusthuurAmount ?? 0);

      if (statiegeldAmount !== 0) {
        const key = `${line.fustCode}-deposit`;
        const existing = grouped.get(key);
        if (existing) {
          existing.quantity += line.quantity;
          existing.totalPrice += statiegeldAmount;
        } else {
          grouped.set(key, {
            articleCode: "2907",
            description: `${line.description} - Statiegeld`,
            quantity: line.quantity,
            totalPrice: statiegeldAmount,
          });
        }
      }

      if (fusthuurAmount !== 0) {
        const key = `${line.fustCode}-rental`;
        const existing = grouped.get(key);
        if (existing) {
          existing.quantity += line.quantity;
          existing.totalPrice += fusthuurAmount;
        } else {
          grouped.set(key, {
            articleCode: "2908",
            description: `${line.description} - Huur`,
            quantity: line.quantity,
            totalPrice: fusthuurAmount,
          });
        }
      }
    }
  }

  return Array.from(grouped.values()).map((item) => ({
    articleCode: item.articleCode,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.quantity !== 0 ? Math.round((item.totalPrice / item.quantity) * 100) / 100 : 0,
    totalPrice: Math.round(item.totalPrice * 100) / 100,
  }));
}

async function buildItemsFromOrders(
  orderIds: string[],
  supplierId: string
): Promise<Array<{ articleCode: string; description: string; quantity: number; unitPrice: number; totalPrice: number }>> {
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

  const items: Array<{ articleCode: string; description: string; quantity: number; unitPrice: number; totalPrice: number }> = [];

  for (const order of orders) {
    for (const orderItem of order.items) {
      const ft = orderItem.fustType;
      const qty = orderItem.deliveredQuantity ?? orderItem.quantity;

      const depositUnitPrice = Number(ft.pricePerUnit);
      items.push({
        articleCode: ft.depositArticleCode,
        description: `${ft.name} - Statiegeld`,
        quantity: qty,
        unitPrice: depositUnitPrice,
        totalPrice: qty * depositUnitPrice,
      });

      const rentalUnitPrice = Number(ft.rentalPricePerUnit);
      if (rentalUnitPrice > 0) {
        items.push({
          articleCode: ft.rentalArticleCode,
          description: `${ft.name} - Huur`,
          quantity: qty,
          unitPrice: rentalUnitPrice,
          totalPrice: qty * rentalUnitPrice,
        });
      }
    }
  }

  return items;
}
