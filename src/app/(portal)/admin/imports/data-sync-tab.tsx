"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  RiRefreshLine,
  RiErrorWarningLine,
  RiTimeLine,
  RiAlertLine,
} from "@remixicon/react";
import { useFetch } from "@/hooks/use-fetch";
import { ErrorState } from "@/components/ui/error-state";
import { useLanguage } from "@/components/providers/language-provider";
import { formatDate, formatTime, formatNumber } from "@/lib/format";
import {
  ENDPOINTS,
  timeAgo,
  formatDuration,
  StatusBadge,
  type ImportBatch,
  type ImportBatchResponse,
} from "./shared";

// ─── Data Sync Tab (existing Fabric imports) ─────────────

export function DataSyncTab() {
  const { t } = useLanguage();
  const [endpointFilter, setEndpointFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [errorDialogBatch, setErrorDialogBatch] = useState<ImportBatch | null>(null);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (endpointFilter !== "all") params.set("endpoint", endpointFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    params.set("limit", "50");
    params.set("page", String(page));
    return `/api/admin/import-batches?${params.toString()}`;
  }, [endpointFilter, statusFilter, page]);

  const { data, loading, error, refetch } = useFetch<ImportBatchResponse>(url);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
    }, 30000);
    return () => clearInterval(interval);
  }, [refetch]);

  // Stable callback for ErrorState
  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  if (error) return <ErrorState onRetry={handleRetry} />;

  const summary = data?.summary;
  const batches = data?.batches || [];
  const totalBatches = summary?.totalBatches ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const currentPage = data?.page ?? page;
  const pageStart = totalBatches === 0 ? 0 : (currentPage - 1) * 50 + 1;
  const pageEnd = Math.min(currentPage * 50, totalBatches);

  return (
    <div className="space-y-8">
      {/* Refresh */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
          <RiRefreshLine className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("common.refresh")}
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {ENDPOINTS.map((ep) => {
          const lastSync = summary?.lastSuccessful[ep];
          return (
            <Card key={ep}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium capitalize">
                  {ep}
                </CardTitle>
                <RiTimeLine className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {loading && !data ? (
                    <span className="text-muted-foreground">-</span>
                  ) : lastSync ? (
                    timeAgo(lastSync)
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("imports.lastSync")}
                  {lastSync && (
                    <>
                      {" "}
                      &middot; {formatDate(lastSync)} {formatTime(lastSync)}
                    </>
                  )}
                </p>
              </CardContent>
            </Card>
          );
        })}

        {/* Errors 24h card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("imports.errors24h")}
            </CardTitle>
            <RiAlertLine className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${(summary?.errors24h ?? 0) > 0 ? "text-red-600 dark:text-red-400" : ""}`}>
              {loading && !data ? (
                <span className="text-muted-foreground">-</span>
              ) : (
                formatNumber(summary?.errors24h ?? 0)
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("imports.errors24h")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3">
        <Select value={endpointFilter} onValueChange={(v) => { setEndpointFilter(v ?? "all"); setPage(1); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("imports.endpoint")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.all")}</SelectItem>
            {ENDPOINTS.map((ep) => (
              <SelectItem key={ep} value={ep} className="capitalize">
                {ep}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v ?? "all"); setPage(1); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("common.status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.all")}</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
            <Table stickyHeader>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.date")}</TableHead>
                  <TableHead>{t("imports.endpoint")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead className="text-right">{t("imports.received")}</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                  <TableHead className="text-right">Skipped</TableHead>
                  <TableHead className="text-right">{t("imports.duration")}</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && !data ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                      {t("common.loading")}
                    </TableCell>
                  </TableRow>
                ) : batches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                      {t("imports.noData")}
                    </TableCell>
                  </TableRow>
                ) : (
                  batches.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(batch.startedAt)}{" "}
                        <span className="text-muted-foreground">
                          {formatTime(batch.startedAt)}
                        </span>
                      </TableCell>
                      <TableCell className="capitalize">{batch.endpoint}</TableCell>
                      <TableCell>
                        <StatusBadge status={batch.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {formatNumber(batch.recordsReceived)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatNumber(batch.recordsCreated)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatNumber(batch.recordsUpdated)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatNumber(batch.recordsSkipped)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatDuration(batch.durationMs)}
                      </TableCell>
                      <TableCell>
                        {batch.errorMessage ? (
                          <button
                            onClick={() => setErrorDialogBatch(batch)}
                            className="text-left text-xs text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                          >
                            {batch.errorMessage.length > 50
                              ? `${batch.errorMessage.slice(0, 50)}...`
                              : batch.errorMessage}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
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
            Showing {pageStart}-{pageEnd} of {formatNumber(totalBatches)}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1 || loading}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages || loading}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Error detail dialog */}
      <Dialog
        open={!!errorDialogBatch}
        onOpenChange={(open) => { if (!open) setErrorDialogBatch(null); }}
      >
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-red-600 dark:text-red-400 flex items-center gap-2">
              <RiErrorWarningLine className="h-5 w-5" />
              Import Error — {errorDialogBatch?.endpoint}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="text-muted-foreground">
              {errorDialogBatch && (
                <>
                  {formatDate(errorDialogBatch.startedAt)}{" "}
                  {formatTime(errorDialogBatch.startedAt)}
                  {errorDialogBatch.durationMs !== null && (
                    <> &middot; {formatDuration(errorDialogBatch.durationMs)}</>
                  )}
                </>
              )}
            </div>
            <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs font-mono">
              {errorDialogBatch?.errorMessage &&
                (() => {
                  try {
                    return JSON.stringify(JSON.parse(errorDialogBatch.errorMessage), null, 2);
                  } catch {
                    return errorDialogBatch.errorMessage;
                  }
                })()}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
