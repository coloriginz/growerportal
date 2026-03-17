import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveGrowerId } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const params = request.nextUrl.searchParams;
  const requestedGrowerId = params.get("growerId");
  const growerId = resolveGrowerId(session!, requestedGrowerId);

  if (!growerId) {
    // Aggregate view for admin/commercie
    const [pendingCount, approvedCount, deliveredCount] = await Promise.all([
      prisma.fustOrder.count({ where: { status: "pending" } }),
      prisma.fustOrder.count({ where: { status: "approved" } }),
      prisma.fustOrder.count({ where: { status: "delivered" } }),
    ]);

    return NextResponse.json({
      pendingOrders: pendingCount,
      approvedOrders: approvedCount,
      deliveredOrders: deliveredCount,
    });
  }

  const [pendingOrders, recentOrders, recentDeliveries, openCharges] = await Promise.all([
    prisma.fustOrder.count({
      where: { growerId, status: { in: ["pending", "approved", "scheduled"] } },
    }),
    prisma.fustOrder.findMany({
      where: { growerId },
      include: {
        items: { include: { fustType: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.fustDelivery.findMany({
      where: { order: { growerId }, status: "delivered" },
      include: {
        order: { select: { orderNumber: true } },
        items: { include: { fustType: true } },
      },
      orderBy: { deliveredAt: "desc" },
      take: 5,
    }),
    prisma.fustGrowerCharge.aggregate({
      where: { growerId, status: "pending" },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  return NextResponse.json({
    pendingOrders,
    recentOrders,
    recentDeliveries,
    openCharges: {
      count: openCharges._count,
      total: openCharges._sum.amount || 0,
    },
  });
}
