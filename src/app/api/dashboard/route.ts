import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveSupplierId } from "@/lib/api-helpers";
import {
  startOfDay,
  subDays,
  format,
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

// ─── ADMIN OVERVIEW DASHBOARD (no supplier selected) ─────────

async function getAggregateDashboard() {
  const [
    recentImports,
    recentTransactions,
    recentLots,
    recentSuppliers,
    recentGrowers,
    counts,
  ] = await Promise.all([
    // Last sync runs per endpoint
    prisma.importBatch.findMany({
      orderBy: { startedAt: "desc" },
      take: 20,
      select: {
        id: true,
        endpoint: true,
        status: true,
        recordsReceived: true,
        recordsCreated: true,
        recordsUpdated: true,
        recordsSkipped: true,
        durationMs: true,
        startedAt: true,
        completedAt: true,
        errorMessage: true,
      },
    }),
    // 20 most recent transactions (orders)
    prisma.transaction.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        lotId: true,
        date: true,
        salesType: true,
        stems: true,
        amount: true,
        createdAt: true,
        lot: {
          select: {
            lotNumber: true,
            productName: true,
            supplier: { select: { code: true, name: true } },
          },
        },
      },
    }),
    // 20 most recent lots
    prisma.lot.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        lotNumber: true,
        productName: true,
        deliveryDate: true,
        totalStems: true,
        createdAt: true,
        supplier: { select: { code: true, name: true } },
      },
    }),
    // 10 newest suppliers
    prisma.supplier.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        code: true,
        name: true,
        createdAt: true,
        _count: { select: { lots: true } },
      },
    }),
    // 10 newest growers
    prisma.grower.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        name: true,
        fabricId: true,
        createdAt: true,
        supplier: { select: { code: true, name: true } },
      },
    }),
    // Total counts
    Promise.all([
      prisma.supplier.count(),
      prisma.grower.count(),
      prisma.lot.count(),
      prisma.transaction.count(),
      prisma.salesSheet.count(),
    ]).then(([suppliers, growers, lots, transactions, salesSheets]) => ({
      suppliers,
      growers,
      lots,
      transactions,
      salesSheets,
    })),
  ]);

  return NextResponse.json({
    aggregate: true,
    recentImports: recentImports.map((b) => ({
      ...b,
      startedAt: b.startedAt.toISOString(),
      completedAt: b.completedAt?.toISOString() || null,
    })),
    recentTransactions: recentTransactions.map((tx) => ({
      id: tx.id,
      lotId: tx.lotId,
      date: tx.date.toISOString(),
      salesType: tx.salesType,
      stems: tx.stems,
      amount: Number(tx.amount),
      createdAt: tx.createdAt.toISOString(),
      lotNumber: tx.lot.lotNumber,
      productName: tx.lot.productName,
      supplierCode: tx.lot.supplier.code,
      supplierName: tx.lot.supplier.name,
    })),
    recentLots: recentLots.map((l) => ({
      id: l.id,
      lotNumber: l.lotNumber,
      productName: l.productName,
      deliveryDate: l.deliveryDate?.toISOString() || null,
      totalStems: l.totalStems,
      createdAt: l.createdAt.toISOString(),
      supplierCode: l.supplier.code,
      supplierName: l.supplier.name,
    })),
    recentSuppliers: recentSuppliers.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      createdAt: s.createdAt.toISOString(),
      lotCount: s._count.lots,
    })),
    recentGrowers: recentGrowers.map((g) => ({
      id: g.id,
      name: g.name,
      fabricId: g.fabricId,
      createdAt: g.createdAt.toISOString(),
      supplierCode: g.supplier.code,
      supplierName: g.supplier.name,
    })),
    counts,
  });
}
