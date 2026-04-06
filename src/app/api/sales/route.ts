import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveGrowerId } from "@/lib/api-helpers";
import { startOfDay, subDays, startOfWeek, startOfMonth, startOfYear, format, getISOWeek, setISOWeek, setYear, endOfISOWeek, startOfISOWeek } from "date-fns";
import { getSeasonStart } from "@/lib/season";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const params = request.nextUrl.searchParams;
  const requestedGrowerId = params.get("growerId");
  const period = params.get("period") || "ytd";
  const weekNumber = params.get("week") ? parseInt(params.get("week")!) : null;
  const yearParam = params.get("year") ? parseInt(params.get("year")!) : null;
  const growerId = resolveGrowerId(session!, requestedGrowerId);

  // Multi-select filters
  const filterProducts = params.getAll("product");
  const filterSalesTypes = params.getAll("salesType");
  const filterStemLengths = params.getAll("stemLength").map((s) => parseInt(s));

  if (!growerId) {
    return NextResponse.json({
      totalStems: 0, totalTurnover: 0, avgPrice: 0,
      bySalesType: [], byProduct: [], daily: [],
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
      // Use season start if a specific grower is selected
      if (growerId) {
        const growerRecord = await prisma.grower.findUnique({
          where: { id: growerId },
          select: { seasonStartMonth: true },
        });
        dateFrom = getSeasonStart(now, growerRecord?.seasonStartMonth ?? 1);
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
  const lotFilter: Record<string, any> = { growerId };
  if (filterProducts.length > 0) lotFilter.productName = { in: filterProducts };
  if (filterStemLengths.length > 0) lotFilter.stemLength = { in: filterStemLengths };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseWhere: Record<string, any> = {
    lot: lotFilter,
    isCorrection: false,
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

  // Year-over-year comparison for weeknr mode
  let lastYearComparison = null;
  if (period === "weeknr" && dateTo) {
    const lyFrom = new Date(dateFrom);
    lyFrom.setFullYear(lyFrom.getFullYear() - 1);
    const lyTo = new Date(dateTo);
    lyTo.setFullYear(lyTo.getFullYear() - 1);
    const lyTotals = await prisma.transaction.aggregate({
      where: {
        lot: { growerId },
        isCorrection: false,
        date: { gte: lyFrom, lte: lyTo },
      },
      _sum: { stems: true, amount: true },
    });
    const lyStems = lyTotals._sum.stems || 0;
    const lyTurnover = Number(lyTotals._sum.amount) || 0;
    lastYearComparison = {
      totalStems: lyStems,
      totalTurnover: lyTurnover,
      avgPrice: lyStems > 0 ? lyTurnover / lyStems : 0,
    };
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
    daily: Array.from(dailyMap.entries()).map(([date, data]) => ({
      date,
      ...data,
    })),
  });
}
