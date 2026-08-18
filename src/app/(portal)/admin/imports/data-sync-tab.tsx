"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  RiCheckLine,
  RiLoader4Line,
  RiSkipForwardLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { useFetch } from "@/hooks/use-fetch";
import { ErrorState } from "@/components/ui/error-state";
import { useLanguage } from "@/components/providers/language-provider";
import { formatDate, formatTime, formatNumber } from "@/lib/format";
import {
  ENDPOINTS,
  timeAgo,
  formatDuration,
  formatWindowRange,
  skippedSuppliersOf,
  StatusBadge,
  type ImportBatch,
  type ImportBatchResponse,
} from "./shared";
import type { SchedulesResponse } from "./schedules-tab";

// ─── Running round types (GET /api/sync/jobs) ─────────────

interface SyncJobRow {
  id: string;
  runId: string;
  sequence: number;
  endpoint: string;
  status: "pending" | "dispatched" | "done" | "failed" | "cancelled";
  attempts: number;
  lastError: string | null;
}

interface SyncRun {
  runId: string;
  source: string;
  /** "failed" = een job knapte en de runner annuleerde de rest van de ronde. */
  state: "running" | "failed";
  startedAt: string;
  failedAt: string | null;
  jobs: SyncJobRow[];
}

interface JobsResponse {
  runs: SyncRun[];
}

function JobStatusBadge({ status }: { status: SyncJobRow["status"] }) {
  switch (status) {
    case "pending":
      return <Badge variant="outline">Pending</Badge>;
    case "dispatched":
      return (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
          <RiLoader4Line className="mr-1 h-3 w-3 animate-spin" />
          Dispatched
        </Badge>
      );
    case "done":
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          <RiCheckLine className="mr-1 h-3 w-3" />
          Done
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
          <RiErrorWarningLine className="mr-1 h-3 w-3" />
          Failed
        </Badge>
      );
    case "cancelled":
      return <Badge variant="outline">Cancelled</Badge>;
  }
}

function AdvanceQueueButton({ onAdvanced }: { onAdvanced: () => void }) {
  const [advancing, setAdvancing] = useState(false);

  const advance = useCallback(async () => {
    setAdvancing(true);
    try {
      const res = await fetch("/api/sync/advance", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error("Failed to advance the queue");
        return;
      }
      if (body?.dryRun) {
        toast.info(body.reason ?? "Not dispatching in this environment");
      } else if (body?.dispatched) {
        toast.success("Dispatched the next job");
      } else if (body?.failed) {
        toast.error("The dispatched job failed");
      } else {
        toast.info("Nothing to dispatch");
      }
      onAdvanced();
    } catch {
      toast.error("Failed to advance the queue");
    } finally {
      setAdvancing(false);
    }
  }, [onAdvanced]);

  return (
    <Button variant="outline" size="sm" onClick={advance} disabled={advancing}>
      <RiSkipForwardLine className={`mr-2 h-4 w-4 ${advancing ? "animate-pulse" : ""}`} />
      Advance queue
    </Button>
  );
}

// ─── Data Sync Tab (existing Fabric imports) ─────────────

