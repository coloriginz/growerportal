import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveSupplierId } from "@/lib/api-helpers";
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

  const requestedSupplierId = request.nextUrl.searchParams.get("supplierId");
  const supplierId = resolveSupplierId(session!, requestedSupplierId);

  // Aggregate dashboard for admin/commercie without supplier selected
  if (!supplierId && session!.user.role !== "supplier") {
    return getAggregateDashboard();
  }

  if (!supplierId) {
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

  // Fetch supplier's season start month
  const supplierRecord = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { seasonStartMonth: true },
  });
  const seasonStartMonth = supplierRecord?.seasonStartMonth ?? 1;

  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = startOfDay(subDays(now, 1));
  const ytdStart = getSeasonStart(now, seasonStartMonth);
  const { seasonStart: lastYearYtdStart, sameDate: lastYearSameDate } =
    getPreviousSeasonDates(now, seasonStartMonth);

  const supplierFilter = { lot: { supplierId } };

  // ── Parallel batch 1: all KPIs + costs + quality + recent lots + top products ──
  const [
    todayAgg,
    yesterdayAgg,
    ytdAgg,
    lastYearYtdAgg,
    topProducts,
    costsAgg,
    qualityStemsAgg,
    recentLots,
  ] = await Promise.all([
    prisma.transaction.aggregate({
      where: { ...supplierFilter, date: { gte: todayStart } },
      _sum: { stems: true, amount: true },
    }),
    prisma.transaction.aggregate({
      where: { ...supplierFilter, date: { gte: yesterdayStart, lt: todayStart } },
      _sum: { stems: true },
    }),
    prisma.transaction.aggregate({
      where: { ...supplierFilter, date: { gte: ytdStart } },
      _sum: { stems: true, amount: true },
    }),
    prisma.transaction.aggregate({
      where: { ...supplierFilter, date: { gte: lastYearYtdStart, lte: lastYearSameDate } },
      _sum: { stems: true, amount: true },
    }),
    prisma.transaction.groupBy({
      by: ["lotId"],
      where: { ...supplierFilter, date: { gte: ytdStart } },
      _sum: { stems: true, amount: true },
    }),
    prisma.salesSheet.aggregate({
      where: { supplierId, invoiceDate: { gte: ytdStart } },
      _sum: { totalCosts: true },
    }),
    prisma.qualityIssue.aggregate({
      where: { supplierId, date: { gte: ytdStart } },
      _sum: { stems: true },
    }),
    prisma.lot.findMany({
      where: { supplierId },
      orderBy: { deliveryDate: "desc" },
      take: 5,
      select: {
        id: true, lotNumber: true, productName: true,
        totalStems: true, avgPrice: true, deliveryDate: true, status: true,
      },
    }),
  ]);

  const stemsYTD = ytdAgg._sum.stems || 0;
  const turnoverYTD = Number(ytdAgg._sum.amount) || 0;
  const stemsYTDLastYear = lastYearYtdAgg._sum.stems || 0;
  const turnoverYTDLastYear = Number(lastYearYtdAgg._sum.amount) || 0;
  const totalCostsYTD = Number(costsAgg._sum.totalCosts) || 0;
  const netYieldPerStem = stemsYTD > 0 ? (turnoverYTD - totalCostsYTD) / stemsYTD : 0;
  const qualityStems = qualityStemsAgg._sum.stems || 0;
  const qualityRate = stemsYTD > 0 ? ((stemsYTD - qualityStems) / stemsYTD) * 100 : 100;

  // ── Parallel batch 2: monthly sales (all months at once) ──
  const monthQueries: Promise<{ month: string; stems: number; turnover: number; lastYearStems: number; lastYearTurnover: number } | null>[] = [];
  for (let i = 0; i < 12; i++) {
    const monthIdx = (seasonStartMonth - 1 + i) % 12;
    const yearOffset = (seasonStartMonth - 1 + i) >= 12 ? 1 : 0;
    const monthStart = new Date(ytdStart.getFullYear() + yearOffset, monthIdx, 1);
    const monthEnd = new Date(ytdStart.getFullYear() + yearOffset, monthIdx + 1, 1);
    const lastYearMonthStart = new Date(monthStart.getFullYear() - 1, monthIdx, 1);
    const lastYearMonthEnd = new Date(monthStart.getFullYear() - 1, monthIdx + 1, 1);

    if (monthStart > now) break;

    const monthLabel = format(monthStart, "MMM");
    monthQueries.push(
      Promise.all([
        prisma.transaction.aggregate({
          where: { ...supplierFilter, date: { gte: monthStart, lt: monthEnd } },
          _sum: { stems: true, amount: true },
        }),
        prisma.transaction.aggregate({
          where: { ...supplierFilter, date: { gte: lastYearMonthStart, lt: lastYearMonthEnd } },
          _sum: { stems: true, amount: true },
        }),
      ]).then(([current, lastYear]) => ({
        month: monthLabel,
        stems: current._sum.stems || 0,
        turnover: Number(current._sum.amount) || 0,
        lastYearStems: lastYear._sum.stems || 0,
        lastYearTurnover: Number(lastYear._sum.amount) || 0,
      }))
    );
  }
  const monthlySales = (await Promise.all(monthQueries)).filter(Boolean) as NonNullable<(typeof monthQueries)[number] extends Promise<infer T> ? T : never>[];

  // ── Top products: enrich with article groups ──
  const lotIds = topProducts.map((tp) => tp.lotId);
  const lots = await prisma.lot.findMany({
    where: { id: { in: lotIds } },
    select: { id: true, articleGroup: true },
  });
  const lotMap = new Map(lots.map((l) => [l.id, l.articleGroup]));
  const productMap = new Map<string, { stems: number; turnover: number }>();
  for (const tp of topProducts) {
    const group = lotMap.get(tp.lotId) || "Other";
    const existing = productMap.get(group) || { stems: 0, turnover: 0 };
    existing.stems += tp._sum.stems || 0;
    existing.turnover += Number(tp._sum.amount) || 0;
    productMap.set(group, existing);
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
    avgPriceYTDLastYear: stemsYTDLastYear > 0 ? turnoverYTDLastYear / stemsYTDLastYear : 0,
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

// ─── AGGREGATE DASHBOARD (no supplier selected) ─────────

async function getAggregateDashboard() {
  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = startOfDay(subDays(now, 1));
  const ytdStart = startOfYear(now);
  const lastYearYtdStart = startOfYear(subYears(now, 1));
  const lastYearSameDate = subYears(now, 1);
  // ── Parallel batch 1: KPIs + top products (single groupBy, reused for suppliers) + forecasts ──
  const [todayAgg, yesterdayAgg, ytdAgg, lastYearYtdAgg, transactionsByLot, upcomingForecasts] = await Promise.all([
    prisma.transaction.aggregate({
      where: { date: { gte: todayStart } },
      _sum: { stems: true, amount: true },
    }),
    prisma.transaction.aggregate({
      where: { date: { gte: yesterdayStart, lt: todayStart } },
      _sum: { stems: true },
    }),
    prisma.transaction.aggregate({
      where: { date: { gte: ytdStart } },
      _sum: { stems: true, amount: true },
    }),
    prisma.transaction.aggregate({
      where: { date: { gte: lastYearYtdStart, lte: lastYearSameDate } },
      _sum: { stems: true, amount: true },
    }),
    // Single groupBy reused for both top products AND top suppliers
    prisma.transaction.groupBy({
      by: ["lotId"],
      where: { date: { gte: ytdStart } },
      _sum: { stems: true, amount: true },
    }),
    // Upcoming forecasts
    (() => {
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
      return prisma.shipmentForecast.groupBy({
        by: ["year", "week"],
        where: { OR: forecastWeeks.map((w) => ({ year: w.year, week: w.week })) },
        _sum: { stems: true },
        _count: { supplierId: true },
      }).then((results) => ({ results, forecastWeeks }));
    })(),
  ]);

  const stemsYTD = ytdAgg._sum.stems || 0;
  const turnoverYTD = Number(ytdAgg._sum.amount) || 0;
  const stemsYTDLastYear = lastYearYtdAgg._sum.stems || 0;
  const turnoverYTDLastYear = Number(lastYearYtdAgg._sum.amount) || 0;

  // ── Parallel batch 2: monthly sales (all months at once) + lot details for top products/suppliers ──
  const monthQueries: Promise<{ month: string; stems: number; turnover: number; lastYearStems: number; lastYearTurnover: number }>[] = [];
  for (let month = 0; month < 12; month++) {
    const monthStart = new Date(now.getFullYear(), month, 1);
    const monthEnd = new Date(now.getFullYear(), month + 1, 1);
    const lastYearMonthStart = new Date(now.getFullYear() - 1, month, 1);
    const lastYearMonthEnd = new Date(now.getFullYear() - 1, month + 1, 1);

    if (monthStart > now) break;

    const monthLabel = format(monthStart, "MMM");
    monthQueries.push(
      Promise.all([
        prisma.transaction.aggregate({
          where: { date: { gte: monthStart, lt: monthEnd } },
          _sum: { stems: true, amount: true },
        }),
        prisma.transaction.aggregate({
          where: { date: { gte: lastYearMonthStart, lt: lastYearMonthEnd } },
          _sum: { stems: true, amount: true },
        }),
      ]).then(([current, lastYear]) => ({
        month: monthLabel,
        stems: current._sum.stems || 0,
        turnover: Number(current._sum.amount) || 0,
        lastYearStems: lastYear._sum.stems || 0,
        lastYearTurnover: Number(lastYear._sum.amount) || 0,
      }))
    );
  }

  // Single lot fetch with both articleGroup and supplierId (reused for products + suppliers)
  const lotIds = transactionsByLot.map((tp) => tp.lotId);
  const [monthlySales, allLots] = await Promise.all([
    Promise.all(monthQueries),
    prisma.lot.findMany({
      where: { id: { in: lotIds } },
      select: { id: true, articleGroup: true, supplierId: true },
    }),
  ]);

  // Build top products from shared data
  const lotArticleMap = new Map(allLots.map((l) => [l.id, l.articleGroup]));
  const productMap = new Map<string, { stems: number; turnover: number }>();
  for (const tp of transactionsByLot) {
    const group = lotArticleMap.get(tp.lotId) || "Other";
    const existing = productMap.get(group) || { stems: 0, turnover: 0 };
    existing.stems += tp._sum.stems || 0;
    existing.turnover += Number(tp._sum.amount) || 0;
    productMap.set(group, existing);
  }
  const topProducts = Array.from(productMap.entries())
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.stems - a.stems)
    .slice(0, 8);

  // Build top suppliers from shared data (no duplicate query!)
  const lotSupplierMap = new Map(allLots.map((l) => [l.id, l.supplierId]));
  const supplierMap = new Map<string, { stems: number; turnover: number }>();
  for (const tp of transactionsByLot) {
    const sId = lotSupplierMap.get(tp.lotId);
    if (!sId) continue;
    const existing = supplierMap.get(sId) || { stems: 0, turnover: 0 };
    existing.stems += tp._sum.stems || 0;
    existing.turnover += Number(tp._sum.amount) || 0;
    supplierMap.set(sId, existing);
  }

  const suppliers = await prisma.supplier.findMany({
    where: { id: { in: Array.from(supplierMap.keys()) } },
    select: { id: true, code: true, name: true },
  });
  const supplierInfoMap = new Map(suppliers.map((g) => [g.id, g]));

  const topSuppliers = Array.from(supplierMap.entries())
    .map(([id, d]) => {
      const info = supplierInfoMap.get(id);
      return { id, code: info?.code || "", name: info?.name || "", ...d };
    })
    .sort((a, b) => b.stems - a.stems)
    .slice(0, 10);

  // Format forecast data
  const forecastData = upcomingForecasts.forecastWeeks.map((w) => {
    const match = upcomingForecasts.results.find((f) => f.year === w.year && f.week === w.week);
    return {
      week: `W${w.week}`,
      year: w.year,
      stems: match?._sum.stems || 0,
      suppliers: match?._count.supplierId || 0,
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
    topSuppliers,
    upcomingForecasts: forecastData,
  });
}
