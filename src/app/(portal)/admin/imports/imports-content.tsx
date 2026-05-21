"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Input } from "@/components/ui/input";
import {
  RiRefreshLine,
  RiSearchLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiTimeLine,
  RiAlertLine,
  RiMailLine,
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
  page: number;
  totalPages: number;
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

  return (
    <div className="page-content">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {t("imports.title")}
        </h1>
      </div>
      <Tabs defaultValue="data-sync">
        <TabsList>
          <TabsTrigger value="data-sync">Data Sync</TabsTrigger>
          <TabsTrigger value="sales-sheets">Sales Sheets</TabsTrigger>
        </TabsList>
        <TabsContent value="data-sync" className="mt-6">
          <DataSyncTab />
        </TabsContent>
        <TabsContent value="sales-sheets" className="mt-6">
          <SalesSheetImportsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Data Sync Tab (existing Fabric imports) ─────────────

function DataSyncTab() {
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

// ─── Sales Sheet Imports Tab ─────────────

interface SalesSheetIngestion {
  id: string;
  subject: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  processedAt: string;
  status: string;
  attachmentCount: number;
  processedCount: number;
  skippedCount: number;
  errors: string | null;
  createdAt: string;
  processed: { fileName: string; salesSheetId: string; invoiceNumber: string; ourInvoiceNumber: string; supplierCode: string }[];
  skipped: { fileName: string; reason: string }[];
}

function IngestionStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "PROCESSED":
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          <RiCheckLine className="mr-1 h-3 w-3" />
          Processed
        </Badge>
      );
    case "PARTIAL":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
          <RiAlertLine className="mr-1 h-3 w-3" />
          Partial
        </Badge>
      );
    case "ERROR":
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
          <RiErrorWarningLine className="mr-1 h-3 w-3" />
          Error
        </Badge>
      );
    case "PROCESSING":
      return (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
          <RiLoader4Line className="mr-1 h-3 w-3 animate-spin" />
          Processing
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

interface IngestionResponse {
  items: SalesSheetIngestion[];
  page: number;
  totalPages: number;
  total: number;
}

function SalesSheetImportsTab() {
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
    </div>
  );
}
