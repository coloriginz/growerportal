import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth, resolveSupplierId } from "@/lib/api-helpers";
import { sendOrderApprovedNotification } from "@/lib/fust-notifications";
import { logFustEvent } from "@/lib/fust-audit";
import { isTest } from "@/lib/env";

const orderItemSchema = z.object({
  fustTypeId: z.string().uuid(),
  quantity: z.number().int().min(1),
});

const createOrderSchema = z.object({
  supplierId: z.string().uuid().optional(),
  requestedDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(orderItemSchema).min(1),
});

async function generateOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `FO-${year}-`;

  const lastOrder = await prisma.fustOrder.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });

  if (lastOrder) {
    const lastNum = parseInt(lastOrder.orderNumber.replace(prefix, ""), 10);
    return `${prefix}${String(lastNum + 1).padStart(4, "0")}`;
  }

  return `${prefix}0001`;
}

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const params = request.nextUrl.searchParams;
  const role = session!.user.role;
  const requestedSupplierId = params.get("supplierId");
  const status = params.get("status");

  // Build where clause based on role
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { deletedAt: null };

  if (role === "supplier") {
    where.supplierId = session!.user.supplierId;
  } else if (role === "transporteur") {
    // Transporteur sees only orders for suppliers assigned to them
    const transporterId = session!.user.transporterId;
    if (transporterId) {
      where.supplier = { defaultTransporterId: transporterId };
    }
    where.status = { in: ["approved", "delivered"] };
  } else if (role === "finance") {
    // Finance sees only delivered orders
    where.status = "delivered";
    if (requestedSupplierId) {
      where.supplierId = requestedSupplierId;
    }
  } else {
    // commercie/admin - can filter by supplier
    if (requestedSupplierId) {
      where.supplierId = requestedSupplierId;
    }
  }

  if (status) {
    where.status = status;
  }

  const orders = await prisma.fustOrder.findMany({
    where,
    include: {
      items: {
        include: { fustType: true },
      },
      supplier: { select: { id: true, code: true, name: true, company: true } },
      delivery: {
        select: {
          id: true,
          status: true,
          deliveredAt: true,
          items: { include: { fustType: true } },
        },
      },
      voucherLinks: {
        include: {
          voucher: {
            select: { id: true, transactionNumber: true, type: true, transactionDate: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(orders);
}

export async function POST(request: NextRequest) {
  const { error, session } = await requireAuth(["supplier", "commercie", "admin"]);
  if (error) return error;

  const body = await request.json();
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { requestedDate, notes, items } = parsed.data;
  const supplierId = resolveSupplierId(session!, parsed.data.supplierId || null);

  if (!supplierId) {
    return NextResponse.json({ error: "supplierId is required" }, { status: 400 });
  }

  // Verify supplier has fust enabled and check auto-approve
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { fustEnabled: true, autoApproveOrders: true },
  });

  if (!supplier?.fustEnabled) {
    return NextResponse.json({ error: "Fust ordering is not enabled for this supplier" }, { status: 403 });
  }

  const orderNumber = await generateOrderNumber();

  const order = await prisma.fustOrder.create({
    data: {
      orderNumber,
      supplierId,
      requestedDate: requestedDate ? new Date(requestedDate) : null,
      notes,
      createdById: session!.user.id,
      // Auto-approve if supplier setting is enabled
      ...(supplier.autoApproveOrders
        ? { status: "approved", approvedAt: new Date(), approvedById: session!.user.id }
        : {}),
      items: {
        create: items.map((item) => ({
          fustTypeId: item.fustTypeId,
          quantity: item.quantity,
        })),
      },
    },
    include: {
      items: { include: { fustType: true } },
      supplier: { select: { id: true, code: true, name: true } },
    },
  });

  // Audit: order created
  await logFustEvent({
    entityType: "order",
    entityId: order.id,
    orderId: order.id,
    action: "order_created",
    actorId: session!.user.id,
    actorName: session!.user.name,
    metadata: { orderNumber: order.orderNumber, supplierId, itemCount: items.length },
  });

  // Audit: auto-approved
  if (supplier.autoApproveOrders) {
    await logFustEvent({
      entityType: "order",
      entityId: order.id,
      orderId: order.id,
      action: "order_auto_approved",
      actorId: null,
      actorName: null,
      metadata: { orderNumber: order.orderNumber },
    });
  }

  // Send transporter notification if auto-approved
  let previewUrl: string | false = false;
  if (supplier.autoApproveOrders) {
    if (isTest) {
      try {
        previewUrl = await sendOrderApprovedNotification(order.id);
      } catch (err) {
        console.error("[FustOrders] Failed to send auto-approve notification:", err);
      }
    } else {
      sendOrderApprovedNotification(order.id).catch((err) => {
        console.error("[FustOrders] Failed to send auto-approve notification:", err);
      });
    }
  }

  return NextResponse.json({
    ...order,
    ...(previewUrl && { previewUrl }),
  }, { status: 201 });
}
