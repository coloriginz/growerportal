import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveSupplierId, buildSupplierScope } from "@/lib/api-helpers";
import { format, startOfISOWeek, addDays, getISOWeek } from "date-fns";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const params = request.nextUrl.searchParams;
  const supplierId = resolveSupplierId(session!, params.get("supplierId"));

  const now = new Date();
  const chartView = params.get("chartView") || "week";
  const chartWeekParam = params.get("chartWeek");
  const chartYearParam = params.get("chartYear");
  const chartWeek = chartWeekParam ? parseInt(chartWeekParam) : getISOWeek(now);
  const chartYear = chartYearParam ? parseInt(chartYearParam) : now.getFullYear();

  // Supplier-specific path uses supplierId directly; aggregate path uses company scope
  const scope = buildSupplierScope(session!);
  const supplierFilter = supplierId
    ? { lot: { supplierId } }
    : scope
      ? { lot: { supplier: scope } }
      : {};

  type ChartEntry = { label: string; stems: number; turnover: number; lastYearStems: number; lastYearTurnover: number };
  let salesChart: ChartEntry[] = [];

  // Determine period date range for top products
  let periodStart: Date;
  let periodEnd: Date;

  if (chartView === "week") {
    const jan4 = new Date(chartYear, 0, 4);
    const jan4Monday = startOfISOWeek(jan4);
    const weekStart = addDays(jan4Monday, (chartWeek - 1) * 7);
    const weekEnd = addDays(weekStart, 7);
    periodStart = weekStart;
    periodEnd = weekEnd;

    const jan4Ly = new Date(chartYear - 1, 0, 4);
    const jan4MondayLy = startOfISOWeek(jan4Ly);
    const lyWeekStart = addDays(jan4MondayLy, (chartWeek - 1) * 7);
    const lyWeekEnd = addDays(lyWeekStart, 7);

    const [currentTx, lastYearTx] = await Promise.all([
      prisma.transaction.findMany({
        where: { ...supplierFilter, date: { gte: weekStart, lt: weekEnd } },
        select: { date: true, stems: true, amount: true },
      }),
      prisma.transaction.findMany({
        where: { ...supplierFilter, date: { gte: lyWeekStart, lt: lyWeekEnd } },
        select: { date: true, stems: true, amount: true },
      }),
    ]);

    const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    salesChart = dayLabels.map((label) => ({ label, stems: 0, turnover: 0, lastYearStems: 0, lastYearTurnover: 0 }));

    for (const tx of currentTx) {
      const dayIdx = (tx.date.getDay() + 6) % 7;
      salesChart[dayIdx].stems += tx.stems;
      salesChart[dayIdx].turnover += Number(tx.amount);
    }
    for (const tx of lastYearTx) {
      const dayIdx = (tx.date.getDay() + 6) % 7;
      salesChart[dayIdx].lastYearStems += tx.stems;
      salesChart[dayIdx].lastYearTurnover += Number(tx.amount);
    }
  } else if (chartView === "year") {
    periodStart = new Date(chartYear, 0, 1);
    periodEnd = new Date(chartYear + 1, 0, 1);

    // Show all 12 months, even without data
    for (let m = 0; m < 12; m++) {
      const monthStart = new Date(chartYear, m, 1);
      const monthEnd = new Date(chartYear, m + 1, 1);
      const lyMonthStart = new Date(chartYear - 1, m, 1);
      const lyMonthEnd = new Date(chartYear - 1, m + 1, 1);
      const [cur, ly] = await Promise.all([
        prisma.transaction.aggregate({
          where: { ...supplierFilter, date: { gte: monthStart, lt: monthEnd } },
          _sum: { stems: true, amount: true },
        }),
        prisma.transaction.aggregate({
          where: { ...supplierFilter, date: { gte: lyMonthStart, lt: lyMonthEnd } },
          _sum: { stems: true, amount: true },
        }),
      ]);
      salesChart.push({
        label: format(monthStart, "MMM"),
        stems: cur._sum.stems || 0,
        turnover: Number(cur._sum.amount) || 0,
        lastYearStems: ly._sum.stems || 0,
        lastYearTurnover: Number(ly._sum.amount) || 0,
      });
    }
  } else {
    // Month view: weeks within the selected month
    const monthIdx = chartWeekParam ? parseInt(chartWeekParam) : now.getMonth();
    const monthStart = new Date(chartYear, monthIdx, 1);
    const monthEnd = new Date(chartYear, monthIdx + 1, 1);
    periodStart = monthStart;
    periodEnd = monthEnd;
    const lyMonthStart = new Date(chartYear - 1, monthIdx, 1);
    const lyMonthEnd = new Date(chartYear - 1, monthIdx + 1, 1);

    // Determine all ISO weeks that fall within this month
    const weeksInMonth: number[] = [];
    const d = new Date(monthStart);
    while (d < monthEnd) {
      const wk = getISOWeek(d);
      if (!weeksInMonth.includes(wk)) weeksInMonth.push(wk);
      d.setDate(d.getDate() + 1);
    }

    const [currentTx, lastYearTx] = await Promise.all([
      prisma.transaction.findMany({
        where: { ...supplierFilter, date: { gte: monthStart, lt: monthEnd } },
        select: { date: true, stems: true, amount: true },
      }),
      prisma.transaction.findMany({
        where: { ...supplierFilter, date: { gte: lyMonthStart, lt: lyMonthEnd } },
        select: { date: true, stems: true, amount: true },
      }),
    ]);

    // Pre-fill all weeks with zeros
    const weekMap = new Map<number, ChartEntry>();
    for (const wk of weeksInMonth) {
      weekMap.set(wk, { label: `Wk ${wk}`, stems: 0, turnover: 0, lastYearStems: 0, lastYearTurnover: 0 });
    }
    for (const tx of currentTx) {
      const wk = getISOWeek(tx.date);
      const entry = weekMap.get(wk)!;
      entry.stems += tx.stems;
      entry.turnover += Number(tx.amount);
    }
    for (const tx of lastYearTx) {
      const wk = getISOWeek(tx.date);
      const entry = weekMap.get(wk);
      if (entry) {
        entry.lastYearStems += tx.stems;
        entry.lastYearTurnover += Number(tx.amount);
      }
    }
    salesChart = Array.from(weekMap.values()).sort((a, b) => {
      const aN = parseInt(a.label.replace("Wk ", ""));
      const bN = parseInt(b.label.replace("Wk ", ""));
      return aN - bN;
    });
  }

  // Top products for the selected period
  const topProductsRaw = await prisma.transaction.groupBy({
    by: ["lotId"],
    where: { ...supplierFilter, date: { gte: periodStart, lt: periodEnd } },
    _sum: { stems: true, amount: true },
  });

  const lotIds = topProductsRaw.map((tp) => tp.lotId);
  const lots = await prisma.lot.findMany({
    where: { id: { in: lotIds } },
    select: { id: true, articleGroup: true },
  });
  const lotMap = new Map(lots.map((l) => [l.id, l.articleGroup]));
  const productMap = new Map<string, { stems: number; turnover: number }>();
  for (const tp of topProductsRaw) {
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

  return NextResponse.json({ salesChart, topProducts });
}
