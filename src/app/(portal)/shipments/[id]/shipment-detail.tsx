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
  date: string;
  salesType: string;
  stems: number;
  pricePerStem: string;
  amount: string;
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
  correctionReason: {
    code: string;
    nameNl: string;
    nameEn: string | null;
    typeCode: string;
  } | null;
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
}

export function ShipmentDetail({ shipment }: ShipmentDetailProps) {
  const { t, language } = useLanguage();
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set());

  const totalTurnover = parseFloat(shipment.totalTurnover);
  const totalCosts = parseFloat(shipment.totalCosts);
  const netResult = parseFloat(shipment.netResult);

  // Calculate stems from transactions (sold stems), not from stored totalStems
  const lotStems = (lot: Lot) => lot.transactions.reduce((sum, tx) => sum + tx.stems, 0);
  const totalStems = shipment.lots.reduce((sum, l) => sum + lotStems(l), 0);

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
        <div className="flex-1 space-y-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("shipments.details")}: {shipment.invoiceNumber}
              {shipment.ourInvoiceNumber && (
                <span className="ml-2 text-base font-normal text-muted-foreground">({shipment.ourInvoiceNumber})</span>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("shipments.deliveryDate")}: {formatDate(shipment.deliveryDate)}
            </p>
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
                    {isExpanded && lot.transactions.map((tx) => (
                      <TableRow key={tx.id} className="bg-muted/30">
                        <TableCell></TableCell>
                        <TableCell colSpan={3} className="text-muted-foreground text-sm">
                          {formatDate(tx.date)} &middot; {tx.salesType}
                        </TableCell>
                        <TableCell colSpan={3}></TableCell>
                        <TableCell></TableCell>
                        <TableCell></TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{tx.stems}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {parseFloat(tx.pricePerStem) > 0 ? formatPrice(parseFloat(tx.pricePerStem)) : "-"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {parseFloat(tx.amount) > 0 ? formatCurrencyDetailed(parseFloat(tx.amount)) : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
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
                {allCorrections.map((corr) => (
                  <TableRow key={corr.id} className="bg-red-50/50 dark:bg-red-950/10">
                    <TableCell className="font-medium">{corr.lotNumber}</TableCell>
                    <TableCell>{corr.productName}</TableCell>
                    <TableCell className="text-red-600 dark:text-red-400">
                      {corr.correctionReason
                        ? (language === "en" && corr.correctionReason.nameEn) || corr.correctionReason.nameNl
                        : corr.facttypeSub}
                      {corr.correctionReason && (
                        <span className="text-muted-foreground ml-2">({corr.correctionReason.code})</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-red-600 dark:text-red-400">
                      {corr.correctionVolume != null ? formatNumber(corr.correctionVolume) : "-"}
                    </TableCell>
                  </TableRow>
                ))}
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
