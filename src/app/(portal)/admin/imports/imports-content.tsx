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
import { Badge } from "@/components/ui/badge";
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
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiTimeLine,
  RiAlertLine,
} from "@remixicon/react";
import { useFetch } from "@/hooks/use-fetch";
import { ErrorState } from "@/components/ui/error-state";
import { useLanguage } from "@/components/providers/language-provider";
import { formatDate, formatTime, formatNumber } from "@/lib/format";

interface ImportBatch {
  id: string;
  endpoint: string;
  status: "running" | "success" | "error";
  recordsReceived: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  durationMs: number | null;
  errorMessage: string | null;
  details: Record<string, unknown> | null;
  startedAt: string;
  completedAt: string | null;
}

interface ImportBatchResponse {
  batches: ImportBatch[];
  summary: {
    totalBatches: number;
    errors24h: number;
    lastSuccessful: Record<string, string>;
  };
}

const ENDPOINTS = ["suppliers", "lots", "orders", "costs"] as const;

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "< 1 min";
  if (diffMin < 60) return `${diffMin} min`;
  if (diffHour < 24) return `${diffHour}h`;
  return `${diffDay}d`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

function StatusBadge({ status }: { status: ImportBatch["status"] }) {
  switch (status) {
    case "success":
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          <RiCheckLine className="mr-1 h-3 w-3" />
          Success
        </Badge>
      );
    case "error":
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
          <RiErrorWarningLine className="mr-1 h-3 w-3" />
          Error
        </Badge>
      );
    case "running":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
          <RiLoader4Line className="mr-1 h-3 w-3 animate-spin" />
          Running
        </Badge>
      );
  }
}

export function ImportsContent() {
  const { t } = useLanguage();
  const [endpointFilter, setEndpointFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [errorDialogBatch, setErrorDialogBatch] = useState<ImportBatch | null>(null);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (endpointFilter !== "all") params.set("endpoint", endpointFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    params.set("limit", "50");
    return `/api/admin/import-batches?${params.toString()}`;
  }, [endpointFilter, statusFilter]);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("imports.title")}
          </h1>
        </div>
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
        <Select value={endpointFilter} onValueChange={(v) => setEndpointFilter(v ?? "all")}>
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

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
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
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
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
          </div>
        </CardContent>
      </Card>

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
