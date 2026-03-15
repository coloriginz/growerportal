"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { RiPlantLine, RiMoneyEuroCircleLine, RiLineChartLine } from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import {
  formatCurrency,
  formatCurrencyDetailed,
  formatNumber,
  formatPrice,
} from "@/lib/format";

interface SalesData {
  totalStems: number;
  totalTurnover: number;
  avgPrice: number;
  bySalesType: { salesType: string; stems: number; turnover: number; avgPrice: number }[];
  byProduct: { product: string; stems: number; turnover: number; avgPrice: number }[];
  daily: { date: string; stems: number; turnover: number }[];
}

type Period = "today" | "yesterday" | "week" | "month" | "ytd";

export function SalesContent({ growerId }: { growerId: string | null }) {
  const [data, setData] = useState<SalesData | null>(null);
  const [period, setPeriod] = useState<Period>("ytd");
  const [loading, setLoading] = useState(true);
  const { t } = useLanguage();

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ period });
        if (growerId) params.set("growerId", growerId);
        const res = await fetch(`/api/sales?${params}`);
        if (res.ok) {
          setData(await res.json());
        }
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [growerId, period]);

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>{t("sales.title")}</h1>
      </div>

      {/* Period tabs */}
      <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
        <TabsList>
          <TabsTrigger value="today">{t("sales.today")}</TabsTrigger>
          <TabsTrigger value="yesterday">{t("sales.yesterday")}</TabsTrigger>
          <TabsTrigger value="week">{t("sales.thisWeek")}</TabsTrigger>
          <TabsTrigger value="month">{t("sales.thisMonth")}</TabsTrigger>
          <TabsTrigger value="ytd">{t("sales.ytd")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {data && !loading && (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="kpi-label">
                  {t("sales.totalStems")}
                </CardTitle>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
                  <RiPlantLine className="h-[18px] w-[18px] text-accent-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="kpi-value">{formatNumber(data.totalStems)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="kpi-label">
                  {t("sales.totalTurnover")}
                </CardTitle>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
                  <RiMoneyEuroCircleLine className="h-[18px] w-[18px] text-accent-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="kpi-value">{formatCurrency(data.totalTurnover)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="kpi-label">
                  {t("sales.avgPrice")}
                </CardTitle>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
                  <RiLineChartLine className="h-[18px] w-[18px] text-accent-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="kpi-value">{formatPrice(data.avgPrice)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Daily chart */}
          {data.daily.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("dashboard.salesOverview")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={data.daily}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.91 0.01 80 / 0.8)" />
                    <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} tick={{ fill: "oklch(0.50 0.02 60)" }} />
                    <YAxis fontSize={12} tickLine={false} axisLine={false} tick={{ fill: "oklch(0.50 0.02 60)" }} />
                    <Tooltip formatter={(value: unknown) => formatNumber(value as number)} />
                    <Bar
                      dataKey="stems"
                      name={t("sales.stems")}
                      fill="oklch(0.55 0.15 155)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Sales by channel */}
          <Card>
            <CardHeader>
              <CardTitle>{t("sales.salesType")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("sales.salesType")}</TableHead>
                    <TableHead className="text-right">{t("sales.stems")}</TableHead>
                    <TableHead className="text-right">{t("sales.turnover")}</TableHead>
                    <TableHead className="text-right">{t("sales.avgPrice")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.bySalesType.map((row) => (
                    <TableRow key={row.salesType}>
                      <TableCell className="font-medium">{row.salesType}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.stems)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrencyDetailed(row.turnover)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPrice(row.avgPrice)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Sales by product */}
          <Card>
            <CardHeader>
              <CardTitle>{t("lots.product")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("lots.product")}</TableHead>
                    <TableHead className="text-right">{t("sales.stems")}</TableHead>
                    <TableHead className="text-right">{t("sales.turnover")}</TableHead>
                    <TableHead className="text-right">{t("sales.avgPrice")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byProduct.map((row) => (
                    <TableRow key={row.product}>
                      <TableCell className="font-medium">{row.product}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.stems)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrencyDetailed(row.turnover)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPrice(row.avgPrice)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
