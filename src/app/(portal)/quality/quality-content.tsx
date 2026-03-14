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
import { RiShieldCheckLine } from "@remixicon/react";
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
    <div className="page-content">
      <div className="page-header">
        <h1>{t("quality.title")}</h1>
      </div>

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
