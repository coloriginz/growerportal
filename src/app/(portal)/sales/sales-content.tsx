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
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import { RiFilterOffLine } from "@remixicon/react";
import { PriceTrendChart } from "@/components/charts/price-trend-chart";
import { StemLengthChart } from "@/components/charts/stem-length-chart";
import { ChannelDistributionChart } from "@/components/charts/channel-distribution-chart";

interface FiltersData {
  products: string[];
  salesTypes: string[];
  stemLengths: string[];
  growers: { id: string; label: string }[];
}

interface TrendsData {
  priceTrend: Record<string, string | number>[];
  products: string[];
  stemLengthBreakdown: { length: string; stems: number; turnover: number; avgPrice: number }[];
  channelDistribution: Record<string, string | number>[];
  channels: string[];
}

interface SalesData {
  totalStems: number;
  totalTurnover: number;
  avgPrice: number;
  lastYearComparison: { totalStems: number; totalTurnover: number; avgPrice: number } | null;
  bySalesType: { salesType: string; stems: number; turnover: number; avgPrice: number }[];
  byProduct: { product: string; stems: number; turnover: number; avgPrice: number }[];
  byGrower: { grower: string; stems: number; turnover: number; avgPrice: number }[];
  daily: { date: string; stems: number; turnover: number }[];
}

type Period = "today" | "yesterday" | "week" | "month" | "ytd" | "weeknr" | "custom";

