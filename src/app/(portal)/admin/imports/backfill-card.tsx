"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RiAlertLine, RiErrorWarningLine, RiRestartLine } from "@remixicon/react";
import { toast } from "sonner";
import { useFetch } from "@/hooks/use-fetch";

// ─── Backfill progress ────────────────────────────────────────

/** Eén lopende backfill, zoals `GET /api/sync/backfill` hem teruggeeft. */
export interface OpenBackfillRow {
  runId: string;
  supplierFabricId: number;
  total: number;
  done: number;
  failed: number;
  /** De brok waar hij nu op staat, als "lots 2025 Q3"; null als er niets meer wacht. */
  current: string | null;
  /** Er staat een geplande ronde vóór hem in de wachtrij. */
  waitingOnRound: boolean;
  code: string | null;
  name: string | null;
}

export interface BackfillResponse {
  backfills: OpenBackfillRow[];
}

function supplierLabel(backfill: OpenBackfillRow): string {
  if (backfill.code === null) return `Fabric relation ${backfill.supplierFabricId}`;
  return backfill.name ? `${backfill.code} — ${backfill.name}` : backfill.code;
}

/**
 * Waar hij is, in één regel. `current` is null zodra er niets meer wacht: dan
 * staat de rest geannuleerd achter een gestrande brok en is Resume de weg
 * vooruit.
 */
function progressLabel(backfill: OpenBackfillRow): string {
  if (backfill.current === null) {
    return backfill.failed > 0 ? "Stalled — resume to continue" : "Nothing queued";
  }
  if (backfill.waitingOnRound) {
    return `Waiting for a scheduled round — next up: ${backfill.current}`;
  }
  return `Current chunk: ${backfill.current}`;
}

function ResumeButton({ runId, onResumed }: { runId: string; onResumed: () => void }) {
  const [resuming, setResuming] = useState(false);

  const resume = useCallback(async () => {
    setResuming(true);
    try {
      const res = await fetch(`/api/sync/backfill/${runId}/resume`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(typeof body?.error === "string" ? body.error : "Failed to resume the backfill");
        return;
      }
      const resumed = typeof body?.resumed === "number" ? body.resumed : 0;
      toast.success(`Resumed ${resumed} job${resumed === 1 ? "" : "s"}`);
      onResumed();
    } catch {
      toast.error("Failed to resume the backfill");
    } finally {
      setResuming(false);
    }
  }, [runId, onResumed]);

  return (
    <Button variant="outline" size="sm" onClick={resume} disabled={resuming}>
      <RiRestartLine className={`mr-2 h-4 w-4 ${resuming ? "animate-spin" : ""}`} />
      Resume
    </Button>
  );
}

/**
 * De backfills die nog lopen. Vierendertig batches per backfill overspoelen de
 * Data Sync-lijst; deze kaart is de plek waar één backfill één regel is.
 *
 * Geen eigen verversknop en geen polling: het tabblad heeft er één, en die neemt
 * deze kaart mee via `registerRefresh`. De fetch blijft hier omdat de vorm van
 * het antwoord verder niemand aangaat.
 */
export function BackfillCard({ registerRefresh }: { registerRefresh: (refresh: () => void) => void }) {
  const { data, error, refetch } = useFetch<BackfillResponse>("/api/sync/backfill");

  useEffect(() => {
    registerRefresh(refetch);
  }, [registerRefresh, refetch]);

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">
        <RiErrorWarningLine className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Could not load backfill progress</span>
      </div>
    );
  }

  const backfills = data?.backfills ?? [];
  // Niets te melden is geen lege kaart: zonder open backfill hoort hier niets te
  // staan. Dat geldt ook tijdens de eerste fetch — een kaart die verschijnt en
  // meteen weer weggaat is erger dan een kaart die een tel later komt.
  if (backfills.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          Running backfills
          <Badge variant="outline" className="ml-2">
            {backfills.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {backfills.map((backfill) => (
          <div key={backfill.runId} className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <span className="font-medium">{supplierLabel(backfill)}</span>
              <span className="shrink-0 text-muted-foreground">
                {backfill.done} / {backfill.total} jobs
              </span>
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.round((backfill.done / backfill.total) * 100)}%` }}
              />
            </div>

            <p className="text-xs text-muted-foreground">{progressLabel(backfill)}</p>

            {backfill.failed > 0 && (
              <div className="flex items-center justify-between gap-4 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <span className="flex items-start gap-2">
                  <RiAlertLine className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {backfill.failed} job{backfill.failed === 1 ? "" : "s"} failed — the rest of this
                    backfill is cancelled until you resume it
                  </span>
                </span>
                <ResumeButton runId={backfill.runId} onResumed={refetch} />
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
