"use client";

import { useState, useMemo } from "react";
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
import { Button } from "@/components/ui/button";
import { RiPlantLine, RiMoneyEuroCircleLine, RiLineChartLine, RiDownloadLine } from "@remixicon/react";
import { exportToCSV } from "@/lib/export-csv";
import { useFetch } from "@/hooks/use-fetch";
import { ErrorState } from "@/components/ui/error-state";
import { formatTime } from "@/lib/format";
import { RiRefreshLine } from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import {
  formatCurrency,
  formatCurrencyDetailed,
  formatNumber,
  formatPrice,
} from "@/lib/format";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getISOWeek } from "date-fns";

interface SalesData {
  totalStems: number;
  totalTurnover: number;
  avgPrice: number;
  lastYearComparison: { totalStems: number; totalTurnover: number; avgPrice: number } | null;
  bySalesType: { salesType: string; stems: number; turnover: number; avgPrice: number }[];
  byProduct: { product: string; stems: number; turnover: number; avgPrice: number }[];
  daily: { date: string; stems: number; turnover: number }[];
}

type Period = "today" | "yesterday" | "week" | "month" | "ytd" | "weeknr";

export function SalesContent({ growerId }: { growerId: string | null }) {
  const [period, setPeriod] = useState<Period>("ytd");
  const currentWeek = getISOWeek(new Date());
  const currentYear = new Date().getFullYear();
  const [selectedWeek, setSelectedWeek] = useState(currentWeek);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const { t } = useLanguage();

  const url = useMemo(() => {
    const params = new URLSearchParams({ period });
    if (growerId) params.set("growerId", growerId);
    if (period === "weeknr") {
      params.set("week", String(selectedWeek));
      params.set("year", String(selectedYear));
    }
    return `/api/sales?${params}`;
  }, [growerId, period, selectedWeek, selectedYear]);
  const { data, loading, error, lastUpdated, refetch } = useFetch<SalesData>(url);

  if (error) {
    return (
      <div className="page-content">
        <ErrorState onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>{t("sales.title")}</h1>
        <div className="flex items-center gap-2">
          {data && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const allRows = [
                  ...data.bySalesType.map((r) => ({ type: "Channel", name: r.salesType, stems: r.stems, turnover: r.turnover, avgPrice: r.avgPrice })),
                  ...data.byProduct.map((r) => ({ type: "Product", name: r.product, stems: r.stems, turnover: r.turnover, avgPrice: r.avgPrice })),
                ];
                exportToCSV(allRows, `sales-${period}`, [
                  { key: "type", header: "Type" },
                  { key: "name", header: "Name" },
                  { key: "stems", header: "Stems" },
                  { key: "turnover", header: "Turnover" },
                  { key: "avgPrice", header: "Avg Price" },
                ]);
              }}
            >
              <RiDownloadLine className="mr-2 h-4 w-4" />
              {t("common.exportCSV")}
            </Button>
          )}
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              {formatTime(lastUpdated)}
            </span>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refetch}>
            <RiRefreshLine className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Period tabs */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList>
            <TabsTrigger value="today">{t("sales.today")}</TabsTrigger>
            <TabsTrigger value="yesterday">{t("sales.yesterday")}</TabsTrigger>
            <TabsTrigger value="week">{t("sales.thisWeek")}</TabsTrigger>
            <TabsTrigger value="month">{t("sales.thisMonth")}</TabsTrigger>
            <TabsTrigger value="ytd">{t("sales.ytd")}</TabsTrigger>
            <TabsTrigger value="weeknr">{t("sales.weekNr")}</TabsTrigger>
          </TabsList>
        </Tabs>
        {period === "weeknr" && (
          <div className="flex items-center gap-2">
            <Select value={String(selectedWeek)} onValueChange={(v) => { if (v !== null) setSelectedWeek(parseInt(v)); }}>
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 52 }, (_, i) => i + 1).map((w) => (
                  <SelectItem key={w} value={String(w)}>Wk {w}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(selectedYear)} onValueChange={(v) => { if (v !== null) setSelectedYear(parseInt(v)); }}>
              <SelectTrigger className="w-[90px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[currentYear - 1, currentYear].map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

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
                {data.lastYearComparison && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("dashboard.vsLastYear")}: {formatNumber(data.lastYearComparison.totalStems)}
                  </p>
                )}
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
                {data.lastYearComparison && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("dashboard.vsLastYear")}: {formatCurrency(data.lastYearComparison.totalTurnover)}
                  </p>
                )}
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
                {data.lastYearComparison && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("dashboard.vsLastYear")}: {formatPrice(data.lastYearComparison.avgPrice)}
                  </p>
                )}
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
