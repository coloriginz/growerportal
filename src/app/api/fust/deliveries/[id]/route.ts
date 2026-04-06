import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { logFustEvent } from "@/lib/fust-audit";

const deliveryItemSchema = z.object({
  fustTypeId: z.string().uuid(),
  quantity: z.number().int().min(0),
});

const updateDeliverySchema = z.object({
  status: z.enum(["in_transit", "delivered"]).optional(),
  items: z.array(deliveryItemSchema).optional(),
  notes: z.string().optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["transporteur", "admin"]);
  if (error) return error;

  const { id } = await params;

  const body = await request.json();
  const parsed = updateDeliverySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { status, items, notes } = parsed.data;

  // Verify delivery exists
  const delivery = await prisma.fustDelivery.findUnique({
    where: { id },
    include: {
      pickup: true,
      order: true,
    },
  });

  if (!delivery) {
    return NextResponse.json({ error: "Delivery not found" }, { status: 404 });
  }

  // For transporteur, verify they own the pickup
  if (session!.user.role === "transporteur" && delivery.pickup) {
    const transporterId = session!.user.transporterId
      || (await prisma.user.findUnique({ where: { id: session!.user.id }, select: { transporterId: true } }))?.transporterId;
    if (delivery.pickup.transporterId !== transporterId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Build update data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = {};
  if (status) updateData.status = status;
  if (notes !== undefined) updateData.notes = notes;

  if (status === "delivered") {
    updateData.deliveredAt = new Date();
  }

  // Update delivery
  await prisma.fustDelivery.update({
    where: { id },
    data: updateData,
  });

  // Create/update delivery items if provided
  if (items && items.length > 0) {
    for (const item of items) {
      await prisma.fustDeliveryItem.upsert({
        where: {
          deliveryId_fustTypeId: {
            deliveryId: id,
            fustTypeId: item.fustTypeId,
          },
        },
        update: { quantity: item.quantity },
        create: {
          deliveryId: id,
          fustTypeId: item.fustTypeId,
          quantity: item.quantity,
        },
      });
    }
  }

  // When delivered, update the linked FustOrder status
  if (status === "delivered") {
    await prisma.fustOrder.update({
      where: { id: delivery.orderId },
      data: { status: "delivered" },
    });

    // Audit: delivery delivered
    await logFustEvent({
      entityType: "delivery",
      entityId: id,
      orderId: delivery.orderId,
      action: "delivery_delivered",
      actorId: session!.user.id,
      actorName: session!.user.name,
      metadata: { pickupId: delivery.pickupId },
    });

    // If all deliveries in the pickup are delivered, mark pickup as completed
    if (delivery.pickupId) {
      const siblingDeliveries = await prisma.fustDelivery.findMany({
        where: { pickupId: delivery.pickupId },
      });
      const allDelivered = siblingDeliveries.every(
        (d) => d.id === id || d.status === "delivered"
      );
      if (allDelivered) {
        await prisma.fustPickup.update({
          where: { id: delivery.pickupId },
          data: { status: "completed" },
        });

        // Audit: pickup completed
        await logFustEvent({
          entityType: "pickup",
          entityId: delivery.pickupId,
          action: "pickup_completed",
          actorId: session!.user.id,
          actorName: session!.user.name,
        });
      }
    }
  }

  // Refetch with full includes
  const result = await prisma.fustDelivery.findUnique({
    where: { id },
    include: {
      order: {
        include: {
          items: { include: { fustType: true } },
          grower: { select: { id: true, code: true, name: true, company: true } },
        },
      },
      items: { include: { fustType: true } },
      pickup: { select: { id: true, status: true, pickupDate: true } },
    },
  });

  return NextResponse.json(result);
}
