"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
import { BackfillCard } from "./backfill-card";

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

type SchedulePayload = {
  enabled: boolean;
  intervalMin: number | null;
  atTime: string | null;
  endpoints: string[];
  windowDays: number;
  windowOverrides: Record<string, number> | null;
};

/**
 * Per invoerveld hoogstens één melding. De sleutels lopen gelijk aan de sleutels
 * die zod teruggeeft, zodat een serverweigering bij hetzelfde veld landt als een
 * afkeuring hier; een uitzondering per endpoint krijgt `override:<endpoint>`.
 */
type FieldErrors = Record<string, string>;

/**
 * Leest een getalveld. Leeg is geen nul maar ontbrekende invoer: `Number("")`
 * is 0, dus zonder deze scheiding glipt een leeg veld door de eindigheidstest,
 * door de bevestigingsdialoog heen, en wordt het pas serverkant geweigerd — met
 * een foutobject dat het scherm niet kan tonen.
 *
 * Nul en negatief passeren hier bewust wél: die zijn ingevuld, en de
 * bereikcontrole hoort bij de opslagroute die de waarheid over het bereik kent.
 */
function readNumber(raw: string): { ok: true; value: number } | { ok: false; melding: string } {
  if (raw.trim() === "") return { ok: false, melding: "Fill in a number — an empty field is not zero." };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { ok: false, melding: "This is not a number." };
  return { ok: true, value };
}

/**
 * Parseert het formulier naar de request body. `payload` is null zodra er een
 * veld ongeldig is; `errors` wijst dan aan welke.
 *
 * Let op het verschil dat het hele ontwerp draagt: ongeldig komt hier niet
 * doorheen, riskant-maar-geldig wel — dat gaat verder naar de bevestiging.
 */
function validateForm(form: EditForm): { payload: SchedulePayload | null; errors: FieldErrors } {
  const errors: FieldErrors = {};

  const windowDays = readNumber(form.windowDays);
  if (!windowDays.ok) errors.windowDays = windowDays.melding;

  let intervalMin: number | null = null;
  if (form.mode === "interval") {
    const parsed = readNumber(form.intervalMin);
    if (!parsed.ok) errors.intervalMin = parsed.melding;
    else intervalMin = parsed.value;
  }

  // Een leeg uitzonderingsveld betekent "geen uitzondering", niet nul: het veld
  // toont het rondevenster als placeholder en leeglaten is de manier om terug te
  // vallen. Ingevuld-maar-onleesbaar is wél een fout.
  const overrideEntries: [string, number][] = [];
  for (const [endpoint, raw] of Object.entries(form.overrides)) {
    if (!form.endpoints.includes(endpoint) || raw.trim() === "") continue;
    const parsed = readNumber(raw);
    if (!parsed.ok) errors[`override:${endpoint}`] = parsed.melding;
    else overrideEntries.push([endpoint, parsed.value]);
  }

  if (Object.keys(errors).length > 0 || !windowDays.ok) return { payload: null, errors };

  return {
    payload: {
      enabled: form.enabled,
      intervalMin,
      atTime: form.mode === "atTime" && form.atTime !== "" ? form.atTime : null,
      endpoints: form.endpoints,
      windowDays: windowDays.value,
      windowOverrides: overrideEntries.length > 0 ? Object.fromEntries(overrideEntries) : null,
    },
    errors,
  };
}

/**
 * De `fieldErrors` uit `parsed.error.flatten()` omzetten naar dezelfde vorm als
 * hierboven. Zonder dit belandt een serverweigering in een generieke toast en
 * wijst niets aan wélk veld werd afgekeurd.
 */
function serverFieldErrors(flattened: unknown): { fields: FieldErrors; form: string | null } {
  const fields: FieldErrors = {};
  if (!flattened || typeof flattened !== "object") return { fields, form: null };

  const raw = (flattened as { fieldErrors?: unknown }).fieldErrors;
  if (raw && typeof raw === "object") {
    for (const [veld, meldingen] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(meldingen) && typeof meldingen[0] === "string") fields[veld] = meldingen[0];
    }
  }

  const formErrors = (flattened as { formErrors?: unknown }).formErrors;
  const form =
    Array.isArray(formErrors) && typeof formErrors[0] === "string" ? formErrors[0] : null;
  return { fields, form };
}

