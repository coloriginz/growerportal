import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { logFustEvent } from "@/lib/fust-audit";

const allocateSchema = z.object({
  voucherNumber: z.string().min(1),
  supplierId: z.string().uuid(),
});

const deallocateSchema = z.object({
  voucherNumber: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["admin", "finance"]);
  if (error) return error;

  const { id } = await params;

  const body = await request.json();
  const parsed = allocateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { voucherNumber, supplierId } = parsed.data;

  // Verify invoice exists and is not invoiced
  const invoice = await prisma.rfhInvoice.findUnique({
    where: { id },
    select: { id: true, status: true },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  if (invoice.status === "invoiced") {
    return NextResponse.json(
      { error: "Cannot allocate on an invoiced invoice" },
      { status: 400 }
    );
  }

  // Verify supplier exists
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, name: true, code: true },
  });

  if (!supplier) {
    return NextResponse.json(
      { error: "Supplier not found" },
      { status: 404 }
    );
  }

  // Update allocation and recalculate status in a transaction
  const updatedAllocation = await prisma.$transaction(async (tx) => {
    const allocation = await tx.rfhVoucherAllocation.update({
      where: {
        rfhInvoiceId_voucherNumber: {
          rfhInvoiceId: id,
          voucherNumber,
        },
      },
      data: {
        supplierId,
        allocatedById: session!.user.id,
        allocatedAt: new Date(),
      },
      include: {
        supplier: { select: { id: true, code: true, name: true } },
        allocatedBy: { select: { id: true, name: true } },
      },
    });

    // Recalculate invoice status
    const allAllocations = await tx.rfhVoucherAllocation.findMany({
      where: { rfhInvoiceId: id },
      select: { supplierId: true },
    });

    const allocatedCount = allAllocations.filter(
      (a) => a.supplierId !== null
    ).length;

    let newStatus: string;
    if (allocatedCount === 0) {
      newStatus = "open";
    } else if (allocatedCount === allAllocations.length) {
      newStatus = "complete";
    } else {
      newStatus = "partial";
    }

    await tx.rfhInvoice.update({
      where: { id },
      data: { status: newStatus },
    });

    return allocation;
  });

  await logFustEvent({
    entityType: "rfh_invoice",
    entityId: id,
    action: "rfh_voucher_allocated",
    actorId: session!.user.id,
    actorName: session!.user.name,
    metadata: {
      voucherNumber,
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierCode: supplier.code,
    },
  });

  return NextResponse.json(updatedAllocation);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["admin", "finance"]);
  if (error) return error;

  const { id } = await params;

  const body = await request.json();
  const parsed = deallocateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { voucherNumber } = parsed.data;

  // Verify invoice exists and is not invoiced
  const invoice = await prisma.rfhInvoice.findUnique({
    where: { id },
    select: { id: true, status: true },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  if (invoice.status === "invoiced") {
    return NextResponse.json(
      { error: "Cannot deallocate on an invoiced invoice" },
      { status: 400 }
    );
  }

  // Deallocate and recalculate status in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.rfhVoucherAllocation.update({
      where: {
        rfhInvoiceId_voucherNumber: {
          rfhInvoiceId: id,
          voucherNumber,
        },
      },
      data: {
        supplierId: null,
        allocatedById: null,
        allocatedAt: null,
      },
    });

    // Recalculate invoice status
    const allAllocations = await tx.rfhVoucherAllocation.findMany({
      where: { rfhInvoiceId: id },
      select: { supplierId: true },
    });

    const allocatedCount = allAllocations.filter(
      (a) => a.supplierId !== null
    ).length;

    let newStatus: string;
    if (allocatedCount === 0) {
      newStatus = "open";
    } else if (allocatedCount === allAllocations.length) {
      newStatus = "complete";
    } else {
      newStatus = "partial";
    }

    await tx.rfhInvoice.update({
      where: { id },
      data: { status: newStatus },
    });
  });

  await logFustEvent({
    entityType: "rfh_invoice",
    entityId: id,
    action: "rfh_voucher_deallocated",
    actorId: session!.user.id,
    actorName: session!.user.name,
    metadata: { voucherNumber },
  });

  return NextResponse.json({ success: true });
}
