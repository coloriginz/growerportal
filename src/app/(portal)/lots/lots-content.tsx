"use client";

import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RiSearchLine, RiExternalLinkLine } from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import {
  formatCurrencyDetailed,
  formatNumber,
  formatPrice,
  formatDate,
} from "@/lib/format";
import type { LotStatus } from "@/types";

interface LotRow {
  id: string;
  lotNumber: string;
  productName: string;
  articleGroup: string;
  colli: number;
  stemLength: number;
  totalStems: number;
  avgPrice: number;
  totalAmount: number;
  containerType: string;
  deliveryDate: string;
  status: LotStatus;
  salesSheetId: string | null;
  hasQualityIssues: boolean;
}

const statusVariant: Record<LotStatus, "default" | "secondary" | "destructive" | "outline"> = {
  in_transit: "outline",
  selling: "secondary",
  sold: "default",
};

export function LotsContent({ growerId }: { growerId: string | null }) {
  const [lots, setLots] = useState<LotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { t } = useLanguage();

  useEffect(() => {
    async function fetchLots() {
      try {
        const params = new URLSearchParams();
        if (growerId) params.set("growerId", growerId);
        const res = await fetch(`/api/lots?${params}`);
        if (res.ok) {
          setLots(await res.json());
        }
      } finally {
        setLoading(false);
      }
    }
    fetchLots();
  }, [growerId]);

  const filtered = lots.filter((lot) => {
    const matchesSearch =
      !search ||
      lot.lotNumber.toLowerCase().includes(search.toLowerCase()) ||
      lot.productName.toLowerCase().includes(search.toLowerCase()) ||
      lot.articleGroup.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || lot.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("lots.title")}</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="relative flex-1">
          <RiSearchLine className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder={t("common.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { if (v !== null) setStatusFilter(v); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("lots.status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.all")}</SelectItem>
            <SelectItem value="in_transit">{t("lots.inTransit")}</SelectItem>
            <SelectItem value="selling">{t("lots.selling")}</SelectItem>
            <SelectItem value="sold">{t("lots.sold")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Lots table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("lots.lotNumber")}</TableHead>
                <TableHead>{t("lots.product")}</TableHead>
                <TableHead>{t("lots.articleGroup")}</TableHead>
                <TableHead className="text-right">{t("lots.colli")}</TableHead>
                <TableHead className="text-right">{t("lots.stemLength")}</TableHead>
                <TableHead className="text-right">{t("lots.totalStems")}</TableHead>
                <TableHead className="text-right">{t("lots.avgPrice")}</TableHead>
                <TableHead className="text-right">{t("lots.totalAmount")}</TableHead>
                <TableHead>{t("lots.deliveryDate")}</TableHead>
                <TableHead>{t("lots.status")}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((lot) => (
                <TableRow key={lot.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/lots/${lot.id}`}
                      className="text-primary hover:underline"
                    >
                      {lot.lotNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{lot.productName}</TableCell>
                  <TableCell>{lot.articleGroup}</TableCell>
                  <TableCell className="text-right">{lot.colli}</TableCell>
                  <TableCell className="text-right">{lot.stemLength}</TableCell>
                  <TableCell className="text-right">{formatNumber(lot.totalStems)}</TableCell>
                  <TableCell className="text-right">{formatPrice(lot.avgPrice)}</TableCell>
                  <TableCell className="text-right">{formatCurrencyDetailed(lot.totalAmount)}</TableCell>
                  <TableCell>{formatDate(lot.deliveryDate)}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[lot.status]}>
                      {t(`lots.${lot.status === "in_transit" ? "inTransit" : lot.status}` as Parameters<typeof t>[0])}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {lot.hasQualityIssues && (
                        <Badge variant="destructive" className="text-xs">Q</Badge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={11} className="text-muted-foreground text-center py-8">
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