function warningsFor(warnings: ScheduleAdvies[], veld: AdviesVeld): ScheduleAdvies[] {
  return warnings.filter((w) => w.veld === veld);
}

/**
 * Rood, niet amber: een waarschuwing kun je wegklikken en toch opslaan, dit
 * niet. Die kleurscheiding is het enige waaraan je ziet welke van de twee je
 * voor je hebt.
 */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="flex items-start gap-1.5 pt-1 text-xs text-red-600 dark:text-red-400">
      <RiErrorWarningLine className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  /**
   * Elke wijziging wist de veldfouten. Een melding die blijft staan terwijl je
   * het veld al hebt gecorrigeerd leert je hem te negeren.
   */
  const patchForm = useCallback((fn: (f: EditForm) => EditForm) => {
    setFieldErrors({});
    setForm(fn);
  }, []);

  const liveWarnings = useMemo(() => {
    const { payload } = validateForm(form);
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
    patchForm((f) => ({
      ...f,
      endpoints: checked ? [...f.endpoints, endpoint] : f.endpoints.filter((e) => e !== endpoint),
    }));
  };

  const setOverride = (endpoint: string, value: string) => {
    patchForm((f) => ({ ...f, overrides: { ...f.overrides, [endpoint]: value } }));
  };

  const save = useCallback(
    async (skipWarningCheck = false) => {
      const { payload, errors } = validateForm(form);
      setFieldErrors(errors);
      if (!payload) {
        toast.error("Fix the highlighted fields before saving");
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
          if (typeof body?.error === "string") {
            toast.error(body.error);
            return;
          }
          // De opslagroute weigert met `parsed.error.flatten()`. Die uitpakken
          // en bij de velden zetten, zodat "check the highlighted fields" ook
          // echt iets gemarkeerds oplevert.
          const { fields, form: formError } = serverFieldErrors(body?.error);
          setFieldErrors(fields);
          setConfirmWarnings(null);
          toast.error(
            formError ??
              (Object.keys(fields).length > 0
                ? "Invalid values — check the highlighted fields"
                : "Invalid values")
          );
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
              onClick={() => patchForm((f) => ({ ...f, enabled: true }))}
            >
              Enabled
            </Button>
            <Button
              type="button"
              variant={!form.enabled ? "default" : "outline"}
              size="sm"
              onClick={() => patchForm((f) => ({ ...f, enabled: false }))}
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
              onClick={() => patchForm((f) => ({ ...f, mode: "interval" }))}
            >
              Interval
            </Button>
            <Button
              type="button"
              variant={form.mode === "atTime" ? "default" : "outline"}
              size="sm"
              onClick={() => patchForm((f) => ({ ...f, mode: "atTime" }))}
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
                onChange={(e) => patchForm((f) => ({ ...f, intervalMin: e.target.value }))}
                aria-invalid={!!fieldErrors.intervalMin}
                className="w-28"
              />
              <span className="text-xs text-muted-foreground">minutes</span>
            </div>
          ) : (
            <Input
              type="time"
              value={form.atTime}
              onChange={(e) => patchForm((f) => ({ ...f, atTime: e.target.value }))}
              className="w-32"
            />
          )}
          <FieldError message={fieldErrors.intervalMin ?? fieldErrors.atTime} />
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
          <FieldError message={fieldErrors.endpoints} />
          <WarningList warnings={warningsFor(liveWarnings, "endpoints")} />
        </div>

        <div className="space-y-2">
          <Label>Window (days)</Label>
          <Input
            type="number"
            min={1}
            value={form.windowDays}
            onChange={(e) => patchForm((f) => ({ ...f, windowDays: e.target.value }))}
            aria-invalid={!!fieldErrors.windowDays}
            className="w-28"
          />
          <FieldError message={fieldErrors.windowDays} />
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
                    aria-invalid={!!fieldErrors[`override:${endpoint}`]}
                    className="w-24"
                  />
                  <span className="text-xs text-muted-foreground">days</span>
                  <FieldError message={fieldErrors[`override:${endpoint}`]} />
                </div>
              ))}
            </div>
            <FieldError message={fieldErrors.windowOverrides} />
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

