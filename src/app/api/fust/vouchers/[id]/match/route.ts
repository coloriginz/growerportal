import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

const matchSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1),
});

const unmatchSchema = z.object({
  orderId: z.string().uuid(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["finance", "admin"]);
  if (error) return error;
  void session;

  const { id } = await params;

  const body = await request.json();
  const parsed = matchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Verify voucher exists
  const voucher = await prisma.fustIssuanceVoucher.findUnique({
    where: { id },
  });
  if (!voucher) {
    return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
  }

  // Create links, skipping duplicates
  const { orderIds } = parsed.data;
  for (const orderId of orderIds) {
    await prisma.fustVoucherOrderLink.upsert({
      where: {
        voucherId_orderId: { voucherId: id, orderId },
      },
      create: { voucherId: id, orderId },
      update: {},
    });
  }

  // Return updated voucher
  const updated = await prisma.fustIssuanceVoucher.findUnique({
    where: { id },
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
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["finance", "admin"]);
  if (error) return error;
  void session;

  const { id } = await params;

  const body = await request.json();
  const parsed = unmatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { orderId } = parsed.data;

  // Delete the link
  await prisma.fustVoucherOrderLink.deleteMany({
    where: { voucherId: id, orderId },
  });

  return NextResponse.json({ success: true });
}
