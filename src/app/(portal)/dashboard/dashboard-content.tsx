"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
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
import {
  RiPlantLine,
  RiMoneyEuroCircleLine,
  RiLineChartLine,
  RiCalendarLine,
  RiArrowUpSLine,
  RiArrowDownSLine,
  RiShieldCheckLine,
  RiRefreshLine,
  RiArrowRightSLine,
  RiCalendarScheduleLine,
} from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import { SalesChart } from "@/components/charts/sales-chart";
import { TopProductsChart } from "@/components/charts/top-products-chart";
import { formatCurrency, formatNumber, formatPrice, formatDate, formatTime } from "@/lib/format";
import { useFetch } from "@/hooks/use-fetch";
import { ErrorState } from "@/components/ui/error-state";

interface DashboardData {
  aggregate?: boolean;
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
  monthlySales: { month: string; stems: number; turnover: number; lastYearStems: number; lastYearTurnover: number }[];
  topProducts: { name: string; stems: number; turnover: number }[];
  recentLots?: { id: string; lotNumber: string; productName: string; totalStems: number; avgPrice: number; deliveryDate: string; status: string }[];
  topGrowers?: { id: string; code: string; name: string; stems: number; turnover: number }[];
  upcomingForecasts?: { week: string; year: number; stems: number; growers: number }[];
}

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

export function DashboardContent({ growerId }: { growerId: string | null }) {
  const { t } = useLanguage();
  const url = useMemo(() => {
    const params = growerId ? `?growerId=${growerId}` : "";
    return `/api/dashboard${params}`;
  }, [growerId]);
  const { data, loading, error, lastUpdated, refetch } = useFetch<DashboardData>(url);

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
    return <AggregateDashboard data={data} lastUpdated={lastUpdated} refetch={refetch} />;
  }

  return <GrowerDashboard data={data} lastUpdated={lastUpdated} refetch={refetch} />;
}

// ─── GROWER DASHBOARD (existing) ────────────────────

