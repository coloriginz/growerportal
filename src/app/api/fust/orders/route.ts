import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth, resolveGrowerId } from "@/lib/api-helpers";
import { sendOrderApprovedNotification } from "@/lib/fust-notifications";

const orderItemSchema = z.object({
  fustTypeId: z.string().uuid(),
  quantity: z.number().int().min(1),
});

const createOrderSchema = z.object({
  growerId: z.string().uuid().optional(),
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
  const requestedGrowerId = params.get("growerId");
  const status = params.get("status");

  // Build where clause based on role
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (role === "grower") {
    where.growerId = session!.user.growerId;
  } else if (role === "transporteur") {
    // Transporteur sees only orders for growers assigned to them
    const transporterId = session!.user.transporterId;
    if (transporterId) {
      where.grower = { defaultTransporterId: transporterId };
    }
    where.status = { in: ["approved", "delivered"] };
  } else if (role === "finance") {
    // Finance sees only delivered orders
    where.status = "delivered";
    if (requestedGrowerId) {
      where.growerId = requestedGrowerId;
    }
  } else {
    // commercie/admin - can filter by grower
    if (requestedGrowerId) {
      where.growerId = requestedGrowerId;
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
      grower: { select: { id: true, code: true, name: true, company: true } },
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
  const { error, session } = await requireAuth(["grower", "commercie", "admin"]);
  if (error) return error;

  const body = await request.json();
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { requestedDate, notes, items } = parsed.data;
  const growerId = resolveGrowerId(session!, parsed.data.growerId || null);

  if (!growerId) {
    return NextResponse.json({ error: "growerId is required" }, { status: 400 });
  }

  // Verify grower has fust enabled and check auto-approve
  const grower = await prisma.grower.findUnique({
    where: { id: growerId },
    select: { fustEnabled: true, autoApproveOrders: true },
  });

  if (!grower?.fustEnabled) {
    return NextResponse.json({ error: "Fust ordering is not enabled for this grower" }, { status: 403 });
  }

  const orderNumber = await generateOrderNumber();

  const order = await prisma.fustOrder.create({
    data: {
      orderNumber,
      growerId,
      requestedDate: requestedDate ? new Date(requestedDate) : null,
      notes,
      createdById: session!.user.id,
      // Auto-approve if grower setting is enabled
      ...(grower.autoApproveOrders
        ? { status: "approved", approvedAt: new Date() }
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
      grower: { select: { id: true, code: true, name: true } },
    },
  });

  // Send transporter notification if auto-approved
  let previewUrl: string | false = false;
  if (grower.autoApproveOrders) {
    try {
      previewUrl = await sendOrderApprovedNotification(order.id);
    } catch (err) {
      console.error("[FustOrders] Failed to send auto-approve notification:", err);
    }
  }

  return NextResponse.json({
    ...order,
    ...(previewUrl && { previewUrl }),
  }, { status: 201 });
}
