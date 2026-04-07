import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { logFustEvent } from "@/lib/fust-audit";

const patchSchema = z.object({
  status: z.enum(["draft", "sent", "paid"]).optional(),
  notes: z.string().optional().nullable(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["finance", "admin", "grower"]);
  if (error) return error;

  const { id } = await params;

  const invoice = await prisma.fustGrowerInvoice.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          fustType: { select: { id: true, code: true, name: true, category: true } },
          order: { select: { id: true, orderNumber: true, requestedDate: true } },
        },
      },
      grower: {
        select: {
          id: true,
          code: true,
          name: true,
          company: true,
          street: true,
          city: true,
          postalCode: true,
          country: true,
          vatNumber: true,
        },
      },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // Growers can only see their own invoices
  if (session!.user.role === "grower" && invoice.growerId !== session!.user.growerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(invoice);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["finance", "admin"]);
  if (error) return error;

  const { id } = await params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const invoice = await prisma.fustGrowerInvoice.findUnique({ where: { id } });
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = {};

  if (parsed.data.status !== undefined) {
    updateData.status = parsed.data.status;
  }
  if (parsed.data.notes !== undefined) {
    updateData.notes = parsed.data.notes;
  }

  const updated = await prisma.fustGrowerInvoice.update({
    where: { id },
    data: updateData,
    include: {
      items: {
        include: {
          fustType: { select: { id: true, code: true, name: true } },
          order: { select: { id: true, orderNumber: true } },
        },
      },
      grower: {
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

  // Audit: status changed
  if (parsed.data.status !== undefined) {
    await logFustEvent({
      entityType: "grower_invoice",
      entityId: id,
      action: "grower_invoice_status_changed",
      actorId: session!.user.id,
      actorName: session!.user.name,
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        fromStatus: invoice.status,
        toStatus: parsed.data.status,
      },
    });
  }

  return NextResponse.json(updated);
}
