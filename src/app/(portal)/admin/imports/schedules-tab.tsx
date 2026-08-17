"use client";

import { useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RiRefreshLine, RiAlertLine, RiErrorWarningLine } from "@remixicon/react";
import { useFetch } from "@/hooks/use-fetch";
import { ErrorState } from "@/components/ui/error-state";
import { useLanguage } from "@/components/providers/language-provider";
import { inChainOrder } from "@/lib/sync/types";
import type { ScheduleAdvies } from "@/lib/sync/schedule";
import { timeAgo } from "./shared";

// ─── Schedules Tab ────────────────────────────────────────

export interface ScheduleRow {
  name: string;
  enabled: boolean;
  intervalMin: number | null;
  atTime: string | null;
  endpoints: string[];
  windowDays: number;
  windowOverrides: unknown;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  warnings: ScheduleAdvies[];
}

export interface SchedulesResponse {
  schedules: ScheduleRow[];
  stuckJobs: number;
}

function formatRhythm(schedule: Pick<ScheduleRow, "intervalMin" | "atTime">): string {
  if (schedule.intervalMin != null) {
    const hours = schedule.intervalMin / 60;
    if (Number.isInteger(hours)) {
      return `every ${hours} hour${hours === 1 ? "" : "s"}`;
    }
    return `every ${schedule.intervalMin} min`;
  }
  if (schedule.atTime != null) return schedule.atTime;
  return "not scheduled";
}

function formatWindow(schedule: Pick<ScheduleRow, "windowDays" | "windowOverrides">): string {
  const base = `${schedule.windowDays} day${schedule.windowDays === 1 ? "" : "s"}`;
  const overrides =
    schedule.windowOverrides &&
    typeof schedule.windowOverrides === "object" &&
    !Array.isArray(schedule.windowOverrides)
      ? Object.entries(schedule.windowOverrides as Record<string, unknown>)
      : [];
  if (overrides.length === 0) return base;
  return `${base} (${overrides.map(([endpoint, days]) => `${endpoint}: ${days}`).join(", ")})`;
}

export function SchedulesTab() {
  const { t } = useLanguage();
  const { data, loading, error, refetch } = useFetch<SchedulesResponse>("/api/sync/schedules");

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  if (error) return <ErrorState onRetry={handleRetry} />;

  const schedules = data?.schedules ?? [];
  const stuckJobs = data?.stuckJobs ?? 0;

  return (
    <div className="space-y-6">
      {/* Refresh */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
          <RiRefreshLine className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("common.refresh")}
        </Button>
      </div>

      {/* Stuck jobs banner */}
      {stuckJobs > 0 && (
        <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">
          <RiErrorWarningLine className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {stuckJobs} job{stuckJobs === 1 ? "" : "s"} stuck in &quot;dispatched&quot;
          </span>
        </div>
      )}

      {loading && !data ? (
        <p className="py-16 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {schedules.map((schedule) => (
            <Card key={schedule.name}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium capitalize">{schedule.name}</CardTitle>
                {schedule.enabled ? (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                    Enabled
                  </Badge>
                ) : (
                  <Badge variant="outline">Disabled</Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Last successful run</span>
                  <span>{schedule.lastSuccessAt ? timeAgo(schedule.lastSuccessAt) : "never"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Rhythm</span>
                  <span>{formatRhythm(schedule)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Endpoints</span>
                  <span className="text-right">{inChainOrder(schedule.endpoints).join(", ")}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Window</span>
                  <span className="text-right">{formatWindow(schedule)}</span>
                </div>

                {schedule.warnings.length > 0 && (
                  <div className="space-y-2 pt-2">
                    {schedule.warnings.map((warning, i) => (
                      <div
                        key={`${warning.veld}-${i}`}
                        className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
                      >
                        <RiAlertLine className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{warning.melding}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
