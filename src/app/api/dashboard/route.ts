import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveGrowerId } from "@/lib/api-helpers";
import {
  startOfDay,
  subDays,
  startOfYear,
  subYears,
  format,
} from "date-fns";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const requestedGrowerId = request.nextUrl.searchParams.get("growerId");
  const growerId = resolveGrowerId(session!, requestedGrowerId);

  if (!growerId) {
    return NextResponse.json({
      stemsToday: 0,
      stemsYesterday: 0,
      stemsYTD: 0,
      stemsYTDLastYear: 0,
      turnoverYTD: 0,
      turnoverYTDLastYear: 0,
      avgPriceYTD: 0,
      avgPriceYTDLastYear: 0,
      monthlySales: [],
      topProducts: [],
    });
  }

  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = startOfDay(subDays(now, 1));
  const ytdStart = startOfYear(now);
  const lastYearYtdStart = startOfYear(subYears(now, 1));
  const lastYearSameDate = subYears(now, 1);

  const growerFilter = { lot: { growerId } };
  const notCorrection = { isCorrection: false };

  // Today's stems
  const todayAgg = await prisma.transaction.aggregate({
    where: {
      ...growerFilter,
      ...notCorrection,
      date: { gte: todayStart },
    },
    _sum: { stems: true, amount: true },
  });

  // Yesterday's stems
  const yesterdayAgg = await prisma.transaction.aggregate({
    where: {
      ...growerFilter,
      ...notCorrection,
      date: { gte: yesterdayStart, lt: todayStart },
    },
    _sum: { stems: true },
  });

  // YTD
  const ytdAgg = await prisma.transaction.aggregate({
    where: {
      ...growerFilter,
      ...notCorrection,
      date: { gte: ytdStart },
    },
    _sum: { stems: true, amount: true },
  });

  // Last year YTD (same period)
  const lastYearYtdAgg = await prisma.transaction.aggregate({
    where: {
      ...growerFilter,
      ...notCorrection,
      date: { gte: lastYearYtdStart, lte: lastYearSameDate },
    },
    _sum: { stems: true, amount: true },
  });

  const stemsYTD = ytdAgg._sum.stems || 0;
  const turnoverYTD = Number(ytdAgg._sum.amount) || 0;
  const stemsYTDLastYear = lastYearYtdAgg._sum.stems || 0;
  const turnoverYTDLastYear = Number(lastYearYtdAgg._sum.amount) || 0;

  // Monthly sales (current year + last year)
  const monthlySales = [];
  for (let month = 0; month < 12; month++) {
    const monthStart = new Date(now.getFullYear(), month, 1);
    const monthEnd = new Date(now.getFullYear(), month + 1, 1);
    const lastYearMonthStart = new Date(now.getFullYear() - 1, month, 1);
    const lastYearMonthEnd = new Date(now.getFullYear() - 1, month + 1, 1);

    if (monthStart > now) break;

    const [current, lastYear] = await Promise.all([
      prisma.transaction.aggregate({
        where: {
          ...growerFilter,
          ...notCorrection,
          date: { gte: monthStart, lt: monthEnd },
        },
        _sum: { stems: true, amount: true },
      }),
      prisma.transaction.aggregate({
        where: {
          ...growerFilter,
          ...notCorrection,
          date: { gte: lastYearMonthStart, lt: lastYearMonthEnd },
        },
        _sum: { stems: true, amount: true },
      }),
    ]);

    monthlySales.push({
      month: format(monthStart, "MMM"),
      stems: current._sum.stems || 0,
      turnover: Number(current._sum.amount) || 0,
      lastYearStems: lastYear._sum.stems || 0,
      lastYearTurnover: Number(lastYear._sum.amount) || 0,
    });
  }

  // Top products (by stems, YTD)
  const topProducts = await prisma.transaction.groupBy({
    by: ["lotId"],
    where: {
      ...growerFilter,
      ...notCorrection,
      date: { gte: ytdStart },
    },
    _sum: { stems: true, amount: true },
  });

  // Get lot product names
  const lotIds = topProducts.map((tp: { lotId: string; _sum: { stems: number | null; amount: unknown } }) => tp.lotId);
  const lots = await prisma.lot.findMany({
    where: { id: { in: lotIds } },
    select: { id: true, articleGroup: true },
  });

  const lotMap = new Map(lots.map((l: { id: string; articleGroup: string }) => [l.id, l.articleGroup]));
  const productMap = new Map<string, { stems: number; turnover: number }>();

  for (const tp of topProducts) {
    const group = lotMap.get(tp.lotId) as string || "Other";
    const existing = productMap.get(group as string) || { stems: 0, turnover: 0 };
    existing.stems += tp._sum.stems || 0;
    existing.turnover += Number(tp._sum.amount) || 0;
    productMap.set(group as string, existing);
  }

  const topProductsList = Array.from(productMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.stems - a.stems)
    .slice(0, 8);

  return NextResponse.json({
    stemsToday: todayAgg._sum.stems || 0,
    stemsYesterday: yesterdayAgg._sum.stems || 0,
    stemsYTD,
    stemsYTDLastYear,
    turnoverYTD,
    turnoverYTDLastYear,
    avgPriceYTD: stemsYTD > 0 ? turnoverYTD / stemsYTD : 0,
    avgPriceYTDLastYear:
      stemsYTDLastYear > 0 ? turnoverYTDLastYear / stemsYTDLastYear : 0,
    monthlySales,
    topProducts: topProductsList,
  });
}
