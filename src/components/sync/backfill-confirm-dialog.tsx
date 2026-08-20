"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RiHistoryLine } from "@remixicon/react";
import { useFetch } from "@/hooks/use-fetch";
import { formatDate, formatNumber } from "@/lib/format";

interface SyncSettings {
  backfillStartDate: string | null;
  quarters: number;
  jobs: number;
}

/** De leverancier waar het over gaat; bij een overgeslagen relatie kan de code ontbreken. */
export type BackfillConfirmSupplier = { code: string | null; name: string | null };

/**
 * Wat een backfill kost, vóórdat hij begint: welke leverancier, vanaf welke
 * datum, hoeveel kwartalen en hoeveel jobs, en wanneer hij aan de beurt is.
 *
 * Eén component voor twee plekken — het overgeslagen-paneel en de
 * leverancierspagina — omdat twee kopieën van dezelfde bevestiging gegarandeerd
 * uit elkaar lopen zodra één van beide een getal erbij krijgt. Het verschil
 * tussen die plekken zit alleen in de knoppen: het paneel biedt een uitweg die
 * de leverancier wél aanmaakt maar de backfill niet, de leverancierspagina
 * heeft niets aan te maken en dus geen tweede knop.
 *
 * De basisdatum haalt hij zelf op. Beide aanroepers zouden hem anders elk apart
 * moeten ophalen en er elk apart hun eigen conclusie uit trekken.
 */
export function BackfillConfirmDialog({
  supplier,
  confirmLabel,
  onConfirm,
  secondary,
  onCancel,
  busy = false,
}: {
  supplier: BackfillConfirmSupplier;
  /** De knop die de backfill meeneemt. Verdwijnt als er geen basisdatum is. */
  confirmLabel: string;
  onConfirm: () => void;
  /** De uitweg die zonder backfill doorgaat; alleen het overgeslagen-paneel heeft er één. */
  secondary?: { label: string; onClick: () => void };
  onCancel: () => void;
  busy?: boolean;
}) {
  const { data, loading, error } = useFetch<SyncSettings>("/api/sync/settings");

  // Zonder leesbare basisdatum valt er niets te backfillen. Een mislukte fetch
  // telt daarbij als "onbekend" en niet als nul: de knop weghalen is eerlijker
  // dan een backfill aanbieden waarvan niemand weet hoe ver hij teruggaat.
  const startDate = error ? null : (data?.backfillStartDate ?? null);
  const kanBackfillen = !loading && !error && startDate !== null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RiHistoryLine className="h-5 w-5 text-muted-foreground" />
            Backfill history
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono">{supplier.code ?? "unknown code"}</span>
            {supplier.name ? ` — ${supplier.name}` : null}
          </DialogDescription>
        </DialogHeader>

        {loading && !data ? (
          <p className="text-sm text-muted-foreground">Loading the backfill start date...</p>
        ) : error ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            Could not load the backfill start date, so no history can be fetched right now.
          </p>
        ) : startDate === null ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            No backfill start date is set. Set one on the Schedules tab first, then the history can
            be fetched.
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">From</dt>
              <dd>{formatDate(startDate)}</dd>
              <dt className="text-muted-foreground">Quarters</dt>
              <dd>{formatNumber(data?.quarters ?? 0)}</dd>
              <dt className="text-muted-foreground">Sync jobs</dt>
              <dd>{formatNumber(data?.jobs ?? 0)}</dd>
            </dl>
            <p className="text-xs text-muted-foreground">
              It runs whenever no scheduled round is waiting, so it spreads out over the coming
              rounds instead of holding up the daily sync.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          {secondary && (
            <Button variant="outline" disabled={busy} onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          )}
          {kanBackfillen && (
            <Button disabled={busy} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
