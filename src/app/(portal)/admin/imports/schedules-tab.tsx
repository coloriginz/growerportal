"use client";

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  RiRefreshLine,
  RiAlertLine,
  RiErrorWarningLine,
  RiEditLine,
  RiPlayCircleLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { useFetch } from "@/hooks/use-fetch";
import { ErrorState } from "@/components/ui/error-state";
import { useLanguage } from "@/components/providers/language-provider";
import { SYNC_ENDPOINTS, inChainOrder } from "@/lib/sync/types";
import {
  windowAdvies,
  ketenAdvies,
  type AdviesVeld,
  type ScheduleAdvies,
  type KetenAdvies,
} from "@/lib/sync/schedule";
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
  /** Waarschuwingen over de samenhang tussen schema's, niet over één schema. */
  chainWarnings: KetenAdvies[];
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

function overridesOf(windowOverrides: unknown): Record<string, unknown> {
  return windowOverrides && typeof windowOverrides === "object" && !Array.isArray(windowOverrides)
    ? (windowOverrides as Record<string, unknown>)
    : {};
}

function formatWindow(schedule: Pick<ScheduleRow, "windowDays" | "windowOverrides">): string {
  const base = `${schedule.windowDays} day${schedule.windowDays === 1 ? "" : "s"}`;
  const overrides = Object.entries(overridesOf(schedule.windowOverrides));
  if (overrides.length === 0) return base;
  return `${base} (${overrides.map(([endpoint, days]) => `${endpoint}: ${days}`).join(", ")})`;
}

// ─── Edit form ────────────────────────────────────────

type ScheduleMode = "interval" | "atTime";

type EditForm = {
  enabled: boolean;
  mode: ScheduleMode;
  intervalMin: string;
  atTime: string;
  endpoints: string[];
  windowDays: string;
  overrides: Record<string, string>;
};

function formFrom(schedule: ScheduleRow): EditForm {
  const overrides = overridesOf(schedule.windowOverrides);
  return {
    enabled: schedule.enabled,
    mode: schedule.intervalMin != null ? "interval" : "atTime",
    intervalMin: schedule.intervalMin != null ? String(schedule.intervalMin) : "",
    atTime: schedule.atTime ?? "",
    endpoints: [...schedule.endpoints],
    windowDays: String(schedule.windowDays),
    overrides: Object.fromEntries(
      Object.entries(overrides).map(([endpoint, value]) => [endpoint, String(value)])
    ),
  };
}

/** Parses the form into the request body, or null when it isn't submittable yet. */
function payloadFrom(form: EditForm): {
  enabled: boolean;
  intervalMin: number | null;
  atTime: string | null;
  endpoints: string[];
  windowDays: number;
  windowOverrides: Record<string, number> | null;
} | null {
  const windowDays = Number(form.windowDays);
  if (!Number.isFinite(windowDays)) return null;

  const intervalMin = form.mode === "interval" && form.intervalMin !== "" ? Number(form.intervalMin) : null;
  if (form.mode === "interval" && form.intervalMin !== "" && !Number.isFinite(intervalMin)) return null;

  const overrideEntries = Object.entries(form.overrides)
    .filter(([endpoint]) => form.endpoints.includes(endpoint))
    .filter(([, value]) => value !== "")
    .map(([endpoint, value]) => [endpoint, Number(value)] as const);
  const windowOverrides = overrideEntries.length > 0 ? Object.fromEntries(overrideEntries) : null;

  return {
    enabled: form.enabled,
    intervalMin,
    atTime: form.mode === "atTime" && form.atTime !== "" ? form.atTime : null,
    endpoints: form.endpoints,
    windowDays,
    windowOverrides,
  };
}

function warningsFor(warnings: ScheduleAdvies[], veld: AdviesVeld): ScheduleAdvies[] {
  return warnings.filter((w) => w.veld === veld);
}

