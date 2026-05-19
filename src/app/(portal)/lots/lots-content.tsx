"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { SelectSupplierPrompt } from "@/components/ui/select-supplier-prompt";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RiSearchLine, RiStackLine, RiDownloadLine } from "@remixicon/react";
import { exportToCSV } from "@/lib/export-csv";
import { useFetch } from "@/hooks/use-fetch";
import { ErrorState } from "@/components/ui/error-state";
import { formatTime } from "@/lib/format";
import { RiRefreshLine } from "@remixicon/react";
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

export function LotsContent({ supplierId }: { supplierId: string | null }) {
  if (!supplierId) return <SelectSupplierPrompt />;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { t } = useLanguage();

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (supplierId) params.set("supplierId", supplierId);
    return `/api/lots?${params}`;
  }, [supplierId]);
  const { data: lots, loading, error, lastUpdated, refetch } = useFetch<LotRow[]>(url);

  if (error) {
    return (
      <div className="page-content">
        <ErrorState onRetry={refetch} />
      </div>
    );
  }

  const filtered = (lots || []).filter((lot) => {
    const matchesSearch =
      !search ||
      lot.lotNumber.toLowerCase().includes(search.toLowerCase()) ||
      lot.productName.toLowerCase().includes(search.toLowerCase()) ||
      lot.articleGroup.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || lot.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>{t("lots.title")}</h1>
        <div className="flex items-center gap-2">
          {filtered.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                exportToCSV(filtered, "lots-export", [
                { key: "lotNumber", header: "Lot Number" },
                { key: "productName", header: "Product" },
                { key: "articleGroup", header: "Article Group" },
                { key: "colli", header: "Colli" },
                { key: "stemLength", header: "Length (cm)" },
                { key: "totalStems", header: "Stems" },
                { key: "avgPrice", header: "Avg Price" },
                { key: "totalAmount", header: "Amount" },
                { key: "deliveryDate", header: "Delivery Date" },
                { key: "status", header: "Status" },
              ])
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

      {/* Filters */}
      <div className="filter-bar">
        <div className="relative flex-1 min-w-[200px]">
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

      {/* Mobile card list */}
      <div className="space-y-3 md:hidden">
        {filtered.map((lot) => (
          <Link key={lot.id} href={`/lots/${lot.id}`} className="block">
            <Card className="transition-colors hover:bg-accent/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-primary">{lot.lotNumber}</span>
                  <div className="flex items-center gap-1.5">
                    {lot.hasQualityIssues && (
                      <Badge variant="destructive" className="text-xs">Q</Badge>
                    )}
                    <Badge variant={statusVariant[lot.status]}>
                      {t(`lots.${lot.status === "in_transit" ? "inTransit" : lot.status}` as Parameters<typeof t>[0])}
                    </Badge>
                  </div>
                </div>
                <p className="text-sm text-foreground">{lot.productName}</p>
                <p className="text-xs text-muted-foreground mb-3">{lot.articleGroup}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("lots.totalStems")}</span>
                    <span className="tabular-nums font-medium">{formatNumber(lot.totalStems)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("lots.avgPrice")}</span>
                    <span className="tabular-nums font-medium">{formatPrice(lot.avgPrice)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("lots.totalAmount")}</span>
                    <span className="tabular-nums font-medium">{formatCurrencyDetailed(lot.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("lots.deliveryDate")}</span>
                    <span className="tabular-nums">{formatDate(lot.deliveryDate)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {filtered.length === 0 && !loading && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <RiStackLine />
            </div>
            <p className="empty-state-text">{t("common.noResults")}</p>
          </div>
        )}
      </div>

      {/* Desktop lots table */}
      <div className="hidden md:block">
          <Table stickyHeader>
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
                  <TableCell className="text-muted-foreground">{lot.articleGroup}</TableCell>
                  <TableCell className="text-right tabular-nums">{lot.colli}</TableCell>
                  <TableCell className="text-right tabular-nums">{lot.stemLength}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(lot.totalStems)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPrice(lot.avgPrice)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrencyDetailed(lot.totalAmount)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(lot.deliveryDate)}</TableCell>
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
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={11} className="py-0">
                    <div className="empty-state">
                      <div className="empty-state-icon">
                        <RiStackLine />
                      </div>
                      <p className="empty-state-text">{t("common.noResults")}</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
      </div>
    </div>
  );
}
