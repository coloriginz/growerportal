import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

const patchSchema = z.object({
  status: z.enum(["approved", "rejected", "scheduled", "in_transit", "delivered", "cancelled"]),
  rejectionReason: z.string().optional().nullable(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const { id } = await params;

  const order = await prisma.fustOrder.findUnique({
    where: { id },
    include: {
      items: { include: { fustType: true } },
      grower: { select: { id: true, code: true, name: true, company: true } },
      delivery: {
        include: {
          items: { include: { fustType: true } },
          pickup: { select: { id: true, pickupDate: true, transporter: { select: { name: true } } } },
        },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Growers can only see their own orders
  if (session!.user.role === "grower" && order.growerId !== session!.user.growerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(order);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["commercie", "admin", "transporteur"]);
  if (error) return error;

  const { id } = await params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const order = await prisma.fustOrder.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { status, rejectionReason } = parsed.data;
  const role = session!.user.role;

  // Validate status transitions per role
  if (role === "commercie" || role === "admin") {
    if (!["approved", "rejected", "cancelled"].includes(status)) {
      return NextResponse.json({ error: "Invalid status transition" }, { status: 400 });
    }
    if (status === "rejected" && !rejectionReason) {
      return NextResponse.json({ error: "Rejection reason is required" }, { status: 400 });
    }
  } else if (role === "transporteur") {
    if (!["scheduled", "in_transit", "delivered"].includes(status)) {
      return NextResponse.json({ error: "Invalid status transition" }, { status: 400 });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = { status };

  if (status === "approved") {
    updateData.approvedById = session!.user.id;
    updateData.approvedAt = new Date();
  }
  if (status === "rejected") {
    updateData.rejectionReason = rejectionReason;
  }
  if (status === "delivered") {
    // Create or update delivery record
    await prisma.fustDelivery.upsert({
      where: { orderId: id },
      create: {
        orderId: id,
        status: "delivered",
        deliveredAt: new Date(),
      },
      update: {
        status: "delivered",
        deliveredAt: new Date(),
      },
    });
  }

  const updated = await prisma.fustOrder.update({
    where: { id },
    data: updateData,
    include: {
      items: { include: { fustType: true } },
      grower: { select: { id: true, code: true, name: true } },
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["grower", "admin"]);
  if (error) return error;

  const { id } = await params;

  const order = await prisma.fustOrder.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.status !== "pending") {
    return NextResponse.json({ error: "Only pending orders can be deleted" }, { status: 400 });
  }

  // Growers can only delete their own orders
  if (session!.user.role === "grower" && order.growerId !== session!.user.growerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.fustOrder.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
