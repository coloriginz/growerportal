"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/components/providers/language-provider";
import { formatDate, formatNumber } from "@/lib/format";

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

export function QualityContent({ growerId }: { growerId: string | null }) {
  const [issues, setIssues] = useState<QualityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useLanguage();

  useEffect(() => {
    async function fetchIssues() {
      try {
        const params = new URLSearchParams();
        if (growerId) params.set("growerId", growerId);
        const res = await fetch(`/api/quality?${params}`);
        if (res.ok) {
          setIssues(await res.json());
        }
      } finally {
        setLoading(false);
      }
    }
    fetchIssues();
  }, [growerId]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("quality.title")}</h1>

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
                  <TableCell>{issue.description}</TableCell>
                  <TableCell>
                    <Link
                      href={`/lots/${issue.lot.id}`}
                      className="text-primary hover:underline"
                    >
                      {issue.lot.lotNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{issue.lot.productName}</TableCell>
                  <TableCell className="text-right">{formatNumber(issue.stems)}</TableCell>
                  <TableCell>{formatDate(issue.date)}</TableCell>
                </TableRow>
              ))}
              {issues.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground text-center py-8">
                    {t("common.noResults")}
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
