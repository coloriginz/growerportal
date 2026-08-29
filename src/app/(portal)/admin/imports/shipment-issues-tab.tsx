"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/pagination";
import { pageLabels } from "@/components/pagination-labels";
import { RiRefreshLine, RiSearchLine } from "@remixicon/react";
import { useFetch } from "@/hooks/use-fetch";
import { ErrorState } from "@/components/ui/error-state";
import { useLanguage } from "@/components/providers/language-provider";
import { formatDate, formatNumber } from "@/lib/format";

type IssueType = "missing-pdf" | "stem-gap";

interface IssueRow {
  id: string;
  invoiceNumber: string;
  ourInvoiceNumber: string | null;
  deliveryDate: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  deliveredStems: number;
  soldStems: number;
  missingStems: number;
  costCount: number;
  hasPdf: boolean;
}

interface IssueResponse {
  type: IssueType;
  items: IssueRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: Record<IssueType, number>;
}

const LIMIT = 25;

const TABS: { type: IssueType; label: string; explanation: string }[] = [
  {
    type: "missing-pdf",
    label: "Settled without sales sheet",
    explanation:
      "Settled deliveries (cost lines present) with no sales sheet PDF linked. The supplier is missing the document; the shipment status is unaffected.",
  },
  {
    type: "stem-gap",
    label: "Settled with missing stems",
    explanation:
      "Settled deliveries where fewer stems were sold than delivered. Usually an order line the warehouse filled in later — the settlement decides the status, so the gap would otherwise go unnoticed.",
  },
];

export function ShipmentIssuesTab() {
  const { t } = useLanguage();
  const [type, setType] = useState<IssueType>("missing-pdf");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set("type", type);
    params.set("page", String(page));
    params.set("limit", String(LIMIT));
    if (debouncedSearch) params.set("search", debouncedSearch);
    return `/api/admin/shipment-issues?${params.toString()}`;
  }, [type, page, debouncedSearch]);

  const { data, loading, error, refetch } = useFetch<IssueResponse>(url);

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  if (error) return <ErrorState onRetry={handleRetry} />;

  const items = data?.items || [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const currentPage = data?.page ?? page;
  const pageStart = total === 0 ? 0 : (currentPage - 1) * LIMIT + 1;
  const pageEnd = Math.min(currentPage * LIMIT, total);
  const active = TABS.find((tab) => tab.type === type)!;
  const showStems = type === "stem-gap";

  return (
    <div className="space-y-6">
      {/* Sub-tabs: elk hun eigen afwijking, met het openstaande aantal erbij. */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Button
            key={tab.type}
            variant={tab.type === type ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setType(tab.type);
              setPage(1);
            }}
          >
            {tab.label}
            {data?.counts?.[tab.type] !== undefined && (
              <span className="ml-2 text-xs opacity-80">
                {formatNumber(data.counts[tab.type])}
              </span>
            )}
          </Button>
        ))}
      </div>

      <p className="text-sm text-muted-foreground max-w-3xl">
        {active.explanation}
      </p>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-[400px]">
          <RiSearchLine className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search invoice number, supplier..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RiRefreshLine className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      <Table stickyHeader>
        <TableHeader>
          <TableRow>
            <TableHead>{t("shipments.deliveryDate")}</TableHead>
            <TableHead>{t("shipments.shipmentNumber")}</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead className="text-right">{t("shipments.costs")}</TableHead>
            {showStems ? (
              <>
                <TableHead className="text-right">{t("shipments.stems")}</TableHead>
                <TableHead className="text-right">{t("shipments.soldStems")}</TableHead>
                <TableHead className="text-right">Missing</TableHead>
              </>
            ) : (
              <TableHead className="text-right">{t("shipments.stems")}</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && !data ? (
            <TableRow>
              <TableCell colSpan={showStems ? 7 : 5} className="h-24 text-center text-muted-foreground">
                {t("common.loading")}
              </TableCell>
            </TableRow>
          ) : items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={showStems ? 7 : 5} className="h-24 text-center text-muted-foreground">
                {debouncedSearch ? t("common.noResults") : "Nothing to resolve here"}
              </TableCell>
            </TableRow>
          ) : (
            items.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap">
                  {formatDate(row.deliveryDate)}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/shipments/${row.id}?supplierId=${row.supplierId}`}
                    className="text-primary hover:underline"
                  >
                    {row.invoiceNumber}
                  </Link>
                  {row.ourInvoiceNumber && (
                    <span className="text-muted-foreground text-xs">
                      {" "}
                      ({row.ourInvoiceNumber})
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="font-medium">{row.supplierCode}</span>{" "}
                  <span className="text-muted-foreground text-xs">
                    {row.supplierName}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.costCount}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(row.deliveredStems)}
                </TableCell>
                {showStems && (
                  <>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(row.soldStems)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium text-amber-600 dark:text-amber-400">
                      {formatNumber(row.missingStems)}
                    </TableCell>
                  </>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {pageStart}-{pageEnd} of {formatNumber(total)}
          </p>
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            onPageChange={setPage}
            labels={pageLabels}
            disabled={loading}
          />
        </div>
      )}
    </div>
  );
}
