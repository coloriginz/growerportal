import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveSupplierId, buildSupplierScope } from "@/lib/api-helpers";
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
    return getAggregateDashboard(session!);
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
      topProducts: [],
      recentShipments: [],
      seasonStartMonth: 1,
    });
  }

  // Fetch supplier's season start month and feature flags
  const supplierRecord = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { seasonStartMonth: true, featureQuality: true },
  });
  const seasonStartMonth = supplierRecord?.seasonStartMonth ?? 1;
  const featureQuality = supplierRecord?.featureQuality ?? true;

  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = startOfDay(subDays(now, 1));
  const ytdStart = getSeasonStart(now, seasonStartMonth);
  const { seasonStart: lastYearYtdStart, sameDate: lastYearSameDate } =
    getPreviousSeasonDates(now, seasonStartMonth);

  const supplierFilter = { lot: { supplierId } };

  // ── Parallel batch 1: all KPIs + costs + quality + recent shipments + top products ──
  const [
    todayAgg,
    yesterdayAgg,
    ytdAgg,
    lastYearYtdAgg,
    topProducts,
    salesSheetAgg,
    salesSheetStemsAgg,
    qualityStemsAgg,
    recentShipments,
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
    // Net yield: use SalesSheet as single source of truth (turnover + costs from same invoice)
    prisma.salesSheet.aggregate({
      where: { supplierId, invoiceDate: { gte: ytdStart } },
      _sum: { totalCosts: true, netResult: true },
    }),
    // Stems from lots linked to YTD salessheets (consistent denominator for net yield)
    prisma.lot.aggregate({
      where: { supplierId, salesSheet: { invoiceDate: { gte: ytdStart } } },
      _sum: { totalStems: true },
    }),
    prisma.qualityIssue.aggregate({
      where: { supplierId, date: { gte: ytdStart } },
      _sum: { stems: true },
    }),
    prisma.salesSheet.findMany({
      where: { supplierId },
      orderBy: { invoiceDate: "desc" },
      take: 5,
      select: {
        id: true, invoiceNumber: true, invoiceDate: true,
        totalTurnover: true, totalCosts: true, netResult: true,
        _count: { select: { lots: true } },
        lots: { select: { invoicedVolume: true } },
      },
    }),
  ]);

  const stemsYTD = ytdAgg._sum.stems || 0;
  const turnoverYTD = Number(ytdAgg._sum.amount) || 0;
  const stemsYTDLastYear = lastYearYtdAgg._sum.stems || 0;
  const turnoverYTDLastYear = Number(lastYearYtdAgg._sum.amount) || 0;
  // Net yield per stem: use SalesSheet as single source for both turnover and costs
  // (avoids mismatch between Transaction.date and SalesSheet.invoiceDate)
  const ssNetResult = Number(salesSheetAgg._sum.netResult) || 0;
  const ssStems = salesSheetStemsAgg._sum.totalStems || 0;
  const netYieldPerStem = ssStems > 0 ? ssNetResult / ssStems : 0;
  const qualityStems = qualityStemsAgg._sum.stems || 0;
  const qualityRate = stemsYTD > 0 ? ((stemsYTD - qualityStems) / stemsYTD) * 100 : 100;

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
    topProducts: topProductsList,
    recentShipments: recentShipments.map((s) => ({
      id: s.id,
      invoiceNumber: s.invoiceNumber,
      invoiceDate: s.invoiceDate?.toISOString() || null,
      totalTurnover: Number(s.totalTurnover),
      netResult: Number(s.netResult),
      lotCount: s._count.lots,
      // invoicedVolume, niet totalStems: dezelfde reden als shipments/route.ts —
      // de orders-import overschrijft Lot.totalStems met het verkochte aantal.
      totalStems: s.lots.reduce((sum, l) => sum + (l.invoicedVolume || 0), 0),
    })),
    seasonStartMonth,
    featureQuality,
  });
}

// ─── ADMIN OVERVIEW DASHBOARD (no supplier selected) ─────────

async function getAggregateDashboard(session: { user: { role: string; supplierId: string | null; kbtCode: string | null; companyIds: string[] } }) {
  const scope = buildSupplierScope(session);
  // Scope filters for different model levels
  const supplierWhere = scope ? { ...scope } : undefined;
  const lotWhere = scope ? { supplier: scope } : undefined;
  const txWhere = scope ? { lot: { supplier: scope } } : undefined;

  const [
    recentImports,
    recentTransactions,
    recentLots,
    recentSuppliers,
    recentGrowers,
    recentSalesSheetUploads,
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
      where: txWhere,
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
            supplierId: true,
            supplier: { select: { code: true, name: true } },
          },
        },
      },
    }),
    // 20 most recent lots
    prisma.lot.findMany({
      where: lotWhere,
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        lotNumber: true,
        productName: true,
        deliveryDate: true,
        totalStems: true,
        supplierId: true,
        createdAt: true,
        supplier: { select: { code: true, name: true } },
      },
    }),
    // 10 newest suppliers
    prisma.supplier.findMany({
      where: supplierWhere,
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
      where: scope ? { supplier: scope } : undefined,
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
    // Recent sales sheet uploads (PDFs linked via import)
    prisma.salesSheet.findMany({
      where: {
        ...( scope ? { supplier: scope } : undefined),
        pdfDocumentId: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        invoiceNumber: true,
        ourInvoiceNumber: true,
        deliveryDate: true,
        updatedAt: true,
        supplier: { select: { code: true, name: true } },
      },
    }),
    // Total counts
    Promise.all([
      prisma.supplier.count({ where: supplierWhere }),
      prisma.grower.count({ where: scope ? { supplier: scope } : undefined }),
      prisma.lot.count({ where: lotWhere }),
      prisma.transaction.count({ where: txWhere }),
      prisma.salesSheet.count({ where: scope ? { supplier: scope } : undefined }),
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
      supplierId: tx.lot.supplierId,
      supplierCode: tx.lot.supplier.code,
      supplierName: tx.lot.supplier.name,
    })),
    recentLots: recentLots.map((l) => ({
      id: l.id,
      lotNumber: l.lotNumber,
      productName: l.productName,
      deliveryDate: l.deliveryDate?.toISOString() || null,
      totalStems: l.totalStems,
      supplierId: l.supplierId,
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
    recentSalesSheetUploads: recentSalesSheetUploads.map((s) => ({
      id: s.id,
      invoiceNumber: s.invoiceNumber,
      ourInvoiceNumber: s.ourInvoiceNumber,
      deliveryDate: s.deliveryDate?.toISOString() || null,
      uploadedAt: s.updatedAt.toISOString(),
      supplierCode: s.supplier.code,
      supplierName: s.supplier.name,
    })),
    counts,
  });
}
