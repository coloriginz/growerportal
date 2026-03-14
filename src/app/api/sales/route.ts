import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveGrowerId } from "@/lib/api-helpers";
import { startOfDay, subDays, startOfWeek, startOfMonth, startOfYear, format } from "date-fns";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const params = request.nextUrl.searchParams;
  const requestedGrowerId = params.get("growerId");
  const period = params.get("period") || "ytd";
  const growerId = resolveGrowerId(session!, requestedGrowerId);

  if (!growerId) {
    return NextResponse.json({
      totalStems: 0, totalTurnover: 0, avgPrice: 0,
      bySalesType: [], byProduct: [], daily: [],
    });
  }

  const now = new Date();
  let dateFrom: Date;

  switch (period) {
    case "today":
      dateFrom = startOfDay(now);
      break;
    case "yesterday":
      dateFrom = startOfDay(subDays(now, 1));
      break;
    case "week":
      dateFrom = startOfWeek(now, { weekStartsOn: 1 });
      break;
    case "month":
      dateFrom = startOfMonth(now);
      break;
    case "ytd":
    default:
      dateFrom = startOfYear(now);
      break;
  }

  const dateFilter = period === "yesterday"
    ? { gte: dateFrom, lt: startOfDay(now) }
    : { gte: dateFrom };

  const baseWhere = {
    lot: { growerId },
    isCorrection: false,
    date: dateFilter,
  };

  // Totals
  const totals = await prisma.transaction.aggregate({
    where: baseWhere,
    _sum: { stems: true, amount: true },
  });

  const totalStems = totals._sum.stems || 0;
  const totalTurnover = Number(totals._sum.amount) || 0;

  // By sales type
  const bySalesType = await prisma.transaction.groupBy({
    by: ["salesType"],
    where: baseWhere,
    _sum: { stems: true, amount: true },
    orderBy: { _sum: { stems: "desc" } },
  });

  // By product (via lot)
  const byLot = await prisma.transaction.groupBy({
    by: ["lotId"],
    where: baseWhere,
    _sum: { stems: true, amount: true },
  });

  const lotIds = byLot.map((b: { lotId: string; _sum: { stems: number | null; amount: unknown } }) => b.lotId);
  const lots = await prisma.lot.findMany({
    where: { id: { in: lotIds } },
    select: { id: true, productName: true },
  });
  const lotMap = new Map(lots.map((l: { id: string; productName: string }) => [l.id, l.productName]));

  const productMap = new Map<string, { stems: number; turnover: number }>();
  for (const b of byLot) {
    const product = (lotMap.get(b.lotId) as string) || "Other";
    const existing = productMap.get(product) || { stems: 0, turnover: 0 };
    existing.stems += b._sum.stems || 0;
    existing.turnover += Number(b._sum.amount) || 0;
    productMap.set(product, existing);
  }

  // Daily breakdown
  const transactions = await prisma.transaction.findMany({
    where: baseWhere,
    select: { date: true, stems: true, amount: true },
    orderBy: { date: "asc" },
  });

  const dailyMap = new Map<string, { stems: number; turnover: number }>();
  for (const tx of transactions) {
    const day = format(tx.date, "dd-MM");
    const existing = dailyMap.get(day) || { stems: 0, turnover: 0 };
    existing.stems += tx.stems;
    existing.turnover += Number(tx.amount);
    dailyMap.set(day, existing);
  }

  return NextResponse.json({
    totalStems,
    totalTurnover,
    avgPrice: totalStems > 0 ? totalTurnover / totalStems : 0,
    bySalesType: bySalesType.map((b: { salesType: string; _sum: { stems: number | null; amount: unknown } }) => ({
      salesType: b.salesType,
      stems: b._sum.stems || 0,
      turnover: Number(b._sum.amount) || 0,
      avgPrice: (b._sum.stems || 0) > 0 ? Number(b._sum.amount) / (b._sum.stems || 1) : 0,
    })),
    byProduct: Array.from(productMap.entries())
      .map(([product, data]) => ({
        product,
        ...data,
        avgPrice: data.stems > 0 ? data.turnover / data.stems : 0,
      }))
      .sort((a, b) => b.stems - a.stems),
    daily: Array.from(dailyMap.entries()).map(([date, data]) => ({
      date,
      ...data,
    })),
  });
}
