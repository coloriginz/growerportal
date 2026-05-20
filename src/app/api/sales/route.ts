import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveSupplierId, buildSupplierScope } from "@/lib/api-helpers";
import { startOfDay, subDays, startOfWeek, startOfMonth, startOfYear, endOfMonth, endOfWeek, format, getISOWeek, setISOWeek, setYear, endOfISOWeek, startOfISOWeek, addDays } from "date-fns";
import { getSeasonStart } from "@/lib/season";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const params = request.nextUrl.searchParams;
  const requestedSupplierId = params.get("supplierId");
  const period = params.get("period") || "ytd";
  const weekNumber = params.get("week") ? parseInt(params.get("week")!) : null;
  const yearParam = params.get("year") ? parseInt(params.get("year")!) : null;
  const supplierId = resolveSupplierId(session!, requestedSupplierId);
  const scope = buildSupplierScope(session!);

  // Multi-select filters
  const filterProducts = params.getAll("product");
  const filterSalesTypes = params.getAll("salesType");
  const filterStemLengths = params.getAll("stemLength").map((s) => parseInt(s));
  const filterGrowerIds = params.getAll("grower");

  if (!supplierId && !scope) {
    return NextResponse.json({
      totalStems: 0, totalTurnover: 0, avgPrice: 0,
      bySalesType: [], byProduct: [], byGrower: [], daily: [],
    });
  }

  const now = new Date();
  let dateFrom: Date;
  let dateTo: Date | undefined;

  switch (period) {
    case "today":
      dateFrom = startOfDay(now);
      break;
    case "yesterday":
      dateFrom = startOfDay(subDays(now, 1));
      dateTo = startOfDay(now);
      break;
    case "week":
      dateFrom = startOfWeek(now, { weekStartsOn: 1 });
      break;
    case "month":
      dateFrom = startOfMonth(now);
      break;
    case "weeknr": {
      const yr = yearParam || now.getFullYear();
      const wk = weekNumber || getISOWeek(now);
      const weekDate = setISOWeek(setYear(new Date(yr, 0, 4), yr), wk);
      dateFrom = startOfISOWeek(weekDate);
      dateTo = endOfISOWeek(weekDate);
      break;
    }
    case "custom": {
      const fromParam = params.get("dateFrom");
      const toParam = params.get("dateTo");
      dateFrom = fromParam ? startOfDay(new Date(fromParam)) : startOfYear(now);
      dateTo = toParam ? startOfDay(new Date(toParam + "T23:59:59")) : undefined;
      break;
    }
    case "ytd":
    default: {
      // Use season start if a specific supplier is selected
      if (supplierId) {
        const supplierRecord = await prisma.supplier.findUnique({
          where: { id: supplierId },
          select: { seasonStartMonth: true },
        });
        dateFrom = getSeasonStart(now, supplierRecord?.seasonStartMonth ?? 1);
      } else {
        dateFrom = startOfYear(now);
      }
      break;
    }
  }

  const dateFilter = dateTo
    ? { gte: dateFrom, lte: dateTo }
    : { gte: dateFrom };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lotFilter: Record<string, any> = supplierId
    ? { supplierId }
    : { supplier: scope };
  if (filterProducts.length > 0) lotFilter.productName = { in: filterProducts };
  if (filterStemLengths.length > 0) lotFilter.stemLength = { in: filterStemLengths };
  if (filterGrowerIds.length > 0) lotFilter.growerId = { in: filterGrowerIds };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseWhere: Record<string, any> = {
    lot: lotFilter,
    date: dateFilter,
  };
  if (filterSalesTypes.length > 0) baseWhere.salesType = { in: filterSalesTypes };

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
    select: { id: true, productName: true, growerId: true },
  });
  const lotMap = new Map(lots.map((l) => [l.id, l.productName]));

  const productMap = new Map<string, { stems: number; turnover: number }>();
  for (const b of byLot) {
    const product = (lotMap.get(b.lotId) as string) || "Other";
    const existing = productMap.get(product) || { stems: 0, turnover: 0 };
    existing.stems += b._sum.stems || 0;
    existing.turnover += Number(b._sum.amount) || 0;
    productMap.set(product, existing);
  }

  // By grower
  const growerIds = [...new Set(
    lots.filter((l) => l.growerId != null).map((l) => l.growerId as string)
  )];
  const growerRecords = growerIds.length > 0
    ? await prisma.grower.findMany({
        where: { id: { in: growerIds } },
        select: { id: true, name: true, code: true },
      })
    : [];
  const growerNameMap = new Map(
    growerRecords.map((g) => [g.id, g.name || g.code || "Unknown"])
  );
  const growerLotMap = new Map(lots.map((l) => [l.id, l.growerId]));

  const growerAggMap = new Map<string, { stems: number; turnover: number }>();
  for (const b of byLot) {
    const growerId = growerLotMap.get(b.lotId);
    if (!growerId) continue;
    const growerName = growerNameMap.get(growerId) || "Unknown";
    const existing = growerAggMap.get(growerName) || { stems: 0, turnover: 0 };
    existing.stems += b._sum.stems || 0;
    existing.turnover += Number(b._sum.amount) || 0;
    growerAggMap.set(growerName, existing);
  }

  // Daily breakdown — pre-fill all days in the period
  const transactions = await prisma.transaction.findMany({
    where: baseWhere,
    select: { date: true, stems: true, amount: true },
    orderBy: { date: "asc" },
  });

  // Determine the end of the period for pre-filling
  let periodEnd: Date;
  switch (period) {
    case "today":
      periodEnd = startOfDay(addDays(now, 1));
      break;
    case "yesterday":
      periodEnd = startOfDay(now);
      break;
    case "week":
      periodEnd = addDays(startOfWeek(now, { weekStartsOn: 1 }), 7);
      break;
    case "month":
      periodEnd = startOfMonth(addDays(endOfMonth(now), 1));
      break;
    case "weeknr":
      periodEnd = dateTo ? addDays(dateTo, 1) : addDays(dateFrom, 7);
      break;
    case "custom":
      periodEnd = dateTo ? addDays(dateTo, 1) : addDays(now, 1);
      break;
    default: // ytd
      periodEnd = addDays(now, 1);
      break;
  }

  const dailyMap = new Map<string, { stems: number; turnover: number; lastYearStems: number; lastYearTurnover: number }>();
  // Pre-fill all days
  const cursor = new Date(dateFrom);
  while (cursor < periodEnd) {
    dailyMap.set(format(cursor, "dd-MM"), { stems: 0, turnover: 0, lastYearStems: 0, lastYearTurnover: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  for (const tx of transactions) {
    const day = format(tx.date, "dd-MM");
    const existing = dailyMap.get(day);
    if (existing) {
      existing.stems += tx.stems;
      existing.turnover += Number(tx.amount);
    }
  }

  // Year-over-year comparison — always compute for all periods
  const lyFrom = new Date(dateFrom);
  lyFrom.setFullYear(lyFrom.getFullYear() - 1);
  const lyEnd = new Date(periodEnd);
  lyEnd.setFullYear(lyEnd.getFullYear() - 1);
  const lyDateFilter = { gte: lyFrom, lt: lyEnd };
  const lyBaseWhere = {
    lot: supplierId ? { supplierId } : { supplier: scope },
    date: lyDateFilter,
    ...(filterSalesTypes.length > 0 ? { salesType: { in: filterSalesTypes } } : {}),
  };

  const [lyTotals, lyTransactions] = await Promise.all([
    prisma.transaction.aggregate({
      where: lyBaseWhere,
      _sum: { stems: true, amount: true },
    }),
    prisma.transaction.findMany({
      where: lyBaseWhere,
      select: { date: true, stems: true, amount: true },
    }),
  ]);
  const lyStems = lyTotals._sum.stems || 0;
  const lyTurnover = Number(lyTotals._sum.amount) || 0;
  const lastYearComparison = {
    totalStems: lyStems,
    totalTurnover: lyTurnover,
    avgPrice: lyStems > 0 ? lyTurnover / lyStems : 0,
  };

  // Map last year transactions to same dd-MM keys
  for (const tx of lyTransactions) {
    // Shift date forward 1 year to align with current period labels
    const shifted = new Date(tx.date);
    shifted.setFullYear(shifted.getFullYear() + 1);
    const day = format(shifted, "dd-MM");
    const entry = dailyMap.get(day);
    if (entry) {
      entry.lastYearStems = (entry.lastYearStems || 0) + tx.stems;
      entry.lastYearTurnover = (entry.lastYearTurnover || 0) + Number(tx.amount);
    }
  }

  return NextResponse.json({
    totalStems,
    totalTurnover,
    avgPrice: totalStems > 0 ? totalTurnover / totalStems : 0,
    lastYearComparison,
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
    byGrower: Array.from(growerAggMap.entries())
      .map(([grower, data]) => ({
        grower,
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
