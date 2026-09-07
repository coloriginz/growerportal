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
import { formatDate, formatNumber, formatCurrencyDetailed } from "@/lib/format";

type IssueType = "missing-pdf" | "stem-gap" | "pdf-mismatch";

interface IssueRow {
  id: string;
  invoiceNumber: string;
  ourInvoiceNumber: string | null;
  deliveryDate: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  deliveredStems: number;
  correctionStems: number;
  soldStems: number;
  gapStems: number;
  costCount: number;
  hasPdf: boolean;
  pdfAmount: number | null;
  computedAmount: number | null;
  difference: number | null;
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
    /*
     * "Missing stems" dekte de lading niet meer: de controle telt sinds vandaag
     * het verschil in beide richtingen. Van de 858 leveringen die eruit komen
     * verkopen er 813 minder dan aangevoerd plus correcties, maar 45 juist méér —
     * en dat tweede geval is het vreemdere van de twee, want je kunt niet
     * verkopen wat nooit is binnengekomen. Onder een kop die alleen over
     * ontbrekende stelen praat, zou niemand daarnaar kijken.
     */
    label: "Settled: stems do not add up",
    explanation:
      "Settled deliveries where delivered plus corrections does not equal sold, by more than a few stems — in either direction. Fewer sold usually means an order line the warehouse filled in later; more sold than came in is the stranger case. The settlement decides the status, so the gap would otherwise go unnoticed.",
  },
  {
    type: "pdf-mismatch",
    label: "Sales sheet disagrees",
    explanation:
      "Sales sheets whose PDF net result differs from what the portal computes by more than the match tolerance. Two independent sources that should agree — this list does not say which side is wrong.",
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
  const showAmounts = type === "pdf-mismatch";
  const colSpan = showAmounts ? 6 : showStems ? 8 : 5;

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
            {showAmounts ? (
              <>
                <TableHead className="text-right">PDF amount</TableHead>
                <TableHead className="text-right">Computed amount</TableHead>
                <TableHead className="text-right">Difference</TableHead>
              </>
            ) : (
              <>
                <TableHead className="text-right">{t("shipments.costs")}</TableHead>
                {showStems ? (
                  <>
                    <TableHead className="text-right">{t("shipments.stems")}</TableHead>
                    <TableHead className="text-right">Corrections</TableHead>
                    <TableHead className="text-right">{t("shipments.soldStems")}</TableHead>
                    <TableHead className="text-right">Gap</TableHead>
                  </>
                ) : (
                  <TableHead className="text-right">{t("shipments.stems")}</TableHead>
                )}
              </>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && !data ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
                {t("common.loading")}
              </TableCell>
            </TableRow>
          ) : items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
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
                {showAmounts ? (
                  <>
                    <TableCell className="text-right tabular-nums">
                      {row.pdfAmount !== null ? formatCurrencyDetailed(row.pdfAmount) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.computedAmount !== null ? formatCurrencyDetailed(row.computedAmount) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium text-amber-600 dark:text-amber-400">
                      {row.difference !== null ? formatCurrencyDetailed(row.difference) : "—"}
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className="text-right tabular-nums">
                      {row.costCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(row.deliveredStems)}
                    </TableCell>
                    {showStems && (
                      <>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(row.correctionStems)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(row.soldStems)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium text-amber-600 dark:text-amber-400">
                          {formatNumber(row.gapStems)}
                        </TableCell>
                      </>
                    )}
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
