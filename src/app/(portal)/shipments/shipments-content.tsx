"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { SelectSupplierPrompt } from "@/components/ui/select-supplier-prompt";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RiSearchLine, RiShipLine, RiDownloadLine, RiRefreshLine, RiMailLine } from "@remixicon/react";
import { exportToCSV } from "@/lib/export-csv";
import { useFetch } from "@/hooks/use-fetch";
import { ErrorState } from "@/components/ui/error-state";
import { formatTime } from "@/lib/format";
import { useLanguage } from "@/components/providers/language-provider";
import {
  formatCurrencyDetailed,
  formatNumber,
  formatDate,
} from "@/lib/format";

interface ShipmentRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  deliveryDate: string;
  totalTurnover: number;
  totalCosts: number;
  netResult: number;
  lotCount: number;
  costCount: number;
  totalStems: number;
}

interface IngestionRow {
  id: string;
  subject: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  processedAt: string;
  status: string;
  attachmentCount: number;
  processedCount: number;
  skippedCount: number;
  errors: string | null;
  createdAt: string;
  processed: { fileName: string; salesSheetId: string; invoiceNumber: string; ourInvoiceNumber: string; supplierCode: string }[];
  skipped: { fileName: string; reason: string }[];
}

export function ShipmentsContent({ supplierId }: { supplierId: string | null }) {
  const [search, setSearch] = useState("");
  const { t } = useLanguage();
  const router = useRouter();
  const { data: session } = useSession();

  const isAdmin = session?.user?.role === "admin" || session?.user?.role === "commercie" || session?.user?.role === "finance";

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (supplierId) params.set("supplierId", supplierId);
    return `/api/shipments?${params}`;
  }, [supplierId]);
  const { data: shipments, loading, error, lastUpdated, refetch } = useFetch<ShipmentRow[]>(url);

  if (!supplierId) return <SelectSupplierPrompt />;

  if (error) {
    return (
      <div className="page-content">
        <ErrorState onRetry={refetch} />
      </div>
    );
  }

  const filtered = (shipments || []).filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.invoiceNumber.toLowerCase().includes(q);
  });

  const shipmentsView = (
    <>
      <div className="page-header">
        <h1>{t("shipments.title")}</h1>
        <div className="flex items-center gap-2">
          {filtered.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                exportToCSV(filtered, "shipments-export", [
                  { key: "invoiceNumber", header: "Invoice Number" },
                  { key: "deliveryDate", header: "Delivery Date" },
                  { key: "lotCount", header: "Lots" },
                  { key: "totalStems", header: "Stems" },
                  { key: "totalTurnover", header: "Turnover" },
                  { key: "totalCosts", header: "Costs" },
                  { key: "netResult", header: "Net Result" },
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

      {/* Search */}
      <div className="filter-bar">
        <div className="relative flex-1 min-w-[200px]">
          <RiSearchLine className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder={t("shipments.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Mobile card list */}
      <div className="space-y-3 md:hidden">
        {filtered.map((s) => (
          <Link key={s.id} href={`/shipments/${s.id}`} className="block">
            <Card className="transition-colors hover:bg-accent/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-primary">{s.invoiceNumber}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(s.deliveryDate)}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("shipments.lots")}</span>
                    <span className="tabular-nums font-medium">{s.lotCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("shipments.stems")}</span>
                    <span className="tabular-nums font-medium">{formatNumber(s.totalStems)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("shipments.turnover")}</span>
                    <span className="tabular-nums font-medium">{formatCurrencyDetailed(s.totalTurnover)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("shipments.costs")}</span>
                    <span className="tabular-nums font-medium">{formatCurrencyDetailed(s.totalCosts)}</span>
                  </div>
                  <div className="col-span-2 flex justify-between border-t pt-1 mt-1">
                    <span className="text-muted-foreground font-medium">{t("shipments.netResult")}</span>
                    <span className={`tabular-nums font-semibold ${s.netResult >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatCurrencyDetailed(s.netResult)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {filtered.length === 0 && !loading && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <RiShipLine />
            </div>
            <p className="empty-state-text">{t("common.noResults")}</p>
          </div>
        )}
      </div>

      {/* Desktop table */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("shipments.invoiceNumber")}</TableHead>
                <TableHead>{t("shipments.deliveryDate")}</TableHead>
                <TableHead className="text-right">{t("shipments.lots")}</TableHead>
                <TableHead className="text-right">{t("shipments.stems")}</TableHead>
                <TableHead className="text-right">{t("shipments.turnover")}</TableHead>
                <TableHead className="text-right">{t("shipments.costs")}</TableHead>
                <TableHead className="text-right">{t("shipments.netResult")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/shipments/${s.id}`)}
                >
                  <TableCell className="font-medium text-primary">
                    {s.invoiceNumber}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(s.deliveryDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.lotCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(s.totalStems)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrencyDetailed(s.totalTurnover)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrencyDetailed(s.totalCosts)}</TableCell>
                  <TableCell className={`text-right tabular-nums font-medium ${s.netResult >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {formatCurrencyDetailed(s.netResult)}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && !loading && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="py-0">
                    <div className="empty-state">
                      <div className="empty-state-icon">
                        <RiShipLine />
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
    </>
  );

  if (!isAdmin) {
    return <div className="page-content">{shipmentsView}</div>;
  }

  return (
    <div className="page-content">
      <Tabs defaultValue="shipments">
        <TabsList>
          <TabsTrigger value="shipments">{t("shipments.title")}</TabsTrigger>
          <TabsTrigger value="import-log">Import Log</TabsTrigger>
        </TabsList>
        <TabsContent value="shipments" className="space-y-8 mt-6">
          {shipmentsView}
        </TabsContent>
        <TabsContent value="import-log" className="mt-6">
          <ImportLogTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Import Log Tab ──────────────────────────────────────

function ImportLogTab() {
  const { data: ingestions, loading, error, lastUpdated, refetch } = useFetch<IngestionRow[]>("/api/shipments/ingestions");
  const router = useRouter();

  if (error) return <ErrorState onRetry={refetch} />;

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1>Sales Sheet Import Log</h1>
        <div className="flex items-center gap-2">
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

      {/* Ingestion records */}
      <div className="space-y-4">
        {(ingestions || []).map((ing) => (
          <Card key={ing.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <RiMailLine className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium truncate">{ing.subject || "No subject"}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <IngestionStatusBadge status={ing.status} />
                  <span className="text-xs text-muted-foreground">{formatDate(ing.createdAt)}</span>
                </div>
              </div>

              {ing.fromAddress && (
                <p className="text-xs text-muted-foreground mb-2">From: {ing.fromAddress}</p>
              )}

              <div className="flex gap-4 text-xs text-muted-foreground mb-3">
                <span>{ing.attachmentCount} attachment{ing.attachmentCount !== 1 ? "s" : ""}</span>
                <span>{ing.processedCount} processed</span>
                {ing.skippedCount > 0 && <span>{ing.skippedCount} skipped</span>}
              </div>

              {/* Processed items with links */}
              {ing.processed.length > 0 && (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Supplier</TableHead>
                        <TableHead className="text-xs">Reference</TableHead>
                        <TableHead className="text-xs">Invoice #</TableHead>
                        <TableHead className="text-xs">File</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ing.processed.map((p, i) => (
                        <TableRow
                          key={i}
                          className="cursor-pointer"
                          onClick={() => router.push(`/shipments/${p.salesSheetId}`)}
                        >
                          <TableCell className="text-xs font-medium">{p.supplierCode}</TableCell>
                          <TableCell className="text-xs">
                            <span className="text-primary hover:underline">{p.invoiceNumber}</span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{p.ourInvoiceNumber || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">{p.fileName}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Skipped items */}
              {ing.skipped.filter((s) => s.reason !== "not_pdf").length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium">Skipped: </span>
                  {ing.skipped
                    .filter((s) => s.reason !== "not_pdf")
                    .map((s) => `${s.fileName} (${s.reason})`)
                    .join(", ")}
                </div>
              )}

              {/* Errors */}
              {ing.errors && (
                <p className="mt-2 text-xs text-red-600">{ing.errors}</p>
              )}
            </CardContent>
          </Card>
        ))}

        {!loading && (!ingestions || ingestions.length === 0) && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <RiMailLine />
            </div>
            <p className="empty-state-text">No import records yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

function IngestionStatusBadge({ status }: { status: string }) {
  const variant = status === "PROCESSED" ? "default" :
                  status === "PARTIAL" ? "secondary" :
                  status === "ERROR" ? "destructive" :
                  "outline";
  return <Badge variant={variant}>{status}</Badge>;
}
