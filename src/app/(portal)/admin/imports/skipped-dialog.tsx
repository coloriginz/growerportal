"use client";

import { useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RiAlertLine, RiCheckLine } from "@remixicon/react";
import { toast } from "sonner";
import { useFetch } from "@/hooks/use-fetch";
import { BackfillConfirmDialog } from "@/components/sync/backfill-confirm-dialog";
import { formatDate, formatNumber, formatTime } from "@/lib/format";
import type { ImportBatch } from "./shared";

interface SkippedRelationRow {
  relId: number;
  partijen: number;
  productie: number;
  code: string | null;
  name: string | null;
  country: string | null;
  accountManagerName: string | null;
  alBestaat: boolean;
}

interface SkippedResponse {
  batchId: string;
  endpoint: string;
  startedAt: string;
  recordsSkipped: number;
  kwekers: SkippedRelationRow[];
  interneBoekingen: SkippedRelationRow[];
}

interface Company {
  id: string;
  name: string;
  slug: string;
}

function RelationTable({
  rows,
  renderAction,
}: {
  rows: SkippedRelationRow[];
  renderAction?: (row: SkippedRelationRow) => React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">Code</th>
            <th className="px-3 py-1.5 text-left font-medium">Name</th>
            <th className="px-3 py-1.5 text-left font-medium">Country</th>
            <th className="px-3 py-1.5 text-left font-medium">Account manager</th>
            <th className="px-3 py-1.5 text-right font-medium">Lots skipped</th>
            {renderAction && <th className="px-3 py-1.5" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.relId} className="border-t">
              <td className="px-3 py-1.5 font-mono">
                {row.code ?? <span className="text-muted-foreground">rel_id {row.relId}</span>}
              </td>
              <td className="px-3 py-1.5">
                {row.name ?? (
                  <span className="text-muted-foreground">unknown in Fabric relations</span>
                )}
              </td>
              <td className="px-3 py-1.5">
                {row.country ?? <span className="text-muted-foreground">-</span>}
              </td>
              <td className="px-3 py-1.5">
                {row.accountManagerName ?? <span className="text-muted-foreground">-</span>}
              </td>
              <td className="px-3 py-1.5 text-right whitespace-nowrap">
                {formatNumber(row.partijen)}
              </td>
              {renderAction && <td className="px-3 py-1.5 text-right">{renderAction(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Wat een ronde heeft weggegooid, met een gezicht en een knop. De bovenste groep
 * zijn kwekers die een leverancier zouden kunnen worden; de onderste zijn interne
 * productieboekingen en die horen juist overgeslagen te blijven — daar staat
 * bewust geen knop bij, want een leverancier aanmaken is makkelijker dan hem
 * weer weg te krijgen.
 */
export function SkippedDialog({ batch, onClose }: { batch: ImportBatch; onClose: () => void }) {
  const { data, loading, error } = useFetch<SkippedResponse>(
    `/api/admin/import-batches/${batch.id}/skipped`
  );
  const { data: companies, error: companiesError } = useFetch<Company[]>("/api/companies");

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [activating, setActivating] = useState<number | null>(null);
  // De rij waarvoor de bevestiging openstaat. Aanzetten is sinds de backfill
  // twee handelingen, en de tweede kost uren werk; die mag niet ongevraagd
  // achter dezelfde klik zitten.
  const [confirming, setConfirming] = useState<SkippedRelationRow | null>(null);
  // Wat je zojuist hebt aangezet: de lijst komt uit een batch die niet verandert,
  // dus zonder dit blijft de knop staan alsof er niets is gebeurd.
  const [activated, setActivated] = useState<Set<number>>(new Set());

  const companyList = companies ?? [];
  const onlyCompany = companyList.length === 1 ? companyList[0] : null;
  const chosenCompanyId = onlyCompany?.id ?? companyId;

  const activate = useCallback(
    async (row: SkippedRelationRow, metBackfill: boolean) => {
      if (!chosenCompanyId) {
        toast.error("Pick a company first");
        return;
      }
      setActivating(row.relId);
      try {
        const res = await fetch("/api/admin/fabric-relations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fabricId: row.relId,
            companyId: chosenCompanyId,
            backfill: metBackfill,
          }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          // 409 betekent dat hij al bestaat — iemand anders was je voor, of het
          // antwoord op een geslaagde POST ging verloren. De gewenste toestand is
          // bereikt, dus de rij hoort op "Activated" en niet op een rode melding.
          if (res.status === 409) {
            setActivated((prev) => new Set(prev).add(row.relId));
            toast.info(`${row.code ?? row.relId} was already a supplier`);
            return;
          }
          toast.error(
            typeof body?.error === "string" ? body.error : "Failed to activate this supplier"
          );
          return;
        }
        setActivated((prev) => new Set(prev).add(row.relId));
        const naam = body?.code ?? row.code ?? row.relId;
        toast.success(`Supplier ${naam} created`, {
          description: body?.backfill
            ? `${body.backfill.jobs} backfill jobs queued. Its lots arrive over the coming rounds, oldest quarter first.`
            : "Its skipped lots arrive on the next round by themselves — the sync window is rolling.",
        });
        // De activatie is geslaagd en blijft staan; alleen de backfill niet.
        // Dat is een aparte melding, want de rij hierboven is niet fout.
        if (typeof body?.backfillError === "string") {
          toast.warning(`No backfill for ${naam}`, { description: body.backfillError });
        }
      } catch {
        toast.error("Failed to activate this supplier");
      } finally {
        setActivating(null);
      }
    },
    [chosenCompanyId]
  );

  const kwekers = data?.kwekers ?? [];
  const interneBoekingen = data?.interneBoekingen ?? [];

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RiAlertLine className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              Skipped suppliers — {batch.endpoint}
            </DialogTitle>
            <DialogDescription>
              {formatDate(batch.startedAt)} {formatTime(batch.startedAt)} &middot;{" "}
              {formatNumber(batch.recordsSkipped)} records skipped in total. The relations below are
              the busiest 50 with a missing supplier, so they add up to less: the rest of the skips
              are purchase lots (FOB/CIF, which this portal does not carry), duplicates, and rows the
              run had already seen.
            </DialogDescription>
          </DialogHeader>

          {loading && !data ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
          ) : error ? (
            <p className="py-8 text-center text-sm text-red-600 dark:text-red-400">
              Failed to load the skipped suppliers.
            </p>
          ) : (
            <div className="space-y-6 text-sm">
              <section className="space-y-2">
                <h3 className="font-medium">Suppliers you may want to activate</h3>
                {kwekers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None in this run.</p>
                ) : (
                  <>
                    {companyList.length === 0 && (
                      // Zonder company kan er niets aangemaakt worden. Zeg dat, in
                      // plaats van een knop te tonen die permanent op slot staat
                      // met "Choose a company first" terwijl er niets te kiezen valt.
                      <p className="text-xs text-red-600 dark:text-red-400">
                        {companiesError
                          ? "Could not load the companies, so nothing can be activated here."
                          : "There are no companies yet, so a supplier cannot be created."}
                      </p>
                    )}
                    {companyList.length > 1 && (
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground">Create under</Label>
                        <Select
                          value={companyId ?? ""}
                          onValueChange={(value) =>
                            setCompanyId(typeof value === "string" && value !== "" ? value : null)
                          }
                        >
                          <SelectTrigger className="w-[220px]">
                            {/* Zonder deze functie toont Base UI de rauwe waarde, en
                                dat is hier een UUID in plaats van een bedrijfsnaam. */}
                            <SelectValue placeholder="Choose a company">
                              {(value) =>
                                companyList.find((company) => company.id === value)?.name ??
                                "Choose a company"
                              }
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {companyList.map((company) => (
                              <SelectItem key={company.id} value={company.id}>
                                {company.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <RelationTable
                      rows={kwekers}
                      renderAction={(row) =>
                        row.alBestaat || activated.has(row.relId) ? (
                          <span className="flex items-center justify-end gap-1 text-green-700 dark:text-green-400">
                            <RiCheckLine className="h-3.5 w-3.5" />
                            Activated
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={activating !== null || !chosenCompanyId}
                            onClick={() => setConfirming(row)}
                            title={chosenCompanyId ? undefined : "Choose a company first"}
                          >
                            Activate
                          </Button>
                        )
                      }
                    />
                  </>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="font-medium">
                  Internal production bookings — these do not belong here
                </h3>
                {interneBoekingen.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None in this run.</p>
                ) : (
                  <div className="opacity-80">
                    <RelationTable rows={interneBoekingen} />
                  </div>
                )}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {confirming && (
        <BackfillConfirmDialog
          supplier={{ code: confirming.code, name: confirming.name }}
          confirmLabel="Activate and backfill"
          onConfirm={() => {
            void activate(confirming, true).finally(() => setConfirming(null));
          }}
          // Nee zeggen tegen de historie is een geldig antwoord: de leverancier
          // wordt dan wel aangemaakt en de backfill niet. Zonder basisdatum
          // blijft dit vanzelf de enige knop die de bevestiging nog toont.
          secondary={{
            label: "Activate only",
            onClick: () => {
              void activate(confirming, false).finally(() => setConfirming(null));
            },
          }}
          onCancel={() => setConfirming(null)}
          busy={activating !== null}
        />
      )}
    </>
  );
}
