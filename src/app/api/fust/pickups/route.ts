import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

const createPickupSchema = z.object({
  pickupDate: z.string(),
  notes: z.string().optional().nullable(),
  orderIds: z.array(z.string().uuid()).optional(),
});

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const date = params.get("date");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  // For transporteur role, get their transporterId
  if (session!.user.role === "transporteur") {
    const user = await prisma.user.findUnique({
      where: { id: session!.user.id },
      select: { transporterId: true },
    });
    if (user?.transporterId) {
      where.transporterId = user.transporterId;
    } else {
      return NextResponse.json([]);
    }
  }

  if (status) {
    where.status = status;
  }

  if (date) {
    const d = new Date(date);
    const nextDay = new Date(d);
    nextDay.setDate(nextDay.getDate() + 1);
    where.pickupDate = { gte: d, lt: nextDay };
  }

  const pickups = await prisma.fustPickup.findMany({
    where,
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
    orderBy: { pickupDate: "desc" },
  });

  return NextResponse.json(pickups);
}

export async function POST(request: NextRequest) {
  const { error, session } = await requireAuth(["transporteur", "admin"]);
  if (error) return error;

  const body = await request.json();
  const parsed = createPickupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { pickupDate, notes, orderIds } = parsed.data;

  // Determine transporterId
  let transporterId: string | undefined;
  if (session!.user.role === "transporteur") {
    const user = await prisma.user.findUnique({
      where: { id: session!.user.id },
      select: { transporterId: true },
    });
    transporterId = user?.transporterId ?? undefined;
  } else {
    // Admin - use the first active transporter (or require it in body in future)
    const transporter = await prisma.transporter.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    transporterId = transporter?.id;
  }

  if (!transporterId) {
    return NextResponse.json(
      { error: "No transporter linked to this account" },
      { status: 400 }
    );
  }

  const pickup = await prisma.fustPickup.create({
    data: {
      transporterId,
      pickupDate: new Date(pickupDate),
      notes,
    },
  });

  // If orderIds provided, create FustDelivery records linking orders to this pickup
  if (orderIds && orderIds.length > 0) {
    for (const orderId of orderIds) {
      // Check if delivery already exists for this order
      const existing = await prisma.fustDelivery.findUnique({
        where: { orderId },
      });

      if (existing) {
        // Link existing delivery to this pickup
        await prisma.fustDelivery.update({
          where: { id: existing.id },
          data: { pickupId: pickup.id },
        });
      } else {
        // Create new delivery
        await prisma.fustDelivery.create({
          data: {
            orderId,
            pickupId: pickup.id,
            status: "pending",
          },
        });
      }

      // Update order status to scheduled
      await prisma.fustOrder.update({
        where: { id: orderId },
        data: { status: "scheduled" },
      });
    }
  }

  // Refetch with includes
  const result = await prisma.fustPickup.findUnique({
    where: { id: pickup.id },
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

  return NextResponse.json(result, { status: 201 });
}
