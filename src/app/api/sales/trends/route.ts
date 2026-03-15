import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveGrowerId } from "@/lib/api-helpers";
import { startOfYear, format } from "date-fns";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const params = request.nextUrl.searchParams;
  const requestedGrowerId = params.get("growerId");
  const growerId = resolveGrowerId(session!, requestedGrowerId);

  if (!growerId) {
    return NextResponse.json({
      priceTrend: [],
      stemLengthBreakdown: [],
      channelDistribution: [],
    });
  }

  // Parse filters (same as main sales route)
  const filterProducts = params.getAll("product");
  const filterSalesTypes = params.getAll("salesType");
  const filterStemLengths = params.getAll("stemLength").map((s) => parseInt(s));

  const now = new Date();
  const yearStart = startOfYear(now);

  const lotFilter: Record<string, unknown> = { growerId };
  if (filterProducts.length > 0) lotFilter.productName = { in: filterProducts };
  if (filterStemLengths.length > 0) lotFilter.stemLength = { in: filterStemLengths };

  const baseWhere: Record<string, unknown> = {
    lot: lotFilter,
    isCorrection: false,
    date: { gte: yearStart },
  };
  if (filterSalesTypes.length > 0) baseWhere.salesType = { in: filterSalesTypes };

  // 1. Price trend per product (monthly avg price per stem)
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

  // Price trend: monthly avg price by product
  const priceTrendMap = new Map<string, Map<string, { stems: number; amount: number }>>();
  for (const tx of transactions) {
    const month = format(tx.date, "MMM");
    const product = tx.lot.productName;
    if (!priceTrendMap.has(month)) priceTrendMap.set(month, new Map());
    const productMap = priceTrendMap.get(month)!;
    const existing = productMap.get(product) || { stems: 0, amount: 0 };
    existing.stems += tx.stems;
    existing.amount += Number(tx.amount);
    productMap.set(product, existing);
  }

  // Collect all products
  const allProducts = new Set<string>();
  for (const productMap of priceTrendMap.values()) {
    for (const product of productMap.keys()) allProducts.add(product);
  }

  const priceTrend = Array.from(priceTrendMap.entries()).map(([month, productMap]) => {
    const entry: Record<string, string | number> = { month };
    for (const product of allProducts) {
      const data = productMap.get(product);
      entry[product] = data && data.stems > 0
        ? Math.round((data.amount / data.stems) * 100) / 100
        : 0;
    }
    return entry;
  });

  // 2. Stem length breakdown (aggregate stems by length bucket)
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

  // 3. Channel distribution over time (monthly stems by salesType)
  const channelMap = new Map<string, Map<string, number>>();
  const allChannels = new Set<string>();
  for (const tx of transactions) {
    const month = format(tx.date, "MMM");
    if (!channelMap.has(month)) channelMap.set(month, new Map());
    const salesMap = channelMap.get(month)!;
    salesMap.set(tx.salesType, (salesMap.get(tx.salesType) || 0) + tx.stems);
    allChannels.add(tx.salesType);
  }

  const channelDistribution = Array.from(channelMap.entries()).map(([month, salesMap]) => {
    const entry: Record<string, string | number> = { month };
    for (const channel of allChannels) {
      entry[channel] = salesMap.get(channel) || 0;
    }
    return entry;
  });

  return NextResponse.json({
    priceTrend,
    products: Array.from(allProducts),
    stemLengthBreakdown,
    channelDistribution,
    channels: Array.from(allChannels),
  });
}
