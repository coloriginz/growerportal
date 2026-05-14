import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint");
  const status = searchParams.get("status");
  const limitParam = searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam || "50", 10) || 50, 1), 200);
  const pageParam = searchParams.get("page");
  const page = Math.max(parseInt(pageParam || "1", 10) || 1, 1);

  // Build where clause
  const where: Record<string, unknown> = {};
  if (endpoint) where.endpoint = endpoint;
  if (status) where.status = status;

  // Fetch batches with offset pagination
  const batches = await prisma.importBatch.findMany({
    where,
    orderBy: { startedAt: "desc" },
    skip: (page - 1) * limit,
    take: limit,
  });

  // Summary KPIs: last successful import per endpoint
  const lastSuccessful = await prisma.importBatch.findMany({
    where: { status: "success" },
    orderBy: { startedAt: "desc" },
    distinct: ["endpoint"],
    select: {
      endpoint: true,
      startedAt: true,
      completedAt: true,
    },
  });

  // Error count last 24h
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const errors24h = await prisma.importBatch.count({
    where: {
      status: "error",
      startedAt: { gte: twentyFourHoursAgo },
    },
  });

  // Total batch count (with filters)
  const totalBatches = await prisma.importBatch.count({ where });

  const totalPages = Math.max(Math.ceil(totalBatches / limit), 1);

  return NextResponse.json({
    batches,
    page,
    totalPages,
    summary: {
      totalBatches,
      errors24h,
      lastSuccessful: lastSuccessful.reduce(
        (acc, item) => {
          acc[item.endpoint] = item.completedAt || item.startedAt;
          return acc;
        },
        {} as Record<string, Date>
      ),
    },
  });
}
