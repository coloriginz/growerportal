import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

const updatePickupSchema = z.object({
  status: z.enum(["picked_up", "completed"]).optional(),
  rfhReference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  orderIds: z.array(z.string().uuid()).optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await params;

  const pickup = await prisma.fustPickup.findUnique({
    where: { id },
    include: {
      transporter: { select: { id: true, name: true } },
      deliveries: {
        include: {
          order: {
            include: {
              items: { include: { fustType: true } },
              grower: { select: { id: true, code: true, name: true, company: true } },
            },
          },
          items: { include: { fustType: true } },
        },
      },
    },
  });

  if (!pickup) {
    return NextResponse.json({ error: "Pickup not found" }, { status: 404 });
  }

  return NextResponse.json(pickup);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["transporteur", "admin"]);
  if (error) return error;

  const { id } = await params;

  const body = await request.json();
  const parsed = updatePickupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { status, rfhReference, notes, orderIds } = parsed.data;

  // Verify pickup exists
  const pickup = await prisma.fustPickup.findUnique({
    where: { id },
    include: {
      deliveries: {
        include: { order: true },
      },
    },
  });

  if (!pickup) {
    return NextResponse.json({ error: "Pickup not found" }, { status: 404 });
  }

  // For transporteur, verify they own this pickup
  if (session!.user.role === "transporteur") {
    const user = await prisma.user.findUnique({
      where: { id: session!.user.id },
      select: { transporterId: true },
    });
    if (pickup.transporterId !== user?.transporterId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Build update data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = {};
  if (status) updateData.status = status;
  if (rfhReference !== undefined) updateData.rfhReference = rfhReference;
  if (notes !== undefined) updateData.notes = notes;

  // Update pickup
  await prisma.fustPickup.update({
    where: { id },
    data: updateData,
  });

  // Handle status transitions
  if (status === "picked_up") {
    // Update all linked deliveries to in_transit, and their orders to in_transit
    for (const delivery of pickup.deliveries) {
      await prisma.fustDelivery.update({
        where: { id: delivery.id },
        data: { status: "in_transit" },
      });
      await prisma.fustOrder.update({
        where: { id: delivery.orderId },
        data: { status: "in_transit" },
      });
    }
  } else if (status === "completed") {
    // Check if all deliveries are delivered; if so, mark orders as delivered
    const deliveries = await prisma.fustDelivery.findMany({
      where: { pickupId: id },
    });
    const allDelivered = deliveries.every((d) => d.status === "delivered");
    if (allDelivered) {
      for (const delivery of deliveries) {
        await prisma.fustOrder.update({
          where: { id: delivery.orderId },
          data: { status: "delivered" },
        });
      }
    }
  }

  // If new orderIds provided, link them
  if (orderIds && orderIds.length > 0) {
    for (const orderId of orderIds) {
      const existing = await prisma.fustDelivery.findUnique({
        where: { orderId },
      });

      if (existing) {
        await prisma.fustDelivery.update({
          where: { id: existing.id },
          data: { pickupId: id },
        });
      } else {
        await prisma.fustDelivery.create({
          data: {
            orderId,
            pickupId: id,
            status: "pending",
          },
        });
      }

      // Update order status to scheduled if it's still approved
      await prisma.fustOrder.update({
        where: { id: orderId },
        data: { status: "scheduled" },
      });
    }
  }

  // Refetch with full includes
  const result = await prisma.fustPickup.findUnique({
    where: { id },
    include: {
      transporter: { select: { id: true, name: true } },
      deliveries: {
        include: {
          order: {
            include: {
              items: { include: { fustType: true } },
              grower: { select: { id: true, code: true, name: true, company: true } },
            },
          },
          items: { include: { fustType: true } },
        },
      },
    },
  });

  return NextResponse.json(result);
}
