"use client";

import { useState } from "react";
import Link from "next/link";
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
import { ShipmentStatusBadge } from "@/components/ui/shipment-status-badge";
import type { ShipmentStatus } from "@/lib/shipment-status";
import { RiArrowLeftLine, RiArrowDownSLine, RiArrowRightSLine, RiFileDownloadLine } from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import {
  formatCurrencyDetailed,
  formatNumber,
  formatPrice,
  formatDate,
} from "@/lib/format";

interface Transaction {
  id: string;
  fabricOrdregId: number | null;
  date: string;
  salesType: string;
  stems: number;
  pricePerStem: string;
  amount: string;
  bronFeitExtra: string;
  correctionReasonId: number | null;
}

interface CorrectionReason {
  id: number;
  code: string;
  nameNl: string;
  nameEn: string | null;
}

/** Merged display row: groups transactions with the same fabricOrdregId */
interface MergedTransaction {
  id: string;
  date: string;
  salesType: string;
  stems: number;
  amount: number;
  pricePerStem: number;
  hasCorrection: boolean;
  correctionReasonId: number | null;
}

interface QualityIssue {
  id: string;
  code: string;
  description: string;
  stems: number;
  date: string;
}

interface LotCorrection {
  id: string;
  facttypeSub: string;
  correctionReasonId: number | null;
  correctionVolume: number | null;
  correctionColli: number | null;
}

interface Lot {
  id: string;
  lotNumber: string;
  productName: string;
  articleGroup: string;
  articleCode: string | null;
  colli: number;
  stemLength: number;
  totalStems: number;
  avgPrice: string;
  totalAmount: string;
  s1: string | null;
  s2: string | null;
  s3: string | null;
  transactions: Transaction[];
  qualityIssues: QualityIssue[];
  corrections: LotCorrection[];
}

interface Cost {
  id: string;
  description: string;
  amount: string;
  costTypeCode: string | null;
  costTypeName: string | null;
}

interface ShipmentDetailProps {
  shipment: {
    id: string;
    invoiceNumber: string;
    ourInvoiceNumber: string | null;
    invoiceDate: string;
    deliveryDate: string;
    totalTurnover: string;
    totalCosts: string;
    netResult: string;
    supplier: { id: string; code: string; name: string };
    pdfDocument: { id: string; fileUrl: string; fileName: string } | null;
    lots: Lot[];
    costs: Cost[];
  };
  correctionReasons?: Record<number, CorrectionReason>;
  status: ShipmentStatus;
}

