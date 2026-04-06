import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { logFustEvent } from "@/lib/fust-audit";

const chargeSchema = z.object({
  growerId: z.string().uuid(),
  amount: z.number().positive(),
  description: z.string().optional().nullable(),
});

const createChargesSchema = z.object({
  charges: z.array(chargeSchema).min(1),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["finance", "admin"]);
  if (error) return error;
  void session;

  const { id } = await params;

  const charges = await prisma.fustGrowerCharge.findMany({
    where: { invoiceId: id },
    include: {
      grower: { select: { id: true, code: true, name: true, company: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(charges);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["finance", "admin"]);
  if (error) return error;

  const { id } = await params;

  // Verify invoice exists
  const invoice = await prisma.fustInvoice.findUnique({ where: { id } });
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = createChargesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Verify all growers exist
  const growerIds = parsed.data.charges.map((c) => c.growerId);
  const growers = await prisma.grower.findMany({
    where: { id: { in: growerIds } },
    select: { id: true },
  });
  const existingIds = new Set(growers.map((g) => g.id));
  const missingIds = growerIds.filter((id) => !existingIds.has(id));
  if (missingIds.length > 0) {
    return NextResponse.json(
      { error: `Grower(s) not found: ${missingIds.join(", ")}` },
      { status: 400 }
    );
  }

  // Create charges and update invoice status in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const charges = await Promise.all(
      parsed.data.charges.map((charge) =>
        tx.fustGrowerCharge.create({
          data: {
            invoiceId: id,
            growerId: charge.growerId,
            amount: charge.amount,
            description: charge.description ?? null,
          },
          include: {
            grower: { select: { id: true, code: true, name: true, company: true } },
          },
        })
      )
    );

    // Update invoice status to "charged"
    await tx.fustInvoice.update({
      where: { id },
      data: { status: "charged" },
    });

    return charges;
  });

  // Audit: charges created
  await logFustEvent({
    entityType: "invoice",
    entityId: id,
    action: "invoice_charges_created",
    actorId: session!.user.id,
    actorName: session!.user.name,
    metadata: {
      chargeCount: result.length,
      totalAmount: parsed.data.charges.reduce((sum, c) => sum + c.amount, 0),
      growerIds: growerIds,
    },
  });

  return NextResponse.json(result, { status: 201 });
}
