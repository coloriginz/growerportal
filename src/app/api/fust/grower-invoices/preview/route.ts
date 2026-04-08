import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { generateInvoicePdf } from "@/features/fust/lib/invoice-pdf";
import { getGrowerEmailBranding } from "@/lib/company-helpers";

const previewSchema = z.object({
  growerId: z.string().uuid(),
  orderIds: z.array(z.string().uuid()).min(1),
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

  const { growerId, orderIds, invoiceDate, notes } = parsed.data;

  // Validate grower
  const grower = await prisma.grower.findUnique({
    where: { id: growerId },
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
  if (!grower) {
    return NextResponse.json({ error: "Grower not found" }, { status: 404 });
  }

  // Validate orders
  const orders = await prisma.fustOrder.findMany({
    where: {
      id: { in: orderIds },
      growerId,
      status: "delivered",
      invoicedAt: null,
      deletedAt: null,
    },
    include: {
      delivery: {
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
      },
    },
  });

  if (orders.length !== orderIds.length) {
    return NextResponse.json(
      { error: "Some orders are invalid" },
      { status: 400 }
    );
  }

  // Build invoice lines
  const invoiceItems: Array<{
    articleCode: string;
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }> = [];

  for (const order of orders) {
    if (!order.delivery) continue;
    for (const deliveryItem of order.delivery.items) {
      const ft = deliveryItem.fustType;
      const qty = deliveryItem.quantity;

      const depositUnitPrice = Number(ft.pricePerUnit);
      invoiceItems.push({
        articleCode: ft.depositArticleCode,
        description: `${ft.name} - Statiegeld`,
        quantity: qty,
        unitPrice: depositUnitPrice,
        totalPrice: qty * depositUnitPrice,
      });

      const rentalUnitPrice = Number(ft.rentalPricePerUnit);
      if (rentalUnitPrice > 0) {
        invoiceItems.push({
          articleCode: ft.rentalArticleCode,
          description: `${ft.name} - Huur`,
          quantity: qty,
          unitPrice: rentalUnitPrice,
          totalPrice: qty * rentalUnitPrice,
        });
      }
    }
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
  const branding = await getGrowerEmailBranding(growerId);

  // Generate preview PDF (no DB writes, no Blob upload)
  try {
    const pdfBuffer = await generateInvoicePdf({
      invoiceNumber: "PREVIEW",
      invoiceDate: formattedDate,
      grower: {
        code: grower.code,
        name: grower.name,
        company: grower.company,
        street: grower.street,
        city: grower.city,
        postalCode: grower.postalCode,
        country: grower.country,
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
