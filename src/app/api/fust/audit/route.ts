import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const params = request.nextUrl.searchParams;
  const orderId = params.get("orderId");
  const entityType = params.get("entityType");
  const action = params.get("action");
  const actorId = params.get("actorId");
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");
  const page = Math.max(1, parseInt(params.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") || "50", 10)));

  const role = session!.user.role;

  // Suppliers can only view audit logs for their own orders
  if (role === "supplier") {
    if (!orderId) {
      return NextResponse.json({ error: "orderId is required for suppliers" }, { status: 400 });
    }
    // Verify order belongs to supplier
    const order = await prisma.fustOrder.findFirst({
      where: { id: orderId, supplierId: session!.user.supplierId! },
      select: { id: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
  }

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (orderId) where.orderId = orderId;
  if (entityType) where.entityType = entityType;
  if (action) where.action = action;
  if (actorId) where.actorId = actorId;

  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) {
      const to = new Date(dateTo);
      to.setDate(to.getDate() + 1);
      where.createdAt.lt = to;
    }
  }

  const [events, total] = await Promise.all([
    prisma.fustAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.fustAuditLog.count({ where }),
  ]);

  return NextResponse.json({
    events,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
