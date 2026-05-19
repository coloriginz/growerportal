"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RiPlantLine,
  RiMoneyEuroCircleLine,
  RiLineChartLine,
  RiCalendarLine,
  RiArrowUpSLine,
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiShieldCheckLine,
  RiRefreshLine,
  RiDatabase2Line,
  RiGroupLine,
  RiFileList3Line,
  RiExchangeLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
} from "@remixicon/react";
import { getISOWeek } from "date-fns";
import { useLanguage } from "@/components/providers/language-provider";
import { SalesChart } from "@/components/charts/sales-chart";
import { TurnoverChart } from "@/components/charts/turnover-chart";
import { TopProductsChart } from "@/components/charts/top-products-chart";
import { formatCurrency, formatNumber, formatPrice, formatDate, formatTime } from "@/lib/format";
import { getSeasonLabel } from "@/lib/season";
import { useFetch } from "@/hooks/use-fetch";
import { ErrorState } from "@/components/ui/error-state";

interface ImportBatch {
  id: string;
  endpoint: string;
  status: string;
  recordsReceived: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

interface AggregateData {
  aggregate: true;
  recentImports: ImportBatch[];
  recentTransactions: { id: string; lotId: string; date: string; salesType: string; stems: number; amount: number; createdAt: string; lotNumber: string; productName: string; supplierId: string; supplierCode: string; supplierName: string }[];
  recentLots: { id: string; lotNumber: string; productName: string; deliveryDate: string | null; totalStems: number; supplierId: string; createdAt: string; supplierCode: string; supplierName: string }[];
  recentSuppliers: { id: string; code: string; name: string; createdAt: string; lotCount: number }[];
  recentGrowers: { id: string; name: string; fabricId: number | null; createdAt: string; supplierCode: string; supplierName: string }[];
  counts: { suppliers: number; growers: number; lots: number; transactions: number; salesSheets: number };
}

interface SupplierDashboardData {
  aggregate?: false;
  stemsToday: number;
  stemsYesterday: number;
  stemsYTD: number;
  stemsYTDLastYear: number;
  turnoverYTD: number;
  turnoverYTDLastYear: number;
  avgPriceYTD: number;
  avgPriceYTDLastYear: number;
  netYieldPerStem?: number;
  qualityRate?: number;
  featureQuality?: boolean;
  // salesChart is fetched separately via /api/dashboard/chart
  topProducts: { name: string; stems: number; turnover: number }[];
  seasonStartMonth?: number;
  recentShipments?: { id: string; invoiceNumber: string; invoiceDate: string | null; totalTurnover: number; netResult: number; lotCount: number; totalStems: number }[];
}

type DashboardData = AggregateData | SupplierDashboardData;

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  change,
  changeLabel,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  change?: number;
  changeLabel?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="kpi-label">
          {title}
        </CardTitle>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
          <Icon className="h-[18px] w-[18px] text-accent-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="kpi-value">{value}</div>
        {change !== undefined && (
          <span
            className={`kpi-change ${change >= 0 ? "kpi-change-up" : "kpi-change-down"}`}
          >
            {change >= 0 ? (
              <RiArrowUpSLine className="h-3.5 w-3.5" />
            ) : (
              <RiArrowDownSLine className="h-3.5 w-3.5" />
            )}
            {change >= 0 ? "+" : ""}
            {change.toFixed(1)}% {changeLabel}
          </span>
        )}
        {subtitle && (
          <p className="text-muted-foreground mt-1.5 text-xs">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="page-content">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="mt-3 h-8 w-32 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {[...Array(2)].map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <div className="h-[300px] animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── ADMIN OVERVIEW (no supplier selected) ────────────────────

const COLLAPSED_ROWS = 7;

function AdminOverview({ data, lastUpdated, refetch }: { data: AggregateData; lastUpdated: Date | null; refetch: () => void }) {
  const { t } = useLanguage();
  const [ordersExpanded, setOrdersExpanded] = useState(false);
  const [lotsExpanded, setLotsExpanded] = useState(false);

  // Group imports: show latest per endpoint + full recent list
  const latestPerEndpoint = new Map<string, ImportBatch>();
  for (const batch of data.recentImports) {
    if (!latestPerEndpoint.has(batch.endpoint)) {
      latestPerEndpoint.set(batch.endpoint, batch);
    }
  }

  const endpointLabels: Record<string, string> = {
    suppliers: "Suppliers",
    lots: "Lots",
    orders: "Orders",
    costs: "Costs",
    growers: "Growers",
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>{t("dashboard.adminOverviewTitle")}</h1>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              {t("common.lastUpdated")}: {formatTime(lastUpdated)}
            </span>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refetch}>
            <RiRefreshLine className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Record counts */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="kpi-label">{t("dashboard.countSuppliers")}</CardTitle>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
              <RiGroupLine className="h-[18px] w-[18px] text-accent-foreground" />
            </div>
          </CardHeader>
          <CardContent><div className="kpi-value">{formatNumber(data.counts.suppliers)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="kpi-label">{t("dashboard.countGrowers")}</CardTitle>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
              <RiPlantLine className="h-[18px] w-[18px] text-accent-foreground" />
            </div>
          </CardHeader>
          <CardContent><div className="kpi-value">{formatNumber(data.counts.growers)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="kpi-label">{t("dashboard.countLots")}</CardTitle>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
              <RiFileList3Line className="h-[18px] w-[18px] text-accent-foreground" />
            </div>
          </CardHeader>
          <CardContent><div className="kpi-value">{formatNumber(data.counts.lots)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="kpi-label">{t("dashboard.countTransactions")}</CardTitle>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
              <RiExchangeLine className="h-[18px] w-[18px] text-accent-foreground" />
            </div>
          </CardHeader>
          <CardContent><div className="kpi-value">{formatNumber(data.counts.transactions)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="kpi-label">{t("dashboard.countSalesSheets")}</CardTitle>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
              <RiDatabase2Line className="h-[18px] w-[18px] text-accent-foreground" />
            </div>
          </CardHeader>
          <CardContent><div className="kpi-value">{formatNumber(data.counts.salesSheets)}</div></CardContent>
        </Card>
      </div>

      {/* Last sync per endpoint */}
      <Card>
        <CardHeader><CardTitle>{t("dashboard.lastSyncRuns")}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("dashboard.syncEndpoint")}</TableHead>
                <TableHead>{t("dashboard.syncStatus")}</TableHead>
                <TableHead>{t("dashboard.syncTime")}</TableHead>
                <TableHead className="text-right">{t("dashboard.syncReceived")}</TableHead>
                <TableHead className="text-right">{t("dashboard.syncCreated")}</TableHead>
                <TableHead className="text-right">{t("dashboard.syncUpdated")}</TableHead>
                <TableHead className="text-right">{t("dashboard.syncDuration")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from(latestPerEndpoint.entries()).map(([endpoint, batch]) => (
                <TableRow key={batch.id}>
                  <TableCell className="font-medium">{endpointLabels[endpoint] || endpoint}</TableCell>
                  <TableCell>
                    <Badge
                      variant={batch.status === "success" ? "default" : batch.status === "error" ? "destructive" : "secondary"}
                      className="gap-1"
                    >
                      {batch.status === "success" && <RiCheckLine className="h-3 w-3" />}
                      {batch.status === "error" && <RiErrorWarningLine className="h-3 w-3" />}
                      {batch.status === "running" && <RiLoader4Line className="h-3 w-3 animate-spin" />}
                      {batch.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span title={new Date(batch.startedAt).toLocaleString("nl-NL")}>
                      {formatRelativeTime(batch.startedAt)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(batch.recordsReceived)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(batch.recordsCreated)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(batch.recordsUpdated)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {batch.durationMs != null ? `${(batch.durationMs / 1000).toFixed(1)}s` : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Recent transactions (orders) */}
      <Card>
        <CardHeader><CardTitle>{t("dashboard.recentOrders")}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("dashboard.orderDate")}</TableHead>
                <TableHead>{t("dashboard.supplier")}</TableHead>
                <TableHead>{t("lots.lotNumber")}</TableHead>
                <TableHead>{t("lots.product")}</TableHead>
                <TableHead>{t("dashboard.syncSalesType")}</TableHead>
                <TableHead className="text-right">{t("lots.totalStems")}</TableHead>
                <TableHead>{t("dashboard.syncAddedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(ordersExpanded ? data.recentTransactions : data.recentTransactions.slice(0, COLLAPSED_ROWS)).map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="tabular-nums">{formatDate(tx.date)}</TableCell>
                  <TableCell>
                    <span className="font-medium">{tx.supplierCode}</span>
                    <span className="ml-1.5 text-muted-foreground text-xs">{tx.supplierName}</span>
                  </TableCell>
                  <TableCell className="font-medium tabular-nums">
                    <Link href={`/lots/${tx.lotId}?supplierId=${tx.supplierId}`} className="text-primary hover:underline">{tx.lotNumber}</Link>
                  </TableCell>
                  <TableCell>{tx.productName}</TableCell>
                  <TableCell><Badge variant="outline">{tx.salesType}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(tx.stems)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatRelativeTime(tx.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.recentTransactions.length > COLLAPSED_ROWS && (
            <div className="flex justify-center border-t py-2">
              <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground" onClick={() => setOrdersExpanded(!ordersExpanded)}>
                {ordersExpanded ? <RiArrowUpSLine className="h-4 w-4" /> : <RiArrowDownSLine className="h-4 w-4" />}
                {ordersExpanded ? t("common.showLess") : `${t("common.showMore")} (${data.recentTransactions.length - COLLAPSED_ROWS})`}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent lots */}
      <Card>
        <CardHeader><CardTitle>{t("dashboard.recentLots")}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("lots.lotNumber")}</TableHead>
                <TableHead>{t("dashboard.supplier")}</TableHead>
                <TableHead>{t("lots.product")}</TableHead>
                <TableHead>{t("lots.deliveryDate")}</TableHead>
                <TableHead className="text-right">{t("lots.totalStems")}</TableHead>
                <TableHead>{t("dashboard.syncAddedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(lotsExpanded ? data.recentLots : data.recentLots.slice(0, COLLAPSED_ROWS)).map((lot) => (
                <TableRow key={lot.id}>
                  <TableCell className="font-medium tabular-nums">
                    <Link href={`/lots/${lot.id}?supplierId=${lot.supplierId}`} className="text-primary hover:underline">{lot.lotNumber}</Link>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{lot.supplierCode}</span>
                    <span className="ml-1.5 text-muted-foreground text-xs">{lot.supplierName}</span>
                  </TableCell>
                  <TableCell>{lot.productName}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{lot.deliveryDate ? formatDate(lot.deliveryDate) : "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(lot.totalStems)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatRelativeTime(lot.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.recentLots.length > COLLAPSED_ROWS && (
            <div className="flex justify-center border-t py-2">
              <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground" onClick={() => setLotsExpanded(!lotsExpanded)}>
                {lotsExpanded ? <RiArrowUpSLine className="h-4 w-4" /> : <RiArrowDownSLine className="h-4 w-4" />}
                {lotsExpanded ? t("common.showLess") : `${t("common.showMore")} (${data.recentLots.length - COLLAPSED_ROWS})`}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent suppliers + growers side by side */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("dashboard.recentSuppliersTitle")}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("dashboard.syncCode")}</TableHead>
                  <TableHead>{t("dashboard.syncName")}</TableHead>
                  <TableHead className="text-right">{t("dashboard.countLots")}</TableHead>
                  <TableHead>{t("dashboard.syncAddedAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentSuppliers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.code}</TableCell>
                    <TableCell>{s.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.lotCount}</TableCell>
                    <TableCell className="text-muted-foreground">{formatRelativeTime(s.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("dashboard.recentGrowersTitle")}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("dashboard.syncName")}</TableHead>
                  <TableHead>{t("dashboard.supplier")}</TableHead>
                  <TableHead>{t("dashboard.syncAddedAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentGrowers.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">{g.name || `Grower #${g.fabricId}`}</TableCell>
                    <TableCell>
                      <span className="font-medium">{g.supplierCode}</span>
                      <span className="ml-1.5 text-muted-foreground text-xs">{g.supplierName}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatRelativeTime(g.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(isoString);
}

type ChartData = { salesChart: { label: string; stems: number; turnover: number; lastYearStems: number; lastYearTurnover: number }[]; topProducts: { name: string; stems: number; turnover: number }[] };

export function DashboardContent({ supplierId }: { supplierId: string | null }) {
  const { t } = useLanguage();
  const nowWeek = getISOWeek(new Date());
  const nowYear = new Date().getFullYear();
  const [chartView, setChartView] = useState<"week" | "month" | "year">("week");
  const [chartWeek, setChartWeek] = useState(nowWeek);
  const [chartYear, setChartYear] = useState(nowYear);
  const [chartMonth, setChartMonth] = useState(new Date().getMonth());

  // KPI data — stable URL, doesn't change when chart navigates
  const url = useMemo(() => {
    const params = supplierId ? `?supplierId=${supplierId}` : "";
    return `/api/dashboard${params}`;
  }, [supplierId]);
  const { data, loading, error, lastUpdated, refetch } = useFetch<DashboardData>(url);

  // Chart data — separate fetch, changes on chart navigation
  const chartUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (supplierId) params.set("supplierId", supplierId);
    params.set("chartView", chartView);
    if (chartView === "week") {
      params.set("chartWeek", String(chartWeek));
      params.set("chartYear", String(chartYear));
    } else if (chartView === "month") {
      params.set("chartWeek", String(chartMonth));
      params.set("chartYear", String(chartYear));
    } else {
      params.set("chartYear", String(chartYear));
    }
    return `/api/dashboard/chart?${params}`;
  }, [supplierId, chartView, chartWeek, chartYear, chartMonth]);
  const { data: chartData } = useFetch<ChartData>(chartUrl);

  if (error) {
    return (
      <div className="page-content">
        <ErrorState onRetry={refetch} />
      </div>
    );
  }

  if (loading || !data) {
    return <DashboardSkeleton />;
  }

  if (data.aggregate) {
    return <AdminOverview data={data as AggregateData} lastUpdated={lastUpdated} refetch={refetch} />;
  }

  const chartNav = {
    view: chartView,
    setView: setChartView,
    week: chartWeek,
    setWeek: setChartWeek,
    year: chartYear,
    setYear: setChartYear,
    month: chartMonth,
    setMonth: setChartMonth,
    nowWeek,
    nowYear,
    nowMonth: new Date().getMonth(),
  };

  return <SupplierDashboard data={data as SupplierDashboardData} lastUpdated={lastUpdated} refetch={refetch} chartNav={chartNav} chartData={chartData?.salesChart ?? []} topProducts={chartData?.topProducts ?? []} supplierId={supplierId} />;
}

// ─── SUPPLIER DASHBOARD (existing) ────────────────────

interface ChartNav {
  view: "week" | "month" | "year";
  setView: (v: "week" | "month" | "year") => void;
  week: number;
  setWeek: (w: number) => void;
  year: number;
  setYear: (y: number) => void;
  month: number;
  setMonth: (m: number) => void;
  nowWeek: number;
  nowYear: number;
  nowMonth: number;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ChartPeriodNav({ chartNav }: { chartNav: ChartNav }) {
  const { view, week, setWeek, year, setYear, month, setMonth, nowWeek, nowYear, nowMonth } = chartNav;

  const canGoForward = view === "week"
    ? !(week >= nowWeek && year >= nowYear)
    : view === "month"
    ? !(month >= nowMonth && year >= nowYear)
    : year < nowYear;

  const goBack = () => {
    if (view === "week") {
      if (week <= 1) { setWeek(52); setYear(year - 1); }
      else setWeek(week - 1);
    } else if (view === "month") {
      if (month <= 0) { setMonth(11); setYear(year - 1); }
      else setMonth(month - 1);
    } else {
      setYear(year - 1);
    }
  };

  const goForward = () => {
    if (!canGoForward) return;
    if (view === "week") {
      if (week >= 52) { setWeek(1); setYear(year + 1); }
      else setWeek(week + 1);
    } else if (view === "month") {
      if (month >= 11) { setMonth(0); setYear(year + 1); }
      else setMonth(month + 1);
    } else {
      setYear(year + 1);
    }
  };

  const goToNow = () => {
    setYear(nowYear);
    if (view === "week") setWeek(nowWeek);
    if (view === "month") setMonth(nowMonth);
  };

  const label = view === "week"
    ? `Wk ${week} — ${year}`
    : view === "month"
    ? `${MONTH_LABELS[month]} ${year}`
    : String(year);

  const isNow = view === "week"
    ? week === nowWeek && year === nowYear
    : view === "month"
    ? month === nowMonth && year === nowYear
    : year === nowYear;

  return (
    <div className="flex items-center gap-2 mt-1">
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goBack}>
        <RiArrowLeftSLine className="h-4 w-4" />
      </Button>
      <button
        onClick={goToNow}
        className={`text-sm font-medium tabular-nums min-w-[100px] text-center ${isNow ? "" : "text-muted-foreground hover:text-foreground cursor-pointer"}`}
      >
        {label}
      </button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goForward} disabled={!canGoForward}>
        <RiArrowRightSLine className="h-4 w-4" />
      </Button>
    </div>
  );
}

function SupplierDashboard({ data, lastUpdated, refetch, chartNav, chartData, topProducts, supplierId }: { data: SupplierDashboardData; lastUpdated: Date | null; refetch: () => void; chartNav: ChartNav; chartData: ChartData["salesChart"]; topProducts: ChartData["topProducts"]; supplierId: string | null }) {
  const { t } = useLanguage();
  const seasonMonth = data.seasonStartMonth ?? 1;
  const seasonLabel = getSeasonLabel(seasonMonth);
  const isCustomSeason = seasonMonth !== 1;

  const stemsChange =
    data.stemsYTDLastYear > 0
      ? ((data.stemsYTD - data.stemsYTDLastYear) / data.stemsYTDLastYear) * 100
      : 0;
  const turnoverChange =
    data.turnoverYTDLastYear > 0
      ? ((data.turnoverYTD - data.turnoverYTDLastYear) / data.turnoverYTDLastYear) * 100
      : 0;
  const priceChange =
    data.avgPriceYTDLastYear > 0
      ? ((data.avgPriceYTD - data.avgPriceYTDLastYear) / data.avgPriceYTDLastYear) * 100
      : 0;
  const vsLabel = isCustomSeason ? t("dashboard.vsLastSeason") : t("dashboard.vsLastYear");

  // STD labels with season range for custom seasons
  const stemsSTDLabel = isCustomSeason
    ? `${t("dashboard.stemsSTD")} (${seasonLabel})`
    : t("dashboard.stemsYTD");
  const turnoverSTDLabel = isCustomSeason
    ? `${t("dashboard.turnoverSTD")} (${seasonLabel})`
    : t("dashboard.turnoverYTD");

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>{t("dashboard.title")}</h1>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              {t("common.lastUpdated")}: {formatTime(lastUpdated)}
            </span>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refetch}>
            <RiRefreshLine className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title={t("dashboard.stemsToday")} value={formatNumber(data.stemsToday)} icon={RiPlantLine} />
        <KpiCard title={t("dashboard.stemsYesterday")} value={formatNumber(data.stemsYesterday)} icon={RiCalendarLine} />
        <KpiCard title={stemsSTDLabel} value={formatNumber(data.stemsYTD)} icon={RiLineChartLine} change={stemsChange} changeLabel={vsLabel} />
        <KpiCard title={turnoverSTDLabel} value={formatCurrency(data.turnoverYTD)} icon={RiMoneyEuroCircleLine} change={turnoverChange} changeLabel={vsLabel} />
      </div>

      {/* Secondary KPI Cards */}
      <div className={`grid gap-4 ${data.featureQuality !== false ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <KpiCard title={t("dashboard.avgPrice")} value={formatPrice(data.avgPriceYTD)} icon={RiLineChartLine} change={priceChange} changeLabel={vsLabel} />
        <KpiCard title={t("dashboard.netYieldPerStem")} value={formatPrice(data.netYieldPerStem || 0)} icon={RiMoneyEuroCircleLine} />
        {data.featureQuality !== false && (
          <KpiCard title={t("dashboard.qualityRate")} value={`${(data.qualityRate || 100).toFixed(1)}%`} icon={RiShieldCheckLine} />
        )}
      </div>

      {/* Chart period selector */}
      <div className="flex flex-wrap items-center justify-end gap-4">
        <ChartPeriodNav chartNav={chartNav} />
        <Tabs value={chartNav.view} onValueChange={(v) => chartNav.setView(v as "week" | "month" | "year")}>
          <TabsList className="h-8">
            <TabsTrigger value="week" className="text-xs px-3 h-6">{t("sales.granularityWeek")}</TabsTrigger>
            <TabsTrigger value="month" className="text-xs px-3 h-6">{t("sales.granularityMonth")}</TabsTrigger>
            <TabsTrigger value="year" className="text-xs px-3 h-6">{t("sales.granularityYear")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Charts: Sales + Turnover side by side */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("dashboard.salesOverview")}</CardTitle></CardHeader>
          <CardContent><SalesChart data={chartData} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("dashboard.turnoverOverview")}</CardTitle></CardHeader>
          <CardContent><TurnoverChart data={chartData} /></CardContent>
        </Card>
      </div>

      {/* Top Products */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("dashboard.topProducts")}</CardTitle></CardHeader>
          <CardContent><TopProductsChart data={topProducts} /></CardContent>
        </Card>
      </div>

      {/* Recent Shipments */}
      {data.recentShipments && data.recentShipments.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("dashboard.recentShipments")}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("shipments.invoiceNumber")}</TableHead>
                  <TableHead>{t("shipments.deliveryDate")}</TableHead>
                  <TableHead className="text-right">{t("sales.stems")}</TableHead>
                  <TableHead className="text-right">{t("shipments.turnover")}</TableHead>
                  <TableHead className="text-right">{t("shipments.netResult")}</TableHead>
                  <TableHead className="text-right">{t("shipments.lots")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentShipments.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      <Link href={`/shipments/${s.id}${supplierId ? `?supplierId=${supplierId}` : ""}`} className="text-primary hover:underline">{s.invoiceNumber}</Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.invoiceDate ? formatDate(s.invoiceDate) : "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(s.totalStems)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(s.totalTurnover)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(s.netResult)}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.lotCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

