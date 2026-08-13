import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { logFustEvent } from "@/lib/fust-audit";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["admin", "finance"]);
  if (error) return error;
  void session;

  const { id } = await params;

  const invoice = await prisma.rfhInvoice.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true, slug: true } },
      lines: {
        orderBy: [{ voucherNumber: "asc" }, { vatCode: "asc" }],
      },
      allocations: {
        include: {
          voucher: {
            select: {
              id: true,
              transactionNumber: true,
              notes: true,
              transporterName: true,
              customerName: true,
              pdfUrl: true,
            },
          },
          supplier: { select: { id: true, code: true, name: true } },
          allocatedBy: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  return NextResponse.json(invoice);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["admin", "finance"]);
  if (error) return error;

  const { id } = await params;

  const invoice = await prisma.rfhInvoice.findUnique({
    where: { id },
    select: { id: true, invoiceNumber: true, status: true },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  if (invoice.status === "invoiced") {
    return NextResponse.json(
      { error: "Cannot delete an invoiced invoice" },
      { status: 400 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.rfhInvoice.delete({ where: { id } });
  });

  await logFustEvent({
    entityType: "rfh_invoice",
    entityId: id,
    action: "rfh_invoice_deleted",
    actorId: session!.user.id,
    actorName: session!.user.name,
    metadata: { invoiceNumber: invoice.invoiceNumber },
  });

  return NextResponse.json({ success: true });
}
