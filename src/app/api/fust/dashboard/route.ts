import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveSupplierId } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const params = request.nextUrl.searchParams;
  const requestedSupplierId = params.get("supplierId");
  const supplierId = resolveSupplierId(session!, requestedSupplierId);

  if (!supplierId) {
    // Aggregate view for admin/commercie
    const [pendingCount, approvedCount, deliveredCount] = await Promise.all([
      prisma.fustOrder.count({ where: { status: "pending", deletedAt: null } }),
      prisma.fustOrder.count({ where: { status: "approved", deletedAt: null } }),
      prisma.fustOrder.count({ where: { status: "delivered", deletedAt: null } }),
    ]);

    return NextResponse.json({
      pendingOrders: pendingCount,
      approvedOrders: approvedCount,
      deliveredOrders: deliveredCount,
    });
  }

  const [pendingOrders, recentOrders, recentDeliveries, openCharges] = await Promise.all([
    prisma.fustOrder.count({
      where: { supplierId, status: { in: ["pending", "approved", "scheduled"] }, deletedAt: null },
    }),
    prisma.fustOrder.findMany({
      where: { supplierId, deletedAt: null },
      include: {
        items: { include: { fustType: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.fustDelivery.findMany({
      where: { order: { supplierId }, status: "delivered" },
      include: {
        order: { select: { orderNumber: true } },
        items: { include: { fustType: true } },
      },
      orderBy: { deliveredAt: "desc" },
      take: 5,
    }),
    prisma.fustGrowerCharge.aggregate({
      where: { supplierId, status: "pending" },
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
