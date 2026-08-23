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
import { Pagination } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  RiRefreshLine,
  RiSearchLine,
  RiMailLine,
} from "@remixicon/react";
import { useFetch } from "@/hooks/use-fetch";
import { ErrorState } from "@/components/ui/error-state";
import { useLanguage } from "@/components/providers/language-provider";
import { formatDate, formatTime, formatNumber } from "@/lib/format";
import {
  IngestionStatusBadge,
  type IngestionResponse,
} from "./shared";

// ─── Sales Sheet Imports Tab ─────────────

export function SalesSheetImportsTab() {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "25");
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (statusFilter !== "all") params.set("status", statusFilter);
    return `/api/shipments/ingestions?${params.toString()}`;
  }, [page, debouncedSearch, statusFilter]);

  const { data, loading, error, refetch } = useFetch<IngestionResponse>(url);

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  if (error) return <ErrorState onRetry={handleRetry} />;

  const ingestions = data?.items || [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const currentPage = data?.page ?? page;
  const pageStart = total === 0 ? 0 : (currentPage - 1) * 25 + 1;
  const pageEnd = Math.min(currentPage * 25, total);

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-[400px]">
          <RiSearchLine className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search subject, sender, supplier..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v ?? "all"); setPage(1); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("common.status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.all")}</SelectItem>
            <SelectItem value="PROCESSED">Processed</SelectItem>
            <SelectItem value="PARTIAL">Partial</SelectItem>
            <SelectItem value="ERROR">Error</SelectItem>
            <SelectItem value="PROCESSING">Processing</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RiRefreshLine className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      {/* Table */}
      <Table stickyHeader>
        <TableHeader>
          <TableRow>
            <TableHead>{t("common.date")}</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>{t("common.status")}</TableHead>
            <TableHead className="text-right">Attachments</TableHead>
            <TableHead className="text-right">Processed</TableHead>
            <TableHead className="text-right">Skipped</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && !data ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                {t("common.loading")}
              </TableCell>
            </TableRow>
          ) : ingestions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                {debouncedSearch || statusFilter !== "all" ? t("common.noResults") : "No sales sheet imports yet"}
              </TableCell>
            </TableRow>
          ) : (
            ingestions.map((ing) => (
              <TableRow key={ing.id}>
                <TableCell className="whitespace-nowrap">
                  {formatDate(ing.createdAt)}{" "}
                  <span className="text-muted-foreground">
                    {formatTime(ing.createdAt)}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <RiMailLine className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate max-w-[250px] text-sm">
                        {ing.subject || "No subject"}
                      </div>
                      {ing.fromAddress && (
                        <div className="text-xs text-muted-foreground truncate max-w-[250px]">
                          {ing.fromAddress}
                        </div>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <IngestionStatusBadge status={ing.status} />
                </TableCell>
                <TableCell className="text-right">
                  {ing.attachmentCount}
                </TableCell>
                <TableCell className="text-right">
                  {ing.processedCount}
                </TableCell>
                <TableCell className="text-right">
                  {ing.skippedCount}
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    {ing.processed.map((p) => (
                      <Link
                        key={p.salesSheetId}
                        href={`/shipments/${p.salesSheetId}`}
                        className="block text-xs text-primary hover:underline"
                      >
                        {p.supplierCode} &middot; {p.invoiceNumber}
                        {p.ourInvoiceNumber && ` (${p.ourInvoiceNumber})`}
                      </Link>
                    ))}
                    {ing.skipped.map((s, i) => (
                      <div key={i} className="text-xs text-muted-foreground">
                        {s.fileName}: {s.reason}
                      </div>
                    ))}
                    {ing.errors && (
                      <div className="text-xs text-red-600 dark:text-red-400">
                        {ing.errors.length > 80 ? `${ing.errors.slice(0, 80)}...` : ing.errors}
                      </div>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {pageStart}-{pageEnd} of {formatNumber(total)}
          </p>
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            onPageChange={setPage}
            disabled={loading}
          />
        </div>
      )}
    </div>
  );
}
