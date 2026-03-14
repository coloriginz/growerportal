"use client";

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
import { Separator } from "@/components/ui/separator";
import { RiArrowLeftLine, RiFileTextLine } from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import {
  formatCurrencyDetailed,
  formatNumber,
  formatPrice,
  formatDate,
} from "@/lib/format";

interface LotDetailProps {
  lot: {
    id: string;
    lotNumber: string;
    refNumber: string;
    productCode: string;
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
    grower: { id: string; code: string; name: string };
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
    costs: { id: string; description: string; amount: string }[];
    qualityIssues: {
      id: string;
      code: string;
      description: string;
      stems: number;
      date: string;
    }[];
  };
}

export function LotDetail({ lot }: LotDetailProps) {
  const { t } = useLanguage();
  const totalCosts = lot.costs.reduce((sum, c) => sum + parseFloat(c.amount), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/lots">
          <Button variant="ghost" size="icon">
            <RiArrowLeftLine className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">
            {t("lots.details")}: {lot.lotNumber}
          </h1>
          <p className="text-muted-foreground text-sm">
            {lot.productName} - {lot.articleGroup}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm">{t("lots.colli")}</p>
            <p className="text-xl font-semibold">{lot.colli}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm">{t("lots.stemLength")}</p>
            <p className="text-xl font-semibold">{lot.stemLength} cm</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm">{t("lots.totalStems")}</p>
            <p className="text-xl font-semibold">{formatNumber(lot.totalStems)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm">{t("lots.avgPrice")}</p>
            <p className="text-xl font-semibold">{formatPrice(parseFloat(lot.avgPrice))}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm">{t("lots.totalAmount")}</p>
            <p className="text-xl font-semibold">{formatCurrencyDetailed(parseFloat(lot.totalAmount))}</p>
          </CardContent>
        </Card>
      </div>

      {/* Sales Sheet link */}
      {lot.salesSheet && (
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <RiFileTextLine className="text-muted-foreground h-5 w-5" />
            <span className="text-sm">{t("lots.salesSheet")}:</span>
            <Link href={`/documents?type=salessheet`} className="text-primary text-sm hover:underline">
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
                  <TableCell>{formatDate(tx.date)}</TableCell>
                  <TableCell>
                    {tx.isCorrection ? tx.correctionType : tx.salesType}
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
                  <TableCell>{tx.s1}</TableCell>
                  <TableCell>{tx.s2}</TableCell>
                  <TableCell>{tx.s3}</TableCell>
                  <TableCell className="text-right">{tx.stems}</TableCell>
                  <TableCell className="text-right">
                    {parseFloat(tx.pricePerStem) > 0 ? formatPrice(parseFloat(tx.pricePerStem)) : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    {parseFloat(tx.amount) > 0 ? formatCurrencyDetailed(parseFloat(tx.amount)) : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Costs */}
      {lot.costs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("lots.costs")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">{t("lots.totalAmount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lot.costs.map((cost) => (
                  <TableRow key={cost.id}>
                    <TableCell>{cost.description}</TableCell>
                    <TableCell className="text-right">{formatCurrencyDetailed(parseFloat(cost.amount))}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{formatCurrencyDetailed(totalCosts)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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
                    <TableCell>{issue.description}</TableCell>
                    <TableCell className="text-right">{formatNumber(issue.stems)}</TableCell>
                    <TableCell>{formatDate(issue.date)}</TableCell>
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