export function ShipmentDetail({ shipment, correctionReasons = {}, status }: ShipmentDetailProps) {
  const { t, language } = useLanguage();
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set());

  const totalTurnover = parseFloat(shipment.totalTurnover);
  const totalCosts = parseFloat(shipment.totalCosts);
  const netResult = parseFloat(shipment.netResult);

  // Calculate stems from transactions (sold stems), not from stored totalStems
  const lotStems = (lot: Lot) => lot.transactions.reduce((sum, tx) => sum + tx.stems, 0);
  const totalStems = shipment.lots.reduce((sum, l) => sum + lotStems(l), 0);

  /** Channel category: Persoonlijk/VMP/Aurora → "Direct Sales", Veilen stays */
  const DIRECT_TYPES = new Set(["Persoonlijk", "VMP", "Aurora"]);
  const channelLabel = (salesType: string) =>
    DIRECT_TYPES.has(salesType) ? "Direct Sales" : salesType;

  /** Merge transactions in two passes:
   *  1. Group by fabricOrdregId (collapse origineel+correcties+prullenbak into one)
   *  2. Group by date + channel category (Direct Sales vs Veilen) */
  function mergeTransactions(transactions: Transaction[]): MergedTransaction[] {
    // --- Pass 1: merge by fabricOrdregId ---
    const ordregGroups = new Map<string, Transaction[]>();
    const ungrouped: Transaction[] = [];

    for (const tx of transactions) {
      if (tx.fabricOrdregId != null) {
        const key = `${tx.fabricOrdregId}`;
        if (!ordregGroups.has(key)) ordregGroups.set(key, []);
        ordregGroups.get(key)!.push(tx);
      } else {
        ungrouped.push(tx);
      }
    }

    const pass1: MergedTransaction[] = [];

    /*
     * De verkoop en de correctie blijven aparte regels, en dat is niet cosmetisch.
     *
     * Ze werden samengevoegd tot één regel met de brúto stelen van de originele
     * orderregel en het nétto bedrag van alles bij elkaar. De prijs die daaruit
     * volgde had nooit bestaan: partij 3980666 toonde 2.680 stelen voor EUR 794,80
     * — dus EUR 0,297 per steel — terwijl er 2.680 stelen voor EUR 0,354 waren
     * verkocht en er daarna EUR 154,00 was afgeboekt. Wie dat naast de sales sheet
     * legt kan er niets van maken, want daar staat gewoon 0,354.
     *
     * Zo staat het nu zoals de afrekening het ook toont: de verkoop met zijn eigen
     * prijs, en de correctie eronder met de zijne.
     */
    for (const txs of ordregGroups.values()) {
      const origineel = txs.find(t => t.bronFeitExtra === "origineel");
      const correcties = txs.filter(t => t.bronFeitExtra !== "origineel");
      const base = origineel ?? txs[0];

      if (origineel) {
        pass1.push({
          id: origineel.id,
          date: origineel.date,
          salesType: origineel.salesType,
          stems: origineel.stems,
          amount: parseFloat(origineel.amount),
          pricePerStem: parseFloat(origineel.pricePerStem),
          hasCorrection: false,
          correctionReasonId: null,
        });
      }

      const corrStems = correcties.reduce((s, t) => s + t.stems, 0);
      const corrAmount = correcties.reduce((s, t) => s + parseFloat(t.amount), 0);

      // Een correctie die per saldo niets verandert hoeft niemand te zien. Dat is
      // geen zeldzaamheid: een `prullenbak-factcor`-rij draagt altijd nul, en een
      // intrekking die meteen wordt teruggeboekt heft zichzelf op.
      if (correcties.length > 0 && (corrStems !== 0 || corrAmount !== 0)) {
        pass1.push({
          id: correcties[0].id,
          date: correcties[0].date,
          salesType: (origineel ?? base).salesType,
          stems: corrStems,
          amount: corrAmount,
          pricePerStem: corrStems !== 0 ? corrAmount / corrStems : 0,
          hasCorrection: true,
          correctionReasonId: correcties.find(t => t.correctionReasonId != null)?.correctionReasonId ?? null,
        });
      }

      // Geen originele regel én geen correctie die iets doet: dan blijft er niets
      // over om te tonen, maar de regel bestaat wel. Toon hem zoals hij is.
      if (!origineel && (correcties.length === 0 || (corrStems === 0 && corrAmount === 0))) {
        pass1.push({
          id: base.id,
          date: base.date,
          salesType: base.salesType,
          stems: txs.reduce((s, t) => s + t.stems, 0),
          amount: txs.reduce((s, t) => s + parseFloat(t.amount), 0),
          pricePerStem: parseFloat(base.pricePerStem),
          hasCorrection: correcties.length > 0,
          correctionReasonId: correcties.find(t => t.correctionReasonId != null)?.correctionReasonId ?? null,
        });
      }
    }

    for (const tx of ungrouped) {
      pass1.push({
        id: tx.id,
        date: tx.date,
        salesType: tx.salesType,
        stems: tx.stems,
        amount: parseFloat(tx.amount),
        pricePerStem: parseFloat(tx.pricePerStem),
        hasCorrection: false,
        correctionReasonId: null,
      });
    }

    // --- Pass 2: group by date (day) + channel category ---
    const dayGroups = new Map<string, MergedTransaction[]>();
    for (const tx of pass1) {
      const dayKey = new Date(tx.date).toISOString().slice(0, 10);
      const channel = channelLabel(tx.salesType);
      // Correcties krijgen een eigen sleutel, anders veegt deze stap ze alsnog bij
      // de verkoop waar de vorige stap ze net van heeft gescheiden — en dan is de
      // prijs weer het gemiddelde van twee dingen die niets met elkaar te maken hebben.
      const key = `${dayKey}::${channel}::${tx.hasCorrection ? "corr" : "verkoop"}`;
      if (!dayGroups.has(key)) dayGroups.set(key, []);
      dayGroups.get(key)!.push(tx);
    }

    const result: MergedTransaction[] = [];
    for (const [key, txs] of dayGroups) {
      const channel = key.split("::")[1];
      const totalStems = txs.reduce((s, t) => s + t.stems, 0);
      const totalAmount = txs.reduce((s, t) => s + t.amount, 0);
      const hasCorrection = txs.some(t => t.hasCorrection);
      const correctionReasonId = txs.find(t => t.correctionReasonId != null)?.correctionReasonId ?? null;

      result.push({
        id: txs[0].id,
        date: txs[0].date,
        salesType: channel,
        stems: totalStems,
        amount: totalAmount,
        pricePerStem: totalStems !== 0 ? totalAmount / totalStems : 0,
        hasCorrection,
        correctionReasonId,
      });
    }

    result.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return result;
  }

  // Collect all corrections across all lots for the separate corrections section
  const allCorrections = shipment.lots.flatMap((lot) =>
    lot.corrections.map((corr) => ({ ...corr, lotNumber: lot.lotNumber, productName: lot.productName }))
  );

  function toggleLot(id: string) {
    setExpandedLots((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="page-content">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href={`/shipments?supplierId=${shipment.supplier.id}`}>
          <Button variant="ghost" size="icon" className="mt-1 shrink-0">
            <RiArrowLeftLine className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1 space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                {t("shipments.details")}: {shipment.invoiceNumber}
              </h1>
              <ShipmentStatusBadge status={status} />
            </div>
            {/* Labels op een vaste breedte, zodat de waarden een kolom vormen. */}
            <dl className="mt-1 space-y-0.5 text-sm">
              <div className="flex gap-2">
                <dt className="min-w-32 text-muted-foreground">{t("shipments.deliveryDate")}</dt>
                <dd className="tabular-nums">{formatDate(shipment.deliveryDate)}</dd>
              </div>
              {shipment.ourInvoiceNumber && (
                <div className="flex gap-2">
                  <dt className="min-w-32 text-muted-foreground">{t("shipments.invoiceNumber")}</dt>
                  <dd className="tabular-nums">{shipment.ourInvoiceNumber}</dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt className="min-w-32 text-muted-foreground">{t("shipments.invoiceDate")}</dt>
                <dd className="tabular-nums">{formatDate(shipment.invoiceDate)}</dd>
              </div>
            </dl>
          </div>
          {shipment.pdfDocument && (
            <a href={shipment.pdfDocument.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-block">
              <Button variant="outline" className="gap-2 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10">
                <RiFileDownloadLine className="h-5 w-5" />
                Download Sales Sheet
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <p className="kpi-label">{t("shipments.lots")}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{shipment.lots.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="kpi-label">{t("shipments.stems")}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(totalStems)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="kpi-label">{t("shipments.turnover")}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatCurrencyDetailed(totalTurnover)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="kpi-label">{t("shipments.costs")}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatCurrencyDetailed(totalCosts)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="kpi-label">{t("shipments.netResult")}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${netResult >= 0 ? "text-green-600" : "text-red-600"}`}>
              {formatCurrencyDetailed(netResult)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Lots table with expandable transactions */}
      <Card>
        <CardHeader>
          <CardTitle>{t("shipments.lotsInShipment")} ({shipment.lots.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>{t("lots.lotNumber")}</TableHead>
                <TableHead>{t("lots.product")}</TableHead>
                <TableHead>{t("lots.articleGroup")}</TableHead>
                <TableHead>S1</TableHead>
                <TableHead>S2</TableHead>
                <TableHead>S3</TableHead>
                <TableHead className="text-right">{t("lots.colli")}</TableHead>
                <TableHead className="text-right">{t("lots.stemLength")}</TableHead>
                <TableHead className="text-right">{t("lots.totalStems")}</TableHead>
                <TableHead className="text-right">{t("lots.avgPrice")}</TableHead>
                <TableHead className="text-right">{t("lots.totalAmount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shipment.lots.map((lot) => {
                const isExpanded = expandedLots.has(lot.id);
                const hasTransactions = lot.transactions.length > 0;
                const stems = lotStems(lot);
                return (
                  <>
                    <TableRow
                      key={lot.id}
                      className={hasTransactions ? "cursor-pointer hover:bg-accent/50" : ""}
                      onClick={() => hasTransactions && toggleLot(lot.id)}
                    >
                      <TableCell className="px-2">
                        {hasTransactions && (
                          isExpanded
                            ? <RiArrowDownSLine className="h-4 w-4 text-muted-foreground" />
                            : <RiArrowRightSLine className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{lot.lotNumber}</TableCell>
                      <TableCell>{lot.productName}</TableCell>
                      <TableCell className="text-muted-foreground">{lot.articleGroup}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{lot.s1 || "-"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{lot.s2 || "-"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{lot.s3 || "-"}</TableCell>
                      <TableCell className="text-right tabular-nums">{lot.colli}</TableCell>
                      <TableCell className="text-right tabular-nums">{lot.stemLength}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(stems)}</TableCell>
                      <TableCell className="text-right tabular-nums">{stems > 0 ? formatPrice(parseFloat(lot.avgPrice)) : "-"}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{stems > 0 ? formatCurrencyDetailed(parseFloat(lot.totalAmount)) : "-"}</TableCell>
                    </TableRow>
                    {isExpanded && mergeTransactions(lot.transactions).map((tx) => {
                      const rowClass = tx.hasCorrection
                        ? "bg-red-50/50 dark:bg-red-950/10"
                        : "bg-muted/30";
                      const valueClass = tx.hasCorrection ? "text-red-600 dark:text-red-400" : "";
                      const reason = tx.correctionReasonId ? correctionReasons[tx.correctionReasonId] : null;
                      const reasonLabel = reason
                        ? (language === "en" && reason.nameEn) || reason.nameNl
                        : null;
                      return (
                        <TableRow key={tx.id} className={rowClass}>
                          <TableCell></TableCell>
                          <TableCell colSpan={3} className="text-muted-foreground text-sm">
                            {formatDate(tx.date)} &middot; {tx.salesType}
                            {tx.hasCorrection && (
                              <Badge variant="destructive" className="ml-2 text-xs">{t("shipments.correction")}</Badge>
                            )}
                            {reasonLabel && (
                              <span className="ml-2 text-xs text-red-600 dark:text-red-400">({reasonLabel})</span>
                            )}
                          </TableCell>
                          <TableCell colSpan={3}></TableCell>
                          <TableCell></TableCell>
                          <TableCell></TableCell>
                          <TableCell className={`text-right tabular-nums text-sm ${valueClass}`}>
                            {formatNumber(tx.stems)}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums text-sm ${valueClass}`}>
                            {tx.pricePerStem !== 0 ? formatPrice(tx.pricePerStem) : "-"}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums text-sm ${valueClass}`}>
                            {tx.amount !== 0 ? formatCurrencyDetailed(tx.amount) : "-"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </>
                );
              })}
              {shipment.lots.length > 1 && (
                <TableRow className="font-semibold bg-muted/30">
                  <TableCell></TableCell>
                  <TableCell colSpan={3}>{t("common.total")}</TableCell>
                  <TableCell></TableCell>
                  <TableCell></TableCell>
                  <TableCell></TableCell>
                  <TableCell></TableCell>
                  <TableCell></TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(totalStems)}</TableCell>
                  <TableCell></TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrencyDetailed(totalTurnover)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Corrections */}
      {allCorrections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600 dark:text-red-400">
              {t("shipments.corrections")} ({allCorrections.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("lots.lotNumber")}</TableHead>
                  <TableHead>{t("lots.product")}</TableHead>
                  <TableHead>{t("shipments.correctionReason")}</TableHead>
                  <TableHead className="text-right">{t("shipments.stems")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allCorrections.map((corr) => {
                  const reason = corr.correctionReasonId ? correctionReasons[corr.correctionReasonId] : null;
                  return (
                  <TableRow key={corr.id} className="bg-red-50/50 dark:bg-red-950/10">
                    <TableCell className="font-medium">{corr.lotNumber}</TableCell>
                    <TableCell>{corr.productName}</TableCell>
                    <TableCell className="text-red-600 dark:text-red-400">
                      {reason
                        ? (language === "en" && reason.nameEn) || reason.nameNl
                        : corr.facttypeSub}
                      {reason && (
                        <span className="text-muted-foreground ml-2">({reason.code})</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-red-600 dark:text-red-400">
                      {corr.correctionVolume != null ? formatNumber(corr.correctionVolume) : "-"}
                    </TableCell>
                  </TableRow>
                  );
                })}
                <TableRow className="font-semibold bg-red-50 dark:bg-red-950/20">
                  <TableCell colSpan={3}>{t("common.total")}</TableCell>
                  <TableCell className="text-right tabular-nums text-red-600 dark:text-red-400">
                    {formatNumber(allCorrections.reduce((sum, c) => sum + (c.correctionVolume ?? 0), 0))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Costs */}
      {shipment.costs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("shipments.costs")} ({shipment.costs.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.description")}</TableHead>
                  <TableHead>{t("shipments.costType")}</TableHead>
                  <TableHead className="text-right">{t("lots.totalAmount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shipment.costs.map((cost) => (
                  <TableRow key={cost.id}>
                    <TableCell>{cost.description}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {cost.costTypeName && (
                        <Badge variant="outline" className="text-xs">{cost.costTypeName}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrencyDetailed(parseFloat(cost.amount))}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold bg-muted/30">
                  <TableCell colSpan={2}>{t("common.total")}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrencyDetailed(totalCosts)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
