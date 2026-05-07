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
import { RiArrowLeftLine, RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react";
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
    invoiceDate: string;
    deliveryDate: string;
    totalTurnover: string;
    totalCosts: string;
    netResult: string;
    supplier: { id: string; code: string; name: string };
    lots: Lot[];
    costs: Cost[];
  };
}

export function ShipmentDetail({ shipment }: ShipmentDetailProps) {
  const { t } = useLanguage();
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set());

  const totalTurnover = parseFloat(shipment.totalTurnover);
  const totalCosts = parseFloat(shipment.totalCosts);
  const netResult = parseFloat(shipment.netResult);
  const totalStems = shipment.lots.reduce((sum, l) => sum + l.totalStems, 0);

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
      <div className="flex items-center gap-4">
        <Link href="/shipments">
          <Button variant="ghost" size="icon" className="shrink-0">
            <RiArrowLeftLine className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("shipments.details")}: {shipment.invoiceNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("shipments.deliveryDate")}: {formatDate(shipment.deliveryDate)}
          </p>
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
                      <TableCell className="text-right tabular-nums">{formatNumber(lot.totalStems)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPrice(parseFloat(lot.avgPrice))}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatCurrencyDetailed(parseFloat(lot.totalAmount))}</TableCell>
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
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