export function DataSyncTab() {
  const { t } = useLanguage();
  const [endpointFilter, setEndpointFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  // Doubles as the "why is data missing" dialog: a batch with an error opens it
  // in red, a successful batch with skipped suppliers opens it in neutral tone.
  const [detailBatch, setDetailBatch] = useState<ImportBatch | null>(null);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (endpointFilter !== "all") params.set("endpoint", endpointFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    params.set("limit", "50");
    params.set("page", String(page));
    return `/api/admin/import-batches?${params.toString()}`;
  }, [endpointFilter, statusFilter, page]);

  const { data, loading, error, refetch } = useFetch<ImportBatchResponse>(url);
  const { data: schedulesData, refetch: refetchSchedules } = useFetch<SchedulesResponse>("/api/sync/schedules");
  const { data: jobsData, refetch: refetchJobs } = useFetch<JobsResponse>("/api/sync/jobs");

  const runs = jobsData?.runs ?? [];
  const hasDispatched = useMemo(
    () => (jobsData?.runs ?? []).some((run) => run.jobs.some((job) => job.status === "dispatched")),
    [jobsData]
  );

  const refetchAll = useCallback(() => {
    refetch();
    refetchSchedules();
    refetchJobs();
  }, [refetch, refetchSchedules, refetchJobs]);

  // Auto-refresh: every 5 seconds while a job is dispatched, otherwise every 30
  useEffect(() => {
    const interval = setInterval(refetchAll, hasDispatched ? 5000 : 30000);
    return () => clearInterval(interval);
  }, [refetchAll, hasDispatched]);

  if (error) return <ErrorState onRetry={refetchAll} />;

  const summary = data?.summary;
  const batches = data?.batches || [];
  const totalBatches = summary?.totalBatches ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const currentPage = data?.page ?? page;
  const pageStart = totalBatches === 0 ? 0 : (currentPage - 1) * 50 + 1;
  const pageEnd = Math.min(currentPage * 50, totalBatches);
  const schedules = schedulesData?.schedules ?? [];
  const stuckJobs = schedulesData?.stuckJobs ?? 0;

  return (
    <div className="space-y-8">
      {/* Refresh */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={refetchAll} disabled={loading}>
          <RiRefreshLine className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("common.refresh")}
        </Button>
      </div>

      {/* Health line: one row per schedule, the three-second glance */}
      {schedules.length > 0 && (
        <div className="space-y-1.5 rounded-md border p-3 text-sm">
          {schedules.map((s) => (
            <div key={s.name} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-medium capitalize">{s.name}</span>
                {s.enabled ? (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                    Enabled
                  </Badge>
                ) : (
                  <Badge variant="outline">Disabled</Badge>
                )}
              </div>
              <span className="text-muted-foreground">
                last success {s.lastSuccessAt ? timeAgo(s.lastSuccessAt) : "never"}
              </span>
            </div>
          ))}
          {stuckJobs > 0 && (
            <div className="flex items-center gap-1.5 pt-1 text-red-600 dark:text-red-400">
              <RiErrorWarningLine className="h-4 w-4 shrink-0" />
              <span>
                {stuckJobs} job{stuckJobs === 1 ? "" : "s"} stuck in &quot;dispatched&quot;
              </span>
            </div>
          )}
        </div>
      )}

      {/* Rounds: open work in the queue, plus rounds that were aborted by a
          failure in the last two hours. A round that simply succeeded is gone —
          it is complete in the history table below. */}
      {runs.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sync rounds</CardTitle>
            <AdvanceQueueButton onAdvanced={refetchAll} />
          </CardHeader>
          <CardContent className="space-y-4">
            {runs.map((run) => (
              <div
                key={run.runId}
                className={
                  run.state === "failed"
                    ? "space-y-1.5 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30"
                    : "space-y-1.5"
                }
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground capitalize">
                    {run.source}
                  </span>
                  {run.state === "failed" && (
                    <>
                      <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                        <RiErrorWarningLine className="mr-1 h-3 w-3" />
                        Round aborted
                      </Badge>
                      {run.failedAt && (
                        <span className="text-xs text-red-700 dark:text-red-400">
                          {timeAgo(run.failedAt)}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div className="space-y-1">
                  {run.jobs.map((job) => (
                    <div key={job.id} className="flex items-start justify-between gap-3 text-sm">
                      <span className="capitalize">{job.endpoint}</span>
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-2">
                          <JobStatusBadge status={job.status} />
                          {job.attempts > 1 && (
                            <span className="text-xs text-muted-foreground">
                              attempt {job.attempts}
                            </span>
                          )}
                        </div>
                        {job.status === "failed" && job.lastError && (
                          <span className="max-w-xs text-right text-xs text-red-600 dark:text-red-400">
                            {job.lastError}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

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
                  <TableHead>Run</TableHead>
                  <TableHead>Window</TableHead>
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
                    <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                      {t("common.loading")}
                    </TableCell>
                  </TableRow>
                ) : batches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                      {t("imports.noData")}
                    </TableCell>
                  </TableRow>
                ) : (
                  batches.map((batch) => {
                    const skipped = skippedSuppliersOf(batch);
                    return (
                    <TableRow key={batch.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(batch.startedAt)}{" "}
                        <span className="text-muted-foreground">
                          {formatTime(batch.startedAt)}
                        </span>
                      </TableCell>
                      <TableCell className="capitalize">{batch.endpoint}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {batch.job && (
                          <>
                            <span className="capitalize">{batch.job.source}</span>
                            {batch.job.attempts > 1 && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                (attempt {batch.job.attempts})
                              </span>
                            )}
                          </>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {batch.job && formatWindowRange(batch.job.windowFrom, batch.job.windowTo)}
                      </TableCell>
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
                        {skipped.length > 0 ? (
                          <button
                            onClick={() => setDetailBatch(batch)}
                            className="text-amber-700 hover:underline cursor-pointer dark:text-amber-400"
                            title="Show skipped suppliers"
                          >
                            {formatNumber(batch.recordsSkipped)}
                          </button>
                        ) : (
                          formatNumber(batch.recordsSkipped)
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatDuration(batch.durationMs)}
                      </TableCell>
                      <TableCell>
                        {batch.errorMessage ? (
                          <button
                            onClick={() => setDetailBatch(batch)}
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
                    );
                  })
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

      {/* Detail dialog: an error batch opens in red, a successful batch with
          skipped suppliers opens in neutral amber — same dialog, different tone,
          so a clean import never reads as a failure. */}
      <Dialog
        open={!!detailBatch}
        onOpenChange={(open) => { if (!open) setDetailBatch(null); }}
      >
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            {detailBatch?.errorMessage ? (
              <DialogTitle className="text-red-600 dark:text-red-400 flex items-center gap-2">
                <RiErrorWarningLine className="h-5 w-5" />
                Import Error — {detailBatch?.endpoint}
              </DialogTitle>
            ) : (
              <DialogTitle className="flex items-center gap-2">
                <RiAlertLine className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                Skipped suppliers — {detailBatch?.endpoint}
              </DialogTitle>
            )}
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="text-muted-foreground">
              {detailBatch && (
                <>
                  {formatDate(detailBatch.startedAt)}{" "}
                  {formatTime(detailBatch.startedAt)}
                  {detailBatch.durationMs !== null && (
                    <> &middot; {formatDuration(detailBatch.durationMs)}</>
                  )}
                </>
              )}
            </div>

            {detailBatch?.errorMessage && (
              <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs font-mono">
                {(() => {
                  try {
                    return JSON.stringify(JSON.parse(detailBatch.errorMessage), null, 2);
                  } catch {
                    return detailBatch.errorMessage;
                  }
                })()}
              </pre>
            )}

            {detailBatch && skippedSuppliersOf(detailBatch).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  These suppliers don&apos;t exist in the portal yet, so their lots were
                  skipped (rel_id, busiest first, top 50):
                </p>
                <div className="max-h-72 overflow-y-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted text-muted-foreground">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-medium">rel_id</th>
                        <th className="px-3 py-1.5 text-right font-medium">Lots skipped</th>
                      </tr>
                    </thead>
                    <tbody>
                      {skippedSuppliersOf(detailBatch).map(([relId, count]) => (
                        <tr key={relId} className="border-t">
                          <td className="px-3 py-1 font-mono">{relId}</td>
                          <td className="px-3 py-1 text-right">{formatNumber(count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
