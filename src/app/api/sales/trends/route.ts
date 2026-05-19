import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveSupplierId, buildSupplierScope } from "@/lib/api-helpers";
import { startOfYear, format, getISOWeek, subYears } from "date-fns";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const params = request.nextUrl.searchParams;
  const requestedSupplierId = params.get("supplierId");
  const supplierId = resolveSupplierId(session!, requestedSupplierId);
  const scope = buildSupplierScope(session!);

  if (!supplierId && !scope) {
    return NextResponse.json({
      priceTrend: [],
      products: [],
      stemLengthBreakdown: [],
      channelDistribution: [],
      channels: [],
    });
  }

  const granularity = (params.get("granularity") || "week") as "week" | "month" | "year";

  // Parse filters (same as main sales route)
  const filterProducts = params.getAll("product");
  const filterSalesTypes = params.getAll("salesType");
  const filterStemLengths = params.getAll("stemLength").map((s) => parseInt(s));
  const filterGrowerIds = params.getAll("grower");

  const now = new Date();
  const dateStart = granularity === "year"
    ? subYears(startOfYear(now), 2)
    : startOfYear(now);

  function getGroupKey(date: Date): string {
    switch (granularity) {
      case "week": return `Wk ${getISOWeek(date)}`;
      case "month": return format(date, "MMM");
      case "year": return format(date, "yyyy");
    }
  }

  const lotFilter: Record<string, unknown> = supplierId
    ? { supplierId }
    : { supplier: scope };
  if (filterProducts.length > 0) lotFilter.productName = { in: filterProducts };
  if (filterStemLengths.length > 0) lotFilter.stemLength = { in: filterStemLengths };
  if (filterGrowerIds.length > 0) lotFilter.growerId = { in: filterGrowerIds };

  const baseWhere: Record<string, unknown> = {
    lot: lotFilter,
    date: { gte: dateStart },
  };
  if (filterSalesTypes.length > 0) baseWhere.salesType = { in: filterSalesTypes };

  const transactions = await prisma.transaction.findMany({
    where: baseWhere,
    select: {
      date: true,
      stems: true,
      amount: true,
      salesType: true,
      lot: { select: { productName: true, stemLength: true } },
    },
    orderBy: { date: "asc" },
  });

  // Price trend: avg price by product grouped by time period
  const priceTrendMap = new Map<string, Map<string, { stems: number; amount: number }>>();
  const productTotals = new Map<string, number>();
  for (const tx of transactions) {
    const key = getGroupKey(tx.date);
    const product = tx.lot.productName;
    if (!priceTrendMap.has(key)) priceTrendMap.set(key, new Map());
    const productMap = priceTrendMap.get(key)!;
    const existing = productMap.get(product) || { stems: 0, amount: 0 };
    existing.stems += tx.stems;
    existing.amount += Number(tx.amount);
    productMap.set(product, existing);
    productTotals.set(product, (productTotals.get(product) || 0) + tx.stems);
  }

  // Collect products sorted by total stems (descending)
  const allProducts = new Set<string>();
  for (const productMap of priceTrendMap.values()) {
    for (const product of productMap.keys()) allProducts.add(product);
  }
  const sortedProducts = Array.from(allProducts).sort(
    (a, b) => (productTotals.get(b) || 0) - (productTotals.get(a) || 0)
  );

  const priceTrend = Array.from(priceTrendMap.entries()).map(([period, productMap]) => {
    const entry: Record<string, string | number> = { period };
    for (const product of sortedProducts) {
      const data = productMap.get(product);
      entry[product] = data && data.stems > 0
        ? Math.round((data.amount / data.stems) * 100) / 100
        : 0;
    }
    return entry;
  });

  // Stem length breakdown (aggregate stems by length bucket — no time axis)
  const stemLengthMap = new Map<number, { stems: number; turnover: number }>();
  for (const tx of transactions) {
    const length = tx.lot.stemLength;
    const existing = stemLengthMap.get(length) || { stems: 0, turnover: 0 };
    existing.stems += tx.stems;
    existing.turnover += Number(tx.amount);
    stemLengthMap.set(length, existing);
  }

  const stemLengthBreakdown = Array.from(stemLengthMap.entries())
    .map(([length, data]) => ({
      length: `${length} cm`,
      stems: data.stems,
      turnover: data.turnover,
      avgPrice: data.stems > 0 ? Math.round((data.turnover / data.stems) * 100) / 100 : 0,
    }))
    .sort((a, b) => parseInt(a.length) - parseInt(b.length));

  // Channel distribution over time (stems by salesType grouped by time period)
  const channelMap = new Map<string, Map<string, number>>();
  const allChannels = new Set<string>();
  for (const tx of transactions) {
    const key = getGroupKey(tx.date);
    if (!channelMap.has(key)) channelMap.set(key, new Map());
    const salesMap = channelMap.get(key)!;
    salesMap.set(tx.salesType, (salesMap.get(tx.salesType) || 0) + tx.stems);
    allChannels.add(tx.salesType);
  }

  const channelDistribution = Array.from(channelMap.entries()).map(([period, salesMap]) => {
    const entry: Record<string, string | number> = { period };
    for (const channel of allChannels) {
      entry[channel] = salesMap.get(channel) || 0;
    }
    return entry;
  });

  return NextResponse.json({
    priceTrend,
    products: sortedProducts,
    stemLengthBreakdown,
    channelDistribution,
    channels: Array.from(allChannels),
  });
}
