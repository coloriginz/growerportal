"use client";

import { useMemo } from "react";
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
import {
  RiShieldCheckLine,
  RiAlertLine,
  RiPlantLine,
  RiPercentLine,
  RiDownloadLine,
} from "@remixicon/react";
import { exportToCSV } from "@/lib/export-csv";
import { useFetch } from "@/hooks/use-fetch";
import { ErrorState } from "@/components/ui/error-state";
import { formatTime } from "@/lib/format";
import { RiRefreshLine } from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import { formatDate, formatNumber } from "@/lib/format";
import { translateQualityCode } from "@/lib/quality-codes";

interface QualityRow {
  id: string;
  code: string;
  description: string;
  stems: number;
  date: string;
  lot: {
    id: string;
    lotNumber: string;
    productName: string;
  };
}

interface QualitySummary {
  totalIssues: number;
  totalAffectedStems: number;
  qualityRate: number;
  mostCommonIssue: { code: string; description: string; count: number } | null;
}

interface QualityData {
  summary: QualitySummary;
  issues: QualityRow[];
}

export function QualityContent({ growerId }: { growerId: string | null }) {
  const { t } = useLanguage();

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (growerId) params.set("growerId", growerId);
    return `/api/quality?${params}`;
  }, [growerId]);
  const { data, loading, error, lastUpdated, refetch } = useFetch<QualityData>(url);
  const issues = data?.issues || [];
  const summary = data?.summary || null;

  if (error) {
    return (
      <div className="page-content">
        <ErrorState onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>{t("quality.title")}</h1>
        <div className="flex items-center gap-2">
          {issues.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                exportToCSV(
                  issues.map((i) => ({ ...i, lotNumber: i.lot.lotNumber, productName: i.lot.productName })),
                  "quality-export",
                  [
                    { key: "code", header: "Code" },
                    { key: "description", header: "Description" },
                    { key: "lotNumber", header: "Lot" },
                    { key: "productName", header: "Product" },
                    { key: "stems", header: "Affected Stems" },
                    { key: "date", header: "Date" },
                  ]
                )
              }
            >
              <RiDownloadLine className="mr-2 h-4 w-4" />
              {t("common.exportCSV")}
            </Button>
          )}
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              {formatTime(lastUpdated)}
            </span>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refetch}>
            <RiRefreshLine className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="kpi-label">{t("quality.totalIssues")}</CardTitle>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
                <RiAlertLine className="h-[18px] w-[18px] text-accent-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="kpi-value">{formatNumber(summary.totalIssues)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="kpi-label">{t("quality.totalAffectedStems")}</CardTitle>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
                <RiPlantLine className="h-[18px] w-[18px] text-accent-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="kpi-value">{formatNumber(summary.totalAffectedStems)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="kpi-label">{t("quality.qualityRate")}</CardTitle>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
                <RiPercentLine className="h-[18px] w-[18px] text-accent-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="kpi-value">{summary.qualityRate.toFixed(1)}%</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="kpi-label">{t("quality.mostCommonIssue")}</CardTitle>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
                <RiShieldCheckLine className="h-[18px] w-[18px] text-accent-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              {summary.mostCommonIssue ? (
                <>
                  <div className="kpi-value">{summary.mostCommonIssue.code}</div>
                  <p className="text-muted-foreground mt-1 text-xs">{summary.mostCommonIssue.description}</p>
                </>
              ) : (
                <div className="kpi-value">-</div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("quality.code")}</TableHead>
                <TableHead>{t("quality.description")}</TableHead>
                <TableHead>{t("quality.lot")}</TableHead>
                <TableHead>{t("lots.product")}</TableHead>
                <TableHead className="text-right">{t("quality.affectedStems")}</TableHead>
                <TableHead>{t("common.date")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {issues.map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell>
                    <Badge variant="destructive">{issue.code}</Badge>
                  </TableCell>
                  <TableCell>{translateQualityCode(issue.code, issue.description, t)}</TableCell>
                  <TableCell>
                    <Link
                      href={`/lots/${issue.lot.id}`}
                      className="text-primary font-medium hover:underline"
                    >
                      {issue.lot.lotNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{issue.lot.productName}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(issue.stems)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(issue.date)}</TableCell>
                </TableRow>
              ))}
              {issues.length === 0 && !loading && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-0">
                    <div className="empty-state">
                      <div className="empty-state-icon">
                        <RiShieldCheckLine />
                      </div>
                      <p className="empty-state-text">{t("common.noResults")}</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
