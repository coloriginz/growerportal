import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveGrowerId } from "@/lib/api-helpers";
import {
  startOfDay,
  subDays,
  startOfYear,
  subYears,
  format,
  getISOWeek,
  getISOWeekYear,
} from "date-fns";
import { getSeasonStart, getPreviousSeasonDates } from "@/lib/season";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const requestedGrowerId = request.nextUrl.searchParams.get("growerId");
  const growerId = resolveGrowerId(session!, requestedGrowerId);

  // Aggregate dashboard for admin/commercie without grower selected
  if (!growerId && session!.user.role !== "grower") {
    return getAggregateDashboard();
  }

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
      netYieldPerStem: 0,
      qualityRate: 100,
      monthlySales: [],
      topProducts: [],
      recentLots: [],
      seasonStartMonth: 1,
    });
  }

  // Fetch grower's season start month
  const growerRecord = await prisma.grower.findUnique({
    where: { id: growerId },
    select: { seasonStartMonth: true },
  });
  const seasonStartMonth = growerRecord?.seasonStartMonth ?? 1;

  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = startOfDay(subDays(now, 1));
  const ytdStart = getSeasonStart(now, seasonStartMonth);
  const { seasonStart: lastYearYtdStart, sameDate: lastYearSameDate } =
    getPreviousSeasonDates(now, seasonStartMonth);

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

  // Monthly sales (current season + previous season)
  const monthlySales = [];
  for (let i = 0; i < 12; i++) {
    const monthIdx = (seasonStartMonth - 1 + i) % 12; // 0-based month index
    const yearOffset = (seasonStartMonth - 1 + i) >= 12 ? 1 : 0;
    const monthStart = new Date(ytdStart.getFullYear() + yearOffset, monthIdx, 1);
    const monthEnd = new Date(ytdStart.getFullYear() + yearOffset, monthIdx + 1, 1);
    const lastYearMonthStart = new Date(monthStart.getFullYear() - 1, monthIdx, 1);
    const lastYearMonthEnd = new Date(monthStart.getFullYear() - 1, monthIdx + 1, 1);

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

  // Total costs YTD (from salessheets)
  const costsAgg = await prisma.salesSheet.aggregate({
    where: {
      growerId,
      invoiceDate: { gte: ytdStart },
    },
    _sum: { totalCosts: true },
  });
  const totalCostsYTD = Number(costsAgg._sum.totalCosts) || 0;
  const netYieldPerStem = stemsYTD > 0 ? (turnoverYTD - totalCostsYTD) / stemsYTD : 0;

  // Quality rate YTD
  const qualityStemsAgg = await prisma.qualityIssue.aggregate({
    where: {
      growerId,
      date: { gte: ytdStart },
    },
    _sum: { stems: true },
  });
  const qualityStems = qualityStemsAgg._sum.stems || 0;
  const qualityRate = stemsYTD > 0 ? ((stemsYTD - qualityStems) / stemsYTD) * 100 : 100;

  // Recent lots
  const recentLots = await prisma.lot.findMany({
    where: { growerId },
    orderBy: { deliveryDate: "desc" },
    take: 5,
    select: {
      id: true,
      lotNumber: true,
      productName: true,
      totalStems: true,
      avgPrice: true,
      deliveryDate: true,
      status: true,
    },
  });

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
    netYieldPerStem,
    qualityRate,
    monthlySales,
    topProducts: topProductsList,
    recentLots: recentLots.map((l) => ({
      ...l,
      avgPrice: Number(l.avgPrice),
      deliveryDate: l.deliveryDate.toISOString(),
    })),
    seasonStartMonth,
  });
}

// ─── AGGREGATE DASHBOARD (no grower selected) ─────────

