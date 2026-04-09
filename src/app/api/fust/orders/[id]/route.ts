import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { sendOrderApprovedNotification } from "@/lib/fust-notifications";
import { logFustEvent } from "@/lib/fust-audit";
import { isTest } from "@/lib/env";

const deliveryItemSchema = z.object({
  fustTypeId: z.string().uuid(),
  deliveredQuantity: z.number().int().min(0),
});

const patchSchema = z.object({
  status: z.enum(["approved", "rejected", "scheduled", "in_transit", "delivered", "cancelled"]),
  rejectionReason: z.string().optional().nullable(),
  items: z.array(deliveryItemSchema).optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const { id } = await params;

  const order = await prisma.fustOrder.findFirst({
    where: { id, deletedAt: null },
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

  const order = await prisma.fustOrder.findFirst({ where: { id, deletedAt: null } });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { status, rejectionReason, items } = parsed.data;
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
    updateData.deliveredAt = new Date();
    updateData.deliveredById = session!.user.id;

    // Update deliveredQuantity on order items
    if (items && items.length > 0) {
      for (const item of items) {
        await prisma.fustOrderItem.updateMany({
          where: { orderId: id, fustTypeId: item.fustTypeId },
          data: { deliveredQuantity: item.deliveredQuantity },
        });
      }
    } else {
      // No items provided: set deliveredQuantity = quantity for each item
      const orderItems = await prisma.fustOrderItem.findMany({
        where: { orderId: id },
      });
      for (const oi of orderItems) {
        await prisma.fustOrderItem.update({
          where: { id: oi.id },
          data: { deliveredQuantity: oi.quantity },
        });
      }
    }
  }

  const updated = await prisma.fustOrder.update({
    where: { id },
    data: updateData,
    include: {
      items: { include: { fustType: true } },
      grower: { select: { id: true, code: true, name: true } },
    },
  });

  // Audit: status change
  const actionMap: Record<string, string> = {
    approved: "order_approved",
    rejected: "order_rejected",
    cancelled: "order_cancelled",
  };
  const auditAction = actionMap[status];
  if (auditAction) {
    await logFustEvent({
      entityType: "order",
      entityId: id,
      orderId: id,
      action: auditAction as "order_approved" | "order_rejected" | "order_cancelled",
      actorId: session!.user.id,
      actorName: session!.user.name,
      metadata: {
        orderNumber: order.orderNumber,
        status,
        ...(rejectionReason ? { rejectionReason } : {}),
      },
    });
  }

  // Send transporter notification on approval
  let previewUrl: string | false = false;
  if (status === "approved") {
    if (isTest) {
      // In test mode: await to get Ethereal preview URL
      try {
        previewUrl = await sendOrderApprovedNotification(id);
      } catch (err) {
        console.error("[FustOrders] Failed to send approval notification:", err);
      }
    } else {
      // Production: fire-and-forget for fast response
      sendOrderApprovedNotification(id).catch((err) => {
        console.error("[FustOrders] Failed to send approval notification:", err);
      });
    }
  }

  return NextResponse.json({
    ...updated,
    ...(previewUrl && { previewUrl }),
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["grower", "admin"]);
  if (error) return error;

  const { id } = await params;

  const order = await prisma.fustOrder.findFirst({ where: { id, deletedAt: null } });
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

  await prisma.fustOrder.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: session!.user.id },
  });

  // Audit: order deleted
  await logFustEvent({
    entityType: "order",
    entityId: id,
    orderId: id,
    action: "order_deleted",
    actorId: session!.user.id,
    actorName: session!.user.name,
    metadata: { orderNumber: order.orderNumber },
  });

  return NextResponse.json({ success: true });
}