function WarningList({ warnings }: { warnings: ScheduleAdvies[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="space-y-1.5 pt-1">
      {warnings.map((warning, i) => (
        <div
          key={i}
          className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <RiAlertLine className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{warning.melding}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * De ketenwaarschuwingen. Zwaarder aangezet dan WarningList: dit is de fout die
 * je in één klik maakt en waar je maanden later achter komt, dus hij mag niet
 * dezelfde grootte hebben als "je venster is een dag te smal".
 */
function ChainWarnings({ warnings }: { warnings: KetenAdvies[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="space-y-2">
      {warnings.map((warning) => (
        <div
          key={warning.code}
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <RiAlertLine className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{warning.melding}</span>
        </div>
      ))}
    </div>
  );
}

function RunNowButton({ name, onRan }: { name: string; onRan: () => void }) {
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch(`/api/sync/schedules/${name}/run`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const message = typeof body?.error === "string" ? body.error : "Failed to enqueue a run";
        toast.error(message);
        return;
      }
      const enqueued = typeof body?.enqueued === "number" ? body.enqueued : 0;
      toast.success(
        enqueued > 0
          ? `Enqueued ${enqueued} job${enqueued === 1 ? "" : "s"} for "${name}"`
          : `"${name}" has no endpoints to enqueue`
      );
      onRan();
    } catch {
      toast.error("Failed to enqueue a run");
    } finally {
      setRunning(false);
    }
  }, [name, onRan]);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={run}
      disabled={running}
      title="Run now"
      aria-label="Run now"
    >
      <RiPlayCircleLine className={`h-4 w-4 ${running ? "animate-pulse" : ""}`} />
    </Button>
  );
}

function ScheduleEditor({
  schedule,
  schedules,
  onCancel,
  onSaved,
}: {
  schedule: ScheduleRow;
  /** Alle schema's: de keten loopt over de schema's heen, dus dit ene is niet genoeg. */
  schedules: ScheduleRow[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<EditForm>(() => formFrom(schedule));
  const [saving, setSaving] = useState(false);
  const [confirmWarnings, setConfirmWarnings] = useState<string[] | null>(null);

  const liveWarnings = useMemo(() => {
    const payload = payloadFrom(form);
    if (!payload) return [];
    return windowAdvies(payload);
  }, [form]);

  // De bewerkte waarden van dít schema naast de opgeslagen waarden van de rest.
  // Zonder die combinatie zie je pas na opslaan dat je het vangnet weghaalde.
  const liveChainWarnings = useMemo(
    () =>
      ketenAdvies([
        ...schedules
          .filter((s) => s.name !== schedule.name)
          .map((s) => ({ enabled: s.enabled, endpoints: s.endpoints })),
        { enabled: form.enabled, endpoints: form.endpoints },
      ]),
    [schedules, schedule.name, form.enabled, form.endpoints]
  );

  const toggleEndpoint = (endpoint: string, checked: boolean) => {
    setForm((f) => ({
      ...f,
      endpoints: checked ? [...f.endpoints, endpoint] : f.endpoints.filter((e) => e !== endpoint),
    }));
  };

  const setOverride = (endpoint: string, value: string) => {
    setForm((f) => ({ ...f, overrides: { ...f.overrides, [endpoint]: value } }));
  };

  const save = useCallback(
    async (skipWarningCheck = false) => {
      const payload = payloadFrom(form);
      if (!payload) {
        toast.error("Fix the invalid values before saving");
        return;
      }

      if (!skipWarningCheck) {
        // De ketenwaarschuwing gaat voorop in de bevestiging: hij weegt zwaarder
        // dan een venster dat een dag te smal is.
        const warnings = [
          ...liveChainWarnings.map((w) => w.melding),
          ...windowAdvies(payload).map((w) => w.melding),
        ];
        if (warnings.length > 0) {
          setConfirmWarnings(warnings);
          return;
        }
      }

      setSaving(true);
      try {
        const res = await fetch(`/api/sync/schedules/${schedule.name}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          const message =
            typeof body?.error === "string"
              ? body.error
              : "Invalid values — check the highlighted fields";
          toast.error(message);
          return;
        }
        toast.success(`Schedule "${schedule.name}" saved`);
        setConfirmWarnings(null);
        onSaved();
      } catch {
        toast.error("Failed to save schedule");
      } finally {
        setSaving(false);
      }
    },
    [form, schedule.name, onSaved, liveChainWarnings]
  );

  return (
    <>
      <CardContent className="space-y-4 text-sm">
        <ChainWarnings warnings={liveChainWarnings} />

        <div className="space-y-2">
          <Label>Status</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={form.enabled ? "default" : "outline"}
              size="sm"
              onClick={() => setForm((f) => ({ ...f, enabled: true }))}
            >
              Enabled
            </Button>
            <Button
              type="button"
              variant={!form.enabled ? "default" : "outline"}
              size="sm"
              onClick={() => setForm((f) => ({ ...f, enabled: false }))}
            >
              Disabled
            </Button>
          </div>
          <WarningList warnings={warningsFor(liveWarnings, "schema")} />
        </div>

        <div className="space-y-2">
          <Label>Rhythm</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={form.mode === "interval" ? "default" : "outline"}
              size="sm"
              onClick={() => setForm((f) => ({ ...f, mode: "interval" }))}
            >
              Interval
            </Button>
            <Button
              type="button"
              variant={form.mode === "atTime" ? "default" : "outline"}
              size="sm"
              onClick={() => setForm((f) => ({ ...f, mode: "atTime" }))}
            >
              Time of day
            </Button>
          </div>
          {form.mode === "interval" ? (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                value={form.intervalMin}
                onChange={(e) => setForm((f) => ({ ...f, intervalMin: e.target.value }))}
                className="w-28"
              />
              <span className="text-xs text-muted-foreground">minutes</span>
            </div>
          ) : (
            <Input
              type="time"
              value={form.atTime}
              onChange={(e) => setForm((f) => ({ ...f, atTime: e.target.value }))}
              className="w-32"
            />
          )}
          <WarningList warnings={warningsFor(liveWarnings, "intervalMin")} />
        </div>

        <div className="space-y-2">
          <Label>Endpoints</Label>
          <div className="grid grid-cols-2 gap-2">
            {SYNC_ENDPOINTS.map((endpoint) => (
              <label key={endpoint} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.endpoints.includes(endpoint)}
                  onCheckedChange={(checked) => toggleEndpoint(endpoint, checked === true)}
                />
                {endpoint}
              </label>
            ))}
          </div>
          <WarningList warnings={warningsFor(liveWarnings, "endpoints")} />
        </div>

        <div className="space-y-2">
          <Label>Window (days)</Label>
          <Input
            type="number"
            min={1}
            value={form.windowDays}
            onChange={(e) => setForm((f) => ({ ...f, windowDays: e.target.value }))}
            className="w-28"
          />
          <WarningList warnings={warningsFor(liveWarnings, "windowDays")} />
        </div>

        {inChainOrder(form.endpoints).length > 0 && (
          <div className="space-y-2">
            <Label>Exceptions per endpoint</Label>
            <div className="space-y-2">
              {inChainOrder(form.endpoints).map((endpoint) => (
                <div key={endpoint} className="flex items-center gap-2">
                  <span className="w-20 text-xs text-muted-foreground">{endpoint}</span>
                  <Input
                    type="number"
                    min={1}
                    placeholder={form.windowDays}
                    value={form.overrides[endpoint] ?? ""}
                    onChange={(e) => setOverride(endpoint, e.target.value)}
                    className="w-24"
                  />
                  <span className="text-xs text-muted-foreground">days</span>
                </div>
              ))}
            </div>
            <WarningList warnings={warningsFor(liveWarnings, "windowOverrides")} />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={() => save(false)} disabled={saving}>
            Save
          </Button>
        </div>
      </CardContent>

      <Dialog open={confirmWarnings !== null} onOpenChange={(open) => !open && setConfirmWarnings(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save with warnings?</DialogTitle>
            <DialogDescription>
              These settings can silently miss data. Saving anyway is allowed — confirm you mean it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            {confirmWarnings?.map((melding, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
              >
                <RiAlertLine className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{melding}</span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmWarnings(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => save(true)} disabled={saving}>
              Save anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SchedulesTab() {
  const { t } = useLanguage();
  const { data, loading, error, refetch } = useFetch<SchedulesResponse>("/api/sync/schedules");
  const [editingName, setEditingName] = useState<string | null>(null);

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleSaved = useCallback(() => {
    setEditingName(null);
    refetch();
  }, [refetch]);

  if (error) return <ErrorState onRetry={handleRetry} />;

  const schedules = data?.schedules ?? [];
  const chainWarnings = data?.chainWarnings ?? [];
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

      {/* Chain warnings: over de schema's heen, dus boven de kaarten */}
      <ChainWarnings warnings={chainWarnings} />

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
          {schedules.map((schedule) => {
            const editing = editingName === schedule.name;
            return (
              <Card key={schedule.name}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium capitalize">{schedule.name}</CardTitle>
                  <div className="flex items-center gap-2">
                    {schedule.enabled ? (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                        Enabled
                      </Badge>
                    ) : (
                      <Badge variant="outline">Disabled</Badge>
                    )}
                    {!editing && <RunNowButton name={schedule.name} onRan={refetch} />}
                    {!editing && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setEditingName(schedule.name)}
                      >
                        <RiEditLine className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardHeader>

                {editing ? (
                  <ScheduleEditor
                    schedule={schedule}
                    schedules={schedules}
                    onCancel={() => setEditingName(null)}
                    onSaved={handleSaved}
                  />
                ) : (
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
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
