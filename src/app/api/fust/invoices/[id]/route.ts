import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { logFustEvent } from "@/lib/fust-audit";

const patchSchema = z.object({
  status: z.enum(["pending", "matched", "charged", "paid"]).optional(),
  invoiceNumber: z.string().optional().nullable(),
  invoiceDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["finance", "admin"]);
  if (error) return error;
  void session;

  const { id } = await params;

  const invoice = await prisma.fustInvoice.findUnique({
    where: { id },
    include: {
      items: {
        include: { fustType: { select: { id: true, code: true, name: true, category: true } } },
      },
      charges: {
        include: {
          grower: { select: { id: true, code: true, name: true, company: true } },
        },
      },
    },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
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

  const invoice = await prisma.fustInvoice.findUnique({ where: { id } });
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = {};

  if (parsed.data.status !== undefined) {
    updateData.status = parsed.data.status;
  }
  if (parsed.data.invoiceNumber !== undefined) {
    updateData.invoiceNumber = parsed.data.invoiceNumber;
  }
  if (parsed.data.invoiceDate !== undefined) {
    updateData.invoiceDate = parsed.data.invoiceDate
      ? new Date(parsed.data.invoiceDate)
      : null;
  }
  if (parsed.data.notes !== undefined) {
    updateData.notes = parsed.data.notes;
  }

  const updated = await prisma.fustInvoice.update({
    where: { id },
    data: updateData,
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
  });

  // Audit: invoice status changed
  if (parsed.data.status !== undefined) {
    await logFustEvent({
      entityType: "invoice",
      entityId: id,
      action: "invoice_status_changed",
      actorId: session!.user.id,
      actorName: session!.user.name,
      metadata: { fromStatus: invoice.status, toStatus: parsed.data.status },
    });
  }

  return NextResponse.json(updated);
}