function GrowerDashboard({ data, lastUpdated, refetch }: { data: DashboardData; lastUpdated: Date | null; refetch: () => void }) {
  const { t } = useLanguage();

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
  const vsLastYear = t("dashboard.vsLastYear");

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
        <KpiCard title={t("dashboard.stemsYTD")} value={formatNumber(data.stemsYTD)} icon={RiLineChartLine} change={stemsChange} changeLabel={vsLastYear} />
        <KpiCard title={t("dashboard.turnoverYTD")} value={formatCurrency(data.turnoverYTD)} icon={RiMoneyEuroCircleLine} change={turnoverChange} changeLabel={vsLastYear} />
      </div>

      {/* Secondary KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard title={t("dashboard.avgPrice")} value={formatPrice(data.avgPriceYTD)} icon={RiLineChartLine} change={priceChange} changeLabel={vsLastYear} />
        <KpiCard title={t("dashboard.netYieldPerStem")} value={formatPrice(data.netYieldPerStem || 0)} icon={RiMoneyEuroCircleLine} />
        <KpiCard title={t("dashboard.qualityRate")} value={`${(data.qualityRate || 100).toFixed(1)}%`} icon={RiShieldCheckLine} />
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("dashboard.salesOverview")}</CardTitle></CardHeader>
          <CardContent><SalesChart data={data.monthlySales} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("dashboard.topProducts")}</CardTitle></CardHeader>
          <CardContent><TopProductsChart data={data.topProducts} /></CardContent>
        </Card>
      </div>

      {/* Recent Lots */}
      {data.recentLots && data.recentLots.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("dashboard.recentLots")}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("lots.lotNumber")}</TableHead>
                  <TableHead>{t("lots.product")}</TableHead>
                  <TableHead className="text-right">{t("lots.totalStems")}</TableHead>
                  <TableHead className="text-right">{t("lots.avgPrice")}</TableHead>
                  <TableHead>{t("lots.deliveryDate")}</TableHead>
                  <TableHead>{t("lots.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentLots.map((lot) => (
                  <TableRow key={lot.id}>
                    <TableCell className="font-medium">
                      <Link href={`/lots/${lot.id}`} className="text-primary hover:underline">{lot.lotNumber}</Link>
                    </TableCell>
                    <TableCell>{lot.productName}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(lot.totalStems)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPrice(lot.avgPrice)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(lot.deliveryDate)}</TableCell>
                    <TableCell>
                      <Badge variant={lot.status === "sold" ? "default" : lot.status === "selling" ? "secondary" : "outline"}>
                        {t(`lots.${lot.status === "in_transit" ? "inTransit" : lot.status}` as Parameters<typeof t>[0])}
                      </Badge>
                    </TableCell>
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

// ─── AGGREGATE DASHBOARD (no grower selected) ───────

function AggregateDashboard({ data, lastUpdated, refetch }: { data: DashboardData; lastUpdated: Date | null; refetch: () => void }) {
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();

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
  const vsLastYear = t("dashboard.vsLastYear");

  const selectGrower = (growerId: string) => {
    router.push(`${pathname}?growerId=${growerId}`);
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>{t("dashboard.companyOverview")}</h1>
        </div>
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
        <KpiCard title={t("dashboard.stemsYTD")} value={formatNumber(data.stemsYTD)} icon={RiLineChartLine} change={stemsChange} changeLabel={vsLastYear} />
        <KpiCard title={t("dashboard.turnoverYTD")} value={formatCurrency(data.turnoverYTD)} icon={RiMoneyEuroCircleLine} change={turnoverChange} changeLabel={vsLastYear} />
      </div>

      {/* Avg Price */}
      <div className="grid gap-4 sm:grid-cols-2">
        <KpiCard title={t("dashboard.avgPrice")} value={formatPrice(data.avgPriceYTD)} icon={RiLineChartLine} change={priceChange} changeLabel={vsLastYear} />
        {data.upcomingForecasts && data.upcomingForecasts.length > 0 && (() => {
          const totalForecastStems = data.upcomingForecasts!.reduce((s, f) => s + f.stems, 0);
          return (
            <KpiCard
              title={t("dashboard.upcomingForecasts")}
              value={formatNumber(totalForecastStems)}
              subtitle={`${data.upcomingForecasts![0].week}–${data.upcomingForecasts![data.upcomingForecasts!.length - 1].week}`}
              icon={RiCalendarScheduleLine}
            />
          );
        })()}
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("dashboard.salesOverview")}</CardTitle></CardHeader>
          <CardContent><SalesChart data={data.monthlySales} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("dashboard.topProducts")}</CardTitle></CardHeader>
          <CardContent><TopProductsChart data={data.topProducts} /></CardContent>
        </Card>
      </div>

      {/* Bottom row: Top Growers + Upcoming Forecasts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Growers */}
        {data.topGrowers && data.topGrowers.length > 0 && (
          <Card>
            <CardHeader><CardTitle>{t("dashboard.topGrowers")}</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("dashboard.grower")}</TableHead>
                    <TableHead className="text-right">{t("sales.stems")}</TableHead>
                    <TableHead className="text-right">{t("sales.turnover")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topGrowers.map((grower) => (
                    <TableRow
                      key={grower.id}
                      className="cursor-pointer"
                      onClick={() => selectGrower(grower.id)}
                    >
                      <TableCell>
                        <div className="font-medium">{grower.code}</div>
                        <div className="text-xs text-muted-foreground">{grower.name}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(grower.stems)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(grower.turnover)}</TableCell>
                      <TableCell>
                        <RiArrowRightSLine className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Upcoming Forecasts */}
        {data.upcomingForecasts && data.upcomingForecasts.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{t("dashboard.upcomingForecasts")}</CardTitle>
                <Link href="/forecasts" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
                  {t("dashboard.selectToView")}
                  <RiArrowRightSLine className="ml-1 h-4 w-4" />
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-3">
                {data.upcomingForecasts.map((fw) => (
                  <div key={fw.week} className="rounded-lg border p-4 text-center">
                    <div className="text-sm font-semibold text-muted-foreground">{fw.week}</div>
                    <div className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(fw.stems)}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {fw.growers} {fw.growers === 1 ? t("dashboard.grower").toLowerCase() : t("dashboard.topGrowers").toLowerCase().replace("top ", "")}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
