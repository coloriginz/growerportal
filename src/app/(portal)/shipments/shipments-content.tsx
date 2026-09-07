"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { SelectSupplierPrompt } from "@/components/ui/select-supplier-prompt";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShipmentStatusBadge } from "@/components/ui/shipment-status-badge";
import { ListPagination } from "@/components/list-pagination";
import { SHIPMENT_STATUSES, type ShipmentStatus } from "@/lib/shipment-status";
import { RiSearchLine, RiShipLine, RiDownloadLine, RiRefreshLine } from "@remixicon/react";
import { exportToCSV } from "@/lib/export-csv";
import { fetchAllPages, type PagedResponse } from "@/lib/fetch-all-pages";
import { useFetch } from "@/hooks/use-fetch";
import { ErrorState } from "@/components/ui/error-state";
import { formatTime } from "@/lib/format";
import { useLanguage } from "@/components/providers/language-provider";
import {
  formatCurrencyDetailed,
  formatNumber,
  formatDate,
} from "@/lib/format";

interface ShipmentRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  deliveryDate: string;
  totalTurnover: number;
  totalCosts: number;
  netResult: number;
  lotCount: number;
  costCount: number;
  totalStems: number;
  soldStems: number;
  status: ShipmentStatus;
}

const STATUS_LABEL_KEYS = {
  selling: "shipments.statusSelling",
  finalizing: "shipments.statusFinalizing",
  completed: "shipments.statusCompleted",
} as const;

const PAGE_SIZE = 50;

export function ShipmentsContent({ supplierId }: { supplierId: string | null }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const { t } = useLanguage();
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // De filters zonder paginanummer. Dat is ook precies wat de CSV-export vraagt,
  // maar dan over alle pagina's.
  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (supplierId) p.set("supplierId", supplierId);
    if (debouncedSearch) p.set("search", debouncedSearch);
    if (statusFilter !== "all") p.set("status", statusFilter);
    return p.toString();
  }, [supplierId, debouncedSearch, statusFilter]);

  // Zonder leverancier toont dit scherm de leverancierskiezer, dus dan ook niet
  // ophalen: de route zou anders over alle leveranciers aggregeren voor een
  // antwoord dat nergens terechtkomt.
  const url = useMemo(() => {
    if (!supplierId) return null;
    const p = new URLSearchParams(params);
    p.set("page", String(page));
    p.set("limit", String(PAGE_SIZE));
    return "/api/shipments?" + p.toString();
  }, [supplierId, params, page]);

  const { data, loading, error, lastUpdated, refetch } =
    useFetch<PagedResponse<ShipmentRow>>(url);

  const shipments = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;
  // Het paginanummer uit het antwoord en niet uit de lokale state: de route
  // knipt een te hoog nummer terug naar de laatste pagina, en dan hoort de
  // kiezer die laatste pagina te tonen en geen nummer dat er niet meer is.
  const currentPage = data?.page ?? page;

  async function handleExport() {
    setExporting(true);
    try {
      const rows = await fetchAllPages<ShipmentRow>("/api/shipments?" + params);
      exportToCSV(
        rows.map((s) => ({ ...s, statusLabel: t(STATUS_LABEL_KEYS[s.status]) })),
        "shipments-export",
        [
          { key: "invoiceNumber", header: "Invoice Number" },
          { key: "deliveryDate", header: "Delivery Date" },
          { key: "statusLabel", header: "Status" },
          { key: "lotCount", header: "Lots" },
          { key: "totalStems", header: "Stems" },
          { key: "soldStems", header: "Sold Stems" },
          { key: "totalTurnover", header: "Turnover" },
          { key: "totalCosts", header: "Costs" },
          { key: "netResult", header: "Net Result" },
        ]
      );
    } catch {
      toast.error(t("common.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  if (!supplierId) return <SelectSupplierPrompt />;

  if (error) {
    return (
      <div className="page-content">
        <ErrorState onRetry={refetch} />
      </div>
    );
  }

  const shipmentsView = (
    <>
      <div className="page-header">
        <h1>{t("shipments.title")}</h1>
        <div className="flex items-center gap-2">
          {total > 0 && (
            <Button variant="outline" size="sm" disabled={exporting} onClick={handleExport}>
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

      {/* Search */}
      <div className="filter-bar">
        <div className="relative flex-1 min-w-[200px]">
          <RiSearchLine className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder={t("shipments.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            if (v !== null) {
              setStatusFilter(v as ShipmentStatus | "all");
              setPage(1);
            }
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue>
              {statusFilter === "all"
                ? t("shipments.allStatuses")
                : t(STATUS_LABEL_KEYS[statusFilter])}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("shipments.allStatuses")}</SelectItem>
            {SHIPMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(STATUS_LABEL_KEYS[s])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Mobile card list */}
      <div className="space-y-3 md:hidden">
        {shipments.map((s) => (
          <Link key={s.id} href={`/shipments/${s.id}${supplierId ? `?supplierId=${supplierId}` : ""}`} className="block">
            <Card className="transition-colors hover:bg-accent/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-primary">{s.invoiceNumber}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(s.deliveryDate)}</span>
                </div>
                <div className="mb-2">
                  <ShipmentStatusBadge status={s.status} />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("shipments.lots")}</span>
                    <span className="tabular-nums font-medium">{s.lotCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("shipments.stems")}</span>
                    <span className="tabular-nums font-medium">{formatNumber(s.totalStems)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("shipments.turnover")}</span>
                    <span className="tabular-nums font-medium">{formatCurrencyDetailed(s.totalTurnover)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("shipments.costs")}</span>
                    <span className="tabular-nums font-medium">{formatCurrencyDetailed(s.totalCosts)}</span>
                  </div>
                  <div className="col-span-2 flex justify-between border-t pt-1 mt-1">
                    <span className="text-muted-foreground font-medium">{t("shipments.netResult")}</span>
                    <span className={`tabular-nums font-semibold ${s.netResult >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatCurrencyDetailed(s.netResult)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {shipments.length === 0 && !loading && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <RiShipLine />
            </div>
            <p className="empty-state-text">{t("common.noResults")}</p>
          </div>
        )}
      </div>

      {/* Desktop table */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("shipments.shipmentNumber")}</TableHead>
                <TableHead>{t("shipments.deliveryDate")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="text-right">{t("shipments.lots")}</TableHead>
                <TableHead className="text-right">{t("shipments.stems")}</TableHead>
                <TableHead className="text-right">{t("shipments.turnover")}</TableHead>
                <TableHead className="text-right">{t("shipments.costs")}</TableHead>
                <TableHead className="text-right">{t("shipments.netResult")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shipments.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/shipments/${s.id}${supplierId ? `?supplierId=${supplierId}` : ""}`)}
                >
                  <TableCell className="font-medium text-primary">
                    {s.invoiceNumber}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(s.deliveryDate)}</TableCell>
                  <TableCell>
                    <ShipmentStatusBadge status={s.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.lotCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(s.totalStems)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrencyDetailed(s.totalTurnover)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrencyDetailed(s.totalCosts)}</TableCell>
                  <TableCell className={`text-right tabular-nums font-medium ${s.netResult >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {formatCurrencyDetailed(s.netResult)}
                  </TableCell>
                </TableRow>
              ))}
              {shipments.length === 0 && !loading && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="py-0">
                    <div className="empty-state">
                      <div className="empty-state-icon">
                        <RiShipLine />
                      </div>
                      <p className="empty-state-text">{t("common.noResults")}</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ListPagination
        page={currentPage}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        disabled={loading}
      />
    </>
  );

  return <div className="page-content">{shipmentsView}</div>;
}
