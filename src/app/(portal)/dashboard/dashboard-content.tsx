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
import {
  RiPlantLine,
  RiMoneyEuroCircleLine,
  RiLineChartLine,
  RiCalendarLine,
  RiArrowUpSLine,
  RiArrowDownSLine,
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
import { useLanguage } from "@/components/providers/language-provider";
import { SalesChart } from "@/components/charts/sales-chart";
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
  recentTransactions: { id: string; lotId: string; date: string; salesType: string; stems: number; amount: number; createdAt: string; lotNumber: string; productName: string; supplierCode: string; supplierName: string }[];
  recentLots: { id: string; lotNumber: string; productName: string; deliveryDate: string | null; totalStems: number; createdAt: string; supplierCode: string; supplierName: string }[];
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
  monthlySales: { month: string; stems: number; turnover: number; lastYearStems: number; lastYearTurnover: number }[];
  topProducts: { name: string; stems: number; turnover: number }[];
  seasonStartMonth?: number;
  recentLots?: { id: string; lotNumber: string; productName: string; totalStems: number; avgPrice: number; deliveryDate: string; status: string }[];
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
                    <Link href={`/lots/${tx.lotId}`} className="text-primary hover:underline">{tx.lotNumber}</Link>
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
                    <Link href={`/lots/${lot.id}`} className="text-primary hover:underline">{lot.lotNumber}</Link>
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

export function DashboardContent({ supplierId }: { supplierId: string | null }) {
  const { t } = useLanguage();
  const url = useMemo(() => {
    const params = supplierId ? `?supplierId=${supplierId}` : "";
    return `/api/dashboard${params}`;
  }, [supplierId]);
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
    return <AdminOverview data={data as AggregateData} lastUpdated={lastUpdated} refetch={refetch} />;
  }

  return <SupplierDashboard data={data as SupplierDashboardData} lastUpdated={lastUpdated} refetch={refetch} />;
}

// ─── SUPPLIER DASHBOARD (existing) ────────────────────

function SupplierDashboard({ data, lastUpdated, refetch }: { data: SupplierDashboardData; lastUpdated: Date | null; refetch: () => void }) {
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

