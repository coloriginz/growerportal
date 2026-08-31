"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { RiArrowLeftLine, RiFileTextLine } from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import {
  formatCurrencyDetailed,
  formatNumber,
  formatPrice,
  formatDate,
} from "@/lib/format";
import { translateQualityCode } from "@/lib/quality-codes";

interface LotDetailProps {
  lot: {
    id: string;
    lotNumber: string;
    refNumber: string;
    productName: string;
    articleGroup: string;
    colli: number;
    stemLength: number;
    totalStems: number;
    avgPrice: string;
    totalAmount: string;
    containerType: string;
    deliveryDate: string;
    status: string;
    correctionVolume: number | null;
    supplier: { id: string; code: string; name: string };
    salesSheet: { id: string; invoiceNumber: string; pdfDocumentId: string | null } | null;
    transactions: {
      id: string;
      date: string;
      salesType: string;
      stems: number;
      pricePerStem: string;
      amount: string;
      qualityCode: string | null;
      qualityNote: string | null;
      s1: string | null;
      s2: string | null;
      s3: string | null;
      isCorrection: boolean;
      correctionType: string | null;
    }[];
    qualityIssues: {
      id: string;
      code: string;
      description: string;
      stems: number;
      date: string;
    }[];
    corrections: {
      id: string;
      facttypeSub: string;
      correctionReasonId: number | null;
      correctionVolume: number | null;
      correctionColli: number | null;
    }[];
  };
}

export function LotDetail({ lot }: LotDetailProps) {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const supplierId = searchParams.get("supplierId");
  const backHref = supplierId ? `/lots?supplierId=${supplierId}` : "/lots";
  return (
    <div className="page-content">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={backHref}>
          <Button variant="ghost" size="icon" className="shrink-0">
            <RiArrowLeftLine className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("lots.details")}: {lot.lotNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            {lot.productName} &middot; {lot.articleGroup}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <p className="kpi-label">{t("lots.colli")}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{lot.colli}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="kpi-label">{t("lots.stemLength")}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{lot.stemLength} cm</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="kpi-label">{t("lots.totalStems")}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(lot.totalStems)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="kpi-label">{t("lots.avgPrice")}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatPrice(parseFloat(lot.avgPrice))}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="kpi-label">{t("lots.totalAmount")}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatCurrencyDetailed(parseFloat(lot.totalAmount))}</p>
          </CardContent>
        </Card>
      </div>

      {/* Sales Sheet link */}
      {lot.salesSheet && (
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
              <RiFileTextLine className="h-4 w-4 text-accent-foreground" />
            </div>
            <span className="text-sm text-muted-foreground">{t("lots.salesSheet")}:</span>
            <Link href={`/documents?type=salessheet`} className="text-primary text-sm font-medium hover:underline">
              {lot.salesSheet.invoiceNumber}
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Transactions */}
      <Card>
        <CardHeader>
          <CardTitle>{t("lots.transactions")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead>{t("sales.salesType")}</TableHead>
                <TableHead>S1</TableHead>
                <TableHead>S2</TableHead>
                <TableHead>S3</TableHead>
                <TableHead className="text-right">{t("sales.stems")}</TableHead>
                <TableHead className="text-right">{t("sales.price")}</TableHead>
                <TableHead className="text-right">{t("lots.totalAmount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lot.transactions.map((tx) => (
                <TableRow
                  key={tx.id}
                  className={tx.isCorrection ? "text-muted-foreground italic" : ""}
                >
                  <TableCell className="text-muted-foreground">{formatDate(tx.date)}</TableCell>
                  <TableCell>
                    <span className="font-medium">{tx.isCorrection ? tx.correctionType : tx.salesType}</span>
                    {tx.qualityCode && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        {tx.qualityCode}
                      </Badge>
                    )}
                    {tx.qualityNote && (
                      <span className="text-muted-foreground ml-1 text-xs">
                        {tx.qualityNote}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{tx.s1}</TableCell>
                  <TableCell className="text-muted-foreground">{tx.s2}</TableCell>
                  <TableCell className="text-muted-foreground">{tx.s3}</TableCell>
                  <TableCell className="text-right tabular-nums">{tx.stems}</TableCell>
                  {/*
                    Op ongelijk aan nul toetsen, niet op groter dan nul: een
                    correctieregel draagt een negatief bedrag, en die verdween hier
                    achter een streepje. Juist bij een correctie is het bedrag het
                    enige wat je wilt zien.
                  */}
                  <TableCell className="text-right tabular-nums">
                    {parseFloat(tx.pricePerStem) !== 0 ? formatPrice(parseFloat(tx.pricePerStem)) : "-"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {parseFloat(tx.amount) !== 0 ? formatCurrencyDetailed(parseFloat(tx.amount)) : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Quality Issues */}
      {lot.qualityIssues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("lots.qualityIssues")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("quality.code")}</TableHead>
                  <TableHead>{t("quality.description")}</TableHead>
                  <TableHead className="text-right">{t("quality.affectedStems")}</TableHead>
                  <TableHead>{t("common.date")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lot.qualityIssues.map((issue) => (
                  <TableRow key={issue.id}>
                    <TableCell>
                      <Badge variant="destructive">{issue.code}</Badge>
                    </TableCell>
                    <TableCell>{translateQualityCode(issue.code, issue.description, t)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(issue.stems)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(issue.date)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Corrections */}
      {lot.corrections.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t("lots.corrections")}</CardTitle>
              {lot.correctionVolume != null && (
                <span className="text-sm text-muted-foreground">
                  {t("lots.totalCorrectionVolume")}: {formatNumber(lot.correctionVolume)}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("lots.correctionType")}</TableHead>
                  <TableHead>{t("lots.correctionReason")}</TableHead>
                  <TableHead className="text-right">{t("lots.correctionVolume")}</TableHead>
                  <TableHead className="text-right">{t("lots.correctionColli")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lot.corrections.map((corr) => (
                  <TableRow key={corr.id}>
                    <TableCell>
                      <Badge variant="outline">
                        {corr.facttypeSub}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {corr.correctionReasonId ?? "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {corr.correctionVolume != null ? formatNumber(corr.correctionVolume) : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {corr.correctionColli != null ? formatNumber(corr.correctionColli) : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
