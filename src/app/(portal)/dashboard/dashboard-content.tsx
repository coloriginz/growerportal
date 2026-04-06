"use client";

import { useMemo } from "react";
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
import {
  RiPlantLine,
  RiMoneyEuroCircleLine,
  RiLineChartLine,
  RiCalendarLine,
  RiArrowUpSLine,
  RiArrowDownSLine,
  RiShieldCheckLine,
  RiRefreshLine,
  RiArrowUpDownLine,
} from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import { SalesChart } from "@/components/charts/sales-chart";
import { TopProductsChart } from "@/components/charts/top-products-chart";
import { formatCurrency, formatNumber, formatPrice, formatDate, formatTime } from "@/lib/format";
import { getSeasonLabel } from "@/lib/season";
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
  seasonStartMonth?: number;
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
    return (
      <div className="page-content">
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <RiArrowUpDownLine className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="mt-6 text-lg font-semibold">{t("dashboard.selectGrowerTitle")}</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            {t("dashboard.selectGrowerDescription")}
          </p>
        </div>
      </div>
    );
  }

  return <GrowerDashboard data={data} lastUpdated={lastUpdated} refetch={refetch} />;
}

// ─── GROWER DASHBOARD (existing) ────────────────────

function GrowerDashboard({ data, lastUpdated, refetch }: { data: DashboardData; lastUpdated: Date | null; refetch: () => void }) {
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
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard title={t("dashboard.avgPrice")} value={formatPrice(data.avgPriceYTD)} icon={RiLineChartLine} change={priceChange} changeLabel={vsLabel} />
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

