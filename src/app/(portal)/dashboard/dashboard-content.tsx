"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RiPlantLine,
  RiMoneyEuroCircleLine,
  RiLineChartLine,
  RiCalendarLine,
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
        <CardTitle className="text-muted-foreground text-sm font-medium">
          {title}
        </CardTitle>
        <Icon className="text-muted-foreground h-5 w-5" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {change !== undefined && (
          <p
            className={`mt-1 text-xs ${change >= 0 ? "text-emerald-600" : "text-red-600"}`}
          >
            {change >= 0 ? "+" : ""}
            {change.toFixed(1)}% vs. last year
          </p>
        )}
        {subtitle && (
          <p className="text-muted-foreground mt-1 text-xs">{subtitle}</p>
        )}
      </CardContent>
    </Card>
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
    return null;
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
  const priceChange =
    data.avgPriceYTDLastYear > 0
      ? ((data.avgPriceYTD - data.avgPriceYTDLastYear) /
          data.avgPriceYTDLastYear) *
        100
      : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("dashboard.title")}</h1>

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
      <div className="grid gap-4 lg:grid-cols-2">
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