export function SalesContent({ supplierId }: { supplierId: string | null }) {
  const [period, setPeriod] = useState<Period>("ytd");
  const currentWeek = getISOWeek(new Date());
  const currentYear = new Date().getFullYear();
  const [selectedWeek, setSelectedWeek] = useState(currentWeek);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterProducts, setFilterProducts] = useState<string[]>([]);
  const [filterSalesTypes, setFilterSalesTypes] = useState<string[]>([]);
  const [filterStemLengths, setFilterStemLengths] = useState<string[]>([]);
  const [filterGrowers, setFilterGrowers] = useState<string[]>([]);
  const { t } = useLanguage();

  // Fetch available filter options
  const filtersUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (supplierId) params.set("supplierId", supplierId);
    return `/api/sales/filters?${params}`;
  }, [supplierId]);
  const { data: filterOptions } = useFetch<FiltersData>(filtersUrl);

  const hasActiveFilters = filterProducts.length > 0 || filterSalesTypes.length > 0 || filterStemLengths.length > 0 || filterGrowers.length > 0;

  const clearAllFilters = () => {
    setFilterProducts([]);
    setFilterSalesTypes([]);
    setFilterStemLengths([]);
    setFilterGrowers([]);
  };

  const url = useMemo(() => {
    const params = new URLSearchParams({ period });
    if (supplierId) params.set("supplierId", supplierId);
    if (period === "weeknr") {
      params.set("week", String(selectedWeek));
      params.set("year", String(selectedYear));
    }
    if (period === "custom") {
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
    }
    for (const p of filterProducts) params.append("product", p);
    for (const s of filterSalesTypes) params.append("salesType", s);
    for (const l of filterStemLengths) params.append("stemLength", l.replace(" cm", ""));
    for (const label of filterGrowers) {
      const g = filterOptions?.growers?.find((gr) => gr.label === label);
      if (g) params.append("grower", g.id);
    }
    return `/api/sales?${params}`;
  }, [supplierId, period, selectedWeek, selectedYear, dateFrom, dateTo, filterProducts, filterSalesTypes, filterStemLengths, filterGrowers, filterOptions]);
  const { data, loading, error, lastUpdated, refetch } = useFetch<SalesData>(url);

  const trendsUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (supplierId) params.set("supplierId", supplierId);
    for (const p of filterProducts) params.append("product", p);
    for (const s of filterSalesTypes) params.append("salesType", s);
    for (const l of filterStemLengths) params.append("stemLength", l.replace(" cm", ""));
    for (const label of filterGrowers) {
      const g = filterOptions?.growers?.find((gr) => gr.label === label);
      if (g) params.append("grower", g.id);
    }
    return `/api/sales/trends?${params}`;
  }, [supplierId, filterProducts, filterSalesTypes, filterStemLengths, filterGrowers, filterOptions]);
  const { data: trends } = useFetch<TrendsData>(trendsUrl);

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
                  ...(data.byGrower || []).map((r) => ({ type: "Grower", name: r.grower, stems: r.stems, turnover: r.turnover, avgPrice: r.avgPrice })),
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
            <TabsTrigger value="custom">{t("sales.custom")}</TabsTrigger>
          </TabsList>
        </Tabs>
        {period === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
            <span className="text-sm text-muted-foreground">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
        )}
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

      {/* Filters */}
      {filterOptions && (
        <div className="flex flex-wrap items-center gap-2">
          {filterOptions.products.length > 1 && (
            <MultiSelectFilter
              label={t("lots.product")}
              options={filterOptions.products}
              selected={filterProducts}
              onChange={setFilterProducts}
            />
          )}
          {filterOptions.salesTypes.length > 1 && (
            <MultiSelectFilter
              label={t("sales.salesType")}
              options={filterOptions.salesTypes}
              selected={filterSalesTypes}
              onChange={setFilterSalesTypes}
            />
          )}
          {filterOptions.stemLengths.length > 1 && (
            <MultiSelectFilter
              label={t("lots.stemLength")}
              options={filterOptions.stemLengths}
              selected={filterStemLengths}
              onChange={setFilterStemLengths}
            />
          )}
          {filterOptions.growers && filterOptions.growers.length > 1 && (
            <MultiSelectFilter
              label="Grower"
              options={filterOptions.growers.map((g) => g.label)}
              selected={filterGrowers}
              onChange={setFilterGrowers}
            />
          )}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
              className="text-muted-foreground"
            >
              <RiFilterOffLine className="mr-1.5 h-4 w-4" />
              {t("common.clearFilters")}
            </Button>
          )}
        </div>
      )}

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
                    <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/50" />
                    <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} tick={{ fill: "currentColor" }} className="text-muted-foreground" />
                    <YAxis fontSize={12} tickLine={false} axisLine={false} tick={{ fill: "currentColor" }} className="text-muted-foreground" />
                    <Tooltip formatter={(value: unknown) => formatNumber(value as number)} />
                    <Bar
                      dataKey="stems"
                      name={t("sales.stems")}
                      fill="var(--chart-1)"
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

          {/* Sales by grower */}
          {data.byGrower && data.byGrower.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Grower</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Grower</TableHead>
                      <TableHead className="text-right">{t("sales.stems")}</TableHead>
                      <TableHead className="text-right">{t("sales.turnover")}</TableHead>
                      <TableHead className="text-right">{t("sales.avgPrice")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byGrower.map((row) => (
                      <TableRow key={row.grower}>
                        <TableCell className="font-medium">{row.grower}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.stems)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrencyDetailed(row.turnover)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPrice(row.avgPrice)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Yearly trends section */}
      {trends && (
        <>
          <h2 className="text-lg font-semibold mt-4">{t("sales.yearlyTrends")}</h2>

          {trends.priceTrend.length > 0 && trends.products.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("sales.priceTrend")}</CardTitle>
              </CardHeader>
              <CardContent>
                <PriceTrendChart data={trends.priceTrend} products={trends.products} />
              </CardContent>
            </Card>
          )}

          {trends.stemLengthBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("sales.stemLengthBreakdown")}</CardTitle>
              </CardHeader>
              <CardContent>
                <StemLengthChart data={trends.stemLengthBreakdown} />
              </CardContent>
            </Card>
          )}

          {trends.channelDistribution.length > 0 && trends.channels.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("sales.channelDistribution")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ChannelDistributionChart data={trends.channelDistribution} channels={trends.channels} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
