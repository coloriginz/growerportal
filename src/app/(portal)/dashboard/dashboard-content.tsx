"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RiPlantLine,
  RiMoneyEuroCircleLine,
  RiLineChartLine,
  RiCalendarLine,
  RiArrowUpSLine,
  RiArrowDownSLine,
} from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import { SalesChart } from "@/components/charts/sales-chart";
import { TopProductsChart } from "@/components/charts/top-products-chart";
import { formatCurrency, formatNumber } from "@/lib/format";

interface DashboardData {
  stemsToday: number;
  stemsYesterday: number;
  stemsYTD: number;
  stemsYTDLastYear: number;
  turnoverYTD: number;
  turnoverYTDLastYear: number;
  avgPriceYTD: number;
  avgPriceYTDLastYear: number;
  monthlySales: { month: string; stems: number; turnover: number; lastYearStems: number; lastYearTurnover: number }[];
  topProducts: { name: string; stems: number; turnover: number }[];
}

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  change,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  change?: number;
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
            {change.toFixed(1)}% vs. last year
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
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const { t } = useLanguage();

  useEffect(() => {
    async function fetchData() {
      try {
        const params = growerId ? `?growerId=${growerId}` : "";
        const res = await fetch(`/api/dashboard${params}`);
        if (res.ok) {
          setData(await res.json());
        }
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [growerId]);

  if (loading || !data) {
    return <DashboardSkeleton />;
  }

  const stemsChange =
    data.stemsYTDLastYear > 0
      ? ((data.stemsYTD - data.stemsYTDLastYear) / data.stemsYTDLastYear) * 100
      : 0;
  const turnoverChange =
    data.turnoverYTDLastYear > 0
      ? ((data.turnoverYTD - data.turnoverYTDLastYear) /
          data.turnoverYTDLastYear) *
        100
      : 0;
  const _priceChange =
    data.avgPriceYTDLastYear > 0
      ? ((data.avgPriceYTD - data.avgPriceYTDLastYear) /
          data.avgPriceYTDLastYear) *
        100
      : 0;

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>{t("dashboard.title")}</h1>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title={t("dashboard.stemsToday")}
          value={formatNumber(data.stemsToday)}
          icon={RiPlantLine}
        />
        <KpiCard
          title={t("dashboard.stemsYesterday")}
          value={formatNumber(data.stemsYesterday)}
          icon={RiCalendarLine}
        />
        <KpiCard
          title={t("dashboard.stemsYTD")}
          value={formatNumber(data.stemsYTD)}
          icon={RiLineChartLine}
          change={stemsChange}
        />
        <KpiCard
          title={t("dashboard.turnoverYTD")}
          value={formatCurrency(data.turnoverYTD)}
          icon={RiMoneyEuroCircleLine}
          change={turnoverChange}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.salesOverview")}</CardTitle>
          </CardHeader>
          <CardContent>
            <SalesChart data={data.monthlySales} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.topProducts")}</CardTitle>
          </CardHeader>
          <CardContent>
            <TopProductsChart data={data.topProducts} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
