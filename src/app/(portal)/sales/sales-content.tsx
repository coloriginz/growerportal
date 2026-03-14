"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("sales.title")}</h1>
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
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">
                  {t("sales.totalStems")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatNumber(data.totalStems)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">
                  {t("sales.totalTurnover")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatCurrency(data.totalTurnover)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">
                  {t("sales.avgPrice")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatPrice(data.avgPrice)}</p>
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
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value: unknown) => formatNumber(value as number)} />
                    <Bar
                      dataKey="stems"
                      name={t("sales.stems")}
                      fill="oklch(0.546 0.245 262.881)"
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
            <CardContent>
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
                      <TableCell>{row.salesType}</TableCell>
                      <TableCell className="text-right">{formatNumber(row.stems)}</TableCell>
                      <TableCell className="text-right">{formatCurrencyDetailed(row.turnover)}</TableCell>
                      <TableCell className="text-right">{formatPrice(row.avgPrice)}</TableCell>
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
            <CardContent>
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
                      <TableCell>{row.product}</TableCell>
                      <TableCell className="text-right">{formatNumber(row.stems)}</TableCell>
                      <TableCell className="text-right">{formatCurrencyDetailed(row.turnover)}</TableCell>
                      <TableCell className="text-right">{formatPrice(row.avgPrice)}</TableCell>
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