async function getAggregateDashboard() {
  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = startOfDay(subDays(now, 1));
  const ytdStart = startOfYear(now);
  const lastYearYtdStart = startOfYear(subYears(now, 1));
  const lastYearSameDate = subYears(now, 1);
  const notCorrection = { isCorrection: false };

  // Aggregate KPIs across all growers
  const [todayAgg, yesterdayAgg, ytdAgg, lastYearYtdAgg] = await Promise.all([
    prisma.transaction.aggregate({
      where: { ...notCorrection, date: { gte: todayStart } },
      _sum: { stems: true, amount: true },
    }),
    prisma.transaction.aggregate({
      where: { ...notCorrection, date: { gte: yesterdayStart, lt: todayStart } },
      _sum: { stems: true },
    }),
    prisma.transaction.aggregate({
      where: { ...notCorrection, date: { gte: ytdStart } },
      _sum: { stems: true, amount: true },
    }),
    prisma.transaction.aggregate({
      where: { ...notCorrection, date: { gte: lastYearYtdStart, lte: lastYearSameDate } },
      _sum: { stems: true, amount: true },
    }),
  ]);

  const stemsYTD = ytdAgg._sum.stems || 0;
  const turnoverYTD = Number(ytdAgg._sum.amount) || 0;
  const stemsYTDLastYear = lastYearYtdAgg._sum.stems || 0;
  const turnoverYTDLastYear = Number(lastYearYtdAgg._sum.amount) || 0;

  // Monthly sales (all growers combined)
  const monthlySales = [];
  for (let month = 0; month < 12; month++) {
    const monthStart = new Date(now.getFullYear(), month, 1);
    const monthEnd = new Date(now.getFullYear(), month + 1, 1);
    const lastYearMonthStart = new Date(now.getFullYear() - 1, month, 1);
    const lastYearMonthEnd = new Date(now.getFullYear() - 1, month + 1, 1);

    if (monthStart > now) break;

    const [current, lastYear] = await Promise.all([
      prisma.transaction.aggregate({
        where: { ...notCorrection, date: { gte: monthStart, lt: monthEnd } },
        _sum: { stems: true, amount: true },
      }),
      prisma.transaction.aggregate({
        where: { ...notCorrection, date: { gte: lastYearMonthStart, lt: lastYearMonthEnd } },
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

  // Top article groups (all growers)
  const topTransactions = await prisma.transaction.groupBy({
    by: ["lotId"],
    where: { ...notCorrection, date: { gte: ytdStart } },
    _sum: { stems: true, amount: true },
  });

  const lotIds = topTransactions.map((tp) => tp.lotId);
  const lots = await prisma.lot.findMany({
    where: { id: { in: lotIds } },
    select: { id: true, articleGroup: true },
  });
  const lotMap = new Map(lots.map((l) => [l.id, l.articleGroup]));
  const productMap = new Map<string, { stems: number; turnover: number }>();
  for (const tp of topTransactions) {
    const group = lotMap.get(tp.lotId) || "Other";
    const existing = productMap.get(group) || { stems: 0, turnover: 0 };
    existing.stems += tp._sum.stems || 0;
    existing.turnover += Number(tp._sum.amount) || 0;
    productMap.set(group, existing);
  }
  const topProducts = Array.from(productMap.entries())
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.stems - a.stems)
    .slice(0, 8);

  // Top growers by volume YTD
  const growerTransactions = await prisma.transaction.groupBy({
    by: ["lotId"],
    where: { ...notCorrection, date: { gte: ytdStart } },
    _sum: { stems: true, amount: true },
  });

  const allLots = await prisma.lot.findMany({
    where: { id: { in: growerTransactions.map((t) => t.lotId) } },
    select: { id: true, growerId: true },
  });
  const lotGrowerMap = new Map(allLots.map((l) => [l.id, l.growerId]));
  const growerMap = new Map<string, { stems: number; turnover: number }>();
  for (const tp of growerTransactions) {
    const gId = lotGrowerMap.get(tp.lotId);
    if (!gId) continue;
    const existing = growerMap.get(gId) || { stems: 0, turnover: 0 };
    existing.stems += tp._sum.stems || 0;
    existing.turnover += Number(tp._sum.amount) || 0;
    growerMap.set(gId, existing);
  }

  const growers = await prisma.grower.findMany({
    where: { id: { in: Array.from(growerMap.keys()) } },
    select: { id: true, code: true, name: true },
  });
  const growerInfoMap = new Map(growers.map((g) => [g.id, g]));

  const topGrowers = Array.from(growerMap.entries())
    .map(([id, d]) => {
      const info = growerInfoMap.get(id);
      return { id, code: info?.code || "", name: info?.name || "", ...d };
    })
    .sort((a, b) => b.stems - a.stems)
    .slice(0, 10);

  // Upcoming forecasts (next 4 weeks)
  const currentWeek = getISOWeek(now);
  const currentYear = getISOWeekYear(now);
  const forecastWeeks: { year: number; week: number }[] = [];
  let fy = currentYear;
  let fw = currentWeek;
  for (let i = 0; i < 4; i++) {
    forecastWeeks.push({ year: fy, week: fw });
    fw++;
    if (fw > 52) { fw = 1; fy++; }
  }

  const upcomingForecasts = await prisma.shipmentForecast.groupBy({
    by: ["year", "week"],
    where: {
      OR: forecastWeeks.map((w) => ({ year: w.year, week: w.week })),
    },
    _sum: { stems: true },
    _count: { growerId: true },
  });

  const forecastData = forecastWeeks.map((w) => {
    const match = upcomingForecasts.find((f) => f.year === w.year && f.week === w.week);
    return {
      week: `W${w.week}`,
      year: w.year,
      stems: match?._sum.stems || 0,
      growers: match?._count.growerId || 0,
    };
  });

  return NextResponse.json({
    aggregate: true,
    stemsToday: todayAgg._sum.stems || 0,
    stemsYesterday: yesterdayAgg._sum.stems || 0,
    stemsYTD,
    stemsYTDLastYear,
    turnoverYTD,
    turnoverYTDLastYear,
    avgPriceYTD: stemsYTD > 0 ? turnoverYTD / stemsYTD : 0,
    avgPriceYTDLastYear: stemsYTDLastYear > 0 ? turnoverYTDLastYear / stemsYTDLastYear : 0,
    monthlySales,
    topProducts,
    topGrowers,
    upcomingForecasts: forecastData,
  });
}