// ─── Backfill start date ────────────────────────────────────────

export interface SyncSettingsResponse {
  backfillStartDate: string | null;
  /** Wat die datum per leverancier oplevert, uitgerekend door de server. */
  quarters: number;
  jobs: number;
}

/**
 * De basisdatum voor backfills: één datum voor alle leveranciers, dus hij hoort
 * bij de schema's en niet bij een leverancier.
 *
 * Het aantal kwartalen komt van de server mee en wordt hier niet nagerekend —
 * de definitie van "een kwartaal" staat op één plek. De prijs is dat het getal
 * bij de opgeslagen datum hoort en niet bij wat er in het veld staat; zolang die
 * twee verschillen zegt de regel eronder dat, in plaats van een getal te tonen
 * dat bij de vorige datum hoort.
 */
function BackfillStartField({
  settings,
  onSaved,
}: {
  settings: SyncSettingsResponse | null;
  onSaved: () => void;
}) {
  // null is "niet aangeraakt", niet "leeg": zo wint een verversing van de server
  // zolang de gebruiker niets heeft ingetypt, en zijn invoer daarna.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const saved = settings?.backfillStartDate ?? "";
  const value = draft ?? saved;
  const dirty = value !== saved;

  const save = useCallback(async () => {
    if (value === "") {
      toast.error("Pick a date first");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/sync/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backfillStartDate: value }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(typeof body?.error === "string" ? body.error : "Invalid date");
        return;
      }
      toast.success(`Backfills now start at ${value}`);
      // Terug naar de servertoestand: het antwoord van de PUT is wat een
      // volgende GET ook geeft, inclusief het bijgewerkte aantal kwartalen.
      setDraft(null);
      onSaved();
    } catch {
      toast.error("Failed to save the backfill start date");
    } finally {
      setSaving(false);
    }
  }, [value, onSaved]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Backfill</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Label htmlFor="backfill-start">Start date</Label>
        <div className="flex items-center gap-2">
          <Input
            id="backfill-start"
            type="date"
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            className="w-44"
          />
          <Button type="button" size="sm" onClick={save} disabled={saving || !dirty}>
            Save
          </Button>
        </div>
        {settings && (
          <p className="text-xs text-muted-foreground">
            {dirty
              ? "Not saved yet — the quarter count below follows the saved date."
              : saved === ""
                ? "No start date set. A backfill needs one before it can start."
                : `${settings.quarters} quarter${settings.quarters === 1 ? "" : "s"} per supplier, ${settings.jobs} job${settings.jobs === 1 ? "" : "s"}.`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function SchedulesTab() {
  const { t } = useLanguage();
  const { data, loading, error, refetch } = useFetch<SchedulesResponse>("/api/sync/schedules");
  const { data: settings, refetch: refetchSettings } =
    useFetch<SyncSettingsResponse>("/api/sync/settings");
  const [editingName, setEditingName] = useState<string | null>(null);

  // De voortgangskaart houdt zijn eigen fetch, maar het tabblad heeft één
  // Refresh-knop en geen drie. De kaart geeft zijn refetch hier af zodat die knop
  // hem meeneemt; pollen doet dit scherm nergens en dat blijft zo.
  const refreshBackfills = useRef<() => void>(() => {});
  const registerBackfillRefresh = useCallback((refresh: () => void) => {
    refreshBackfills.current = refresh;
  }, []);

  const refreshAll = useCallback(() => {
    refetch();
    refetchSettings();
    refreshBackfills.current();
  }, [refetch, refetchSettings]);

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
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading}>
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

      {/* De basisdatum en wat er nu loopt, boven de schema's: dit is werk dat
          uren duurt en dat je wilt zien voordat je aan een schema zit. */}
      <BackfillStartField settings={settings} onSaved={refetchSettings} />
      <BackfillCard registerRefresh={registerBackfillRefresh} />

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
