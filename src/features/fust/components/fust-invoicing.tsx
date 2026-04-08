"use client";

import { useState, useMemo } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { formatDate, formatCurrencyDetailed } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  RiFileTextLine,
  RiLink,
  RiSendPlaneLine,
  RiDownloadLine,
  RiCheckLine,
  RiEyeLine,
} from "@remixicon/react";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────

interface FustTypeRef {
  id: string;
  code: string;
  name: string;
  pricePerUnit: string;
  rentalPricePerUnit: string;
  depositArticleCode: string;
  rentalArticleCode: string;
}

interface OrderRef {
  id: string;
  orderNumber: string;
  status: string;
  deliveredAt: string | null;
  invoicedAt: string | null;
  grower: { id: string; code: string; name: string; company: string | null };
  items: Array<{ id: string; quantity: number; fustType: FustTypeRef }>;
  voucherLinks?: Array<{
    id: string;
    voucher: {
      id: string;
      transactionNumber: string;
      type: string;
      transactionDate: string;
    };
  }>;
}

interface GrowerInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  growerId: string;
  grower: { code: string; name: string; company: string | null };
  subtotalExVat: string;
  vatAmount: string;
  totalInclVat: string;
  status: string;
  pdfUrl: string | null;
  xmlUrl: string | null;
  sentAt: string | null;
  notes: string | null;
  _count?: { items: number };
}

interface InvoiceLine {
  articleCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

type TabFilter = "ready" | "invoiced";

const VAT_RATE = 0.21;

// ─── Helpers ────────────────────────────────────────────

function buildInvoiceLines(orders: OrderRef[]): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  for (const order of orders) {
    for (const item of order.items) {
      const depositPrice = Number(item.fustType.pricePerUnit);
      if (depositPrice > 0) {
        lines.push({
          articleCode: item.fustType.depositArticleCode,
          description: `${item.fustType.name} - Deposit`,
          quantity: item.quantity,
          unitPrice: depositPrice,
          total: item.quantity * depositPrice,
        });
      }
      const rentalPrice = Number(item.fustType.rentalPricePerUnit);
      if (rentalPrice > 0) {
        lines.push({
          articleCode: item.fustType.rentalArticleCode,
          description: `${item.fustType.name} - Rental`,
          quantity: item.quantity,
          unitPrice: rentalPrice,
          total: item.quantity * rentalPrice,
        });
      }
    }
  }
  return lines;
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

// ─── Component ──────────────────────────────────────────

export function FustInvoicing() {
  const { t } = useLanguage();
  const tAny = t as unknown as (key: string) => string;
  const [activeTab, setActiveTab] = useState<TabFilter>("ready");

  // Data fetching
  const {
    data: orders,
    loading: ordersLoading,
    refetch: refetchOrders,
  } = useFetch<OrderRef[]>("/api/fust/orders?status=delivered");

  const {
    data: invoices,
    loading: invoicesLoading,
    refetch: refetchInvoices,
  } = useFetch<GrowerInvoice[]>("/api/fust/grower-invoices");

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Dialog state
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [generating, setGenerating] = useState(false);

  // Action loading state
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Filter orders: voucher links present AND not yet invoiced
  const readyOrders = useMemo(() => {
    if (!orders) return [];
    return orders.filter(
      (o) => (o.voucherLinks?.length ?? 0) > 0 && !o.invoicedAt
    );
  }, [orders]);

  // Selected orders
  const selectedOrders = useMemo(
    () => readyOrders.filter((o) => selectedIds.has(o.id)),
    [readyOrders, selectedIds]
  );

  // Check if all selected orders belong to the same grower
  const selectedGrowerIds = useMemo(() => {
    const ids = new Set(selectedOrders.map((o) => o.grower.id));
    return ids;
  }, [selectedOrders]);

  const allSameGrower = selectedGrowerIds.size <= 1;
  const canGenerate = selectedIds.size > 0 && allSameGrower;

  // Invoice preview lines
  const previewLines = useMemo(
    () => buildInvoiceLines(selectedOrders),
    [selectedOrders]
  );
  const subtotal = useMemo(
    () => previewLines.reduce((sum, l) => sum + l.total, 0),
    [previewLines]
  );
  const vatAmount = subtotal * VAT_RATE;
  const totalInclVat = subtotal + vatAmount;

  // Counts for tabs
  const counts = useMemo(
    () => ({
      ready: readyOrders.length,
      invoiced: invoices?.length ?? 0,
    }),
    [readyOrders, invoices]
  );

  // ─── Selection handlers ───────────────────────────────

  const toggleSelection = (orderId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === readyOrders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(readyOrders.map((o) => o.id)));
    }
  };

  // ─── Generate invoice ─────────────────────────────────

  const openGenerateDialog = () => {
    setInvoiceDate(todayISO());
    setNotes("");
    setShowGenerateDialog(true);
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setGenerating(true);
    try {
      const growerId = selectedOrders[0].grower.id;
      const res = await fetch("/api/fust/grower-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          growerId,
          orderIds: selectedOrders.map((o) => o.id),
          invoiceDate,
          notes: notes.trim() || undefined,
        }),
      });
      if (res.ok) {
        toast.success(tAny("fust.invoiceGenerated"));
        setShowGenerateDialog(false);
        setSelectedIds(new Set());
        refetchOrders();
        refetchInvoices();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || "Failed to generate invoice");
      }
    } catch {
      toast.error("Failed to generate invoice");
    } finally {
      setGenerating(false);
    }
  };

  const handlePreview = async () => {
    if (!canGenerate) return;
    setPreviewing(true);
    try {
      const growerId = selectedOrders[0].grower.id;
      const res = await fetch("/api/fust/grower-invoices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          growerId,
          orderIds: selectedOrders.map((o) => o.id),
          invoiceDate,
          notes: notes.trim() || undefined,
        }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || "Failed to generate preview");
      }
    } catch {
      toast.error("Failed to generate preview");
    } finally {
      setPreviewing(false);
    }
  };

  // ─── Invoice actions ──────────────────────────────────

  const handleSendInvoice = async (invoice: GrowerInvoice) => {
    setActionLoading(invoice.id);
    try {
      const res = await fetch(`/api/fust/grower-invoices/${invoice.id}/send`, {
        method: "POST",
      });
      if (res.ok) {
        toast.success(tAny("fust.invoiceSent"));
        refetchInvoices();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || "Failed to send invoice");
      }
    } catch {
      toast.error("Failed to send invoice");
    } finally {
      setActionLoading(null);
    }
  };

  const handleMarkPaid = async (invoice: GrowerInvoice) => {
    setActionLoading(invoice.id);
    try {
      const res = await fetch(`/api/fust/grower-invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid" }),
      });
      if (res.ok) {
        toast.success(tAny("fust.invoiceMarkedPaid"));
        refetchInvoices();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || "Failed to update invoice");
      }
    } catch {
      toast.error("Failed to update invoice");
    } finally {
      setActionLoading(null);
    }
  };

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">
        {tAny("fust.invoicesTitle")}
      </h1>

      {/* Tab filter */}
      <div className="flex items-center gap-1 border-b">
        <button
          className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "ready"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("ready")}
        >
          {tAny("fust.readyForInvoicing")} ({counts.ready})
        </button>
        <button
          className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "invoiced"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("invoiced")}
        >
          {tAny("fust.sentInvoices")} ({counts.invoiced})
        </button>
      </div>

      {/* ─── Tab 1: Ready for Invoicing ──────────────── */}
      {activeTab === "ready" && (
        <>
          {/* Action bar */}
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={!canGenerate}
              onClick={openGenerateDialog}
            >
              <RiFileTextLine className="mr-1.5 h-4 w-4" />
              {tAny("fust.generateInvoice")}
            </Button>
            {selectedIds.size > 0 && !allSameGrower && (
              <p className="text-sm text-destructive">
                {tAny("fust.selectSameGrowerWarning")}
              </p>
            )}
          </div>

          {ordersLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : readyOrders.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <RiFileTextLine className="mx-auto mb-2 h-10 w-10 opacity-30" />
              <p className="text-sm">{tAny("fust.noReadyOrders")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <div
                        className="flex items-center justify-center cursor-pointer"
                        onClick={toggleAll}
                      >
                        <Checkbox
                          checked={
                            selectedIds.size === readyOrders.length &&
                            readyOrders.length > 0
                          }
                          onCheckedChange={toggleAll}
                        />
                      </div>
                    </TableHead>
                    <TableHead>{tAny("fust.orderNumber")}</TableHead>
                    <TableHead>{tAny("fust.grower")}</TableHead>
                    <TableHead>{tAny("fust.delivered")}</TableHead>
                    <TableHead>{tAny("fust.items")}</TableHead>
                    <TableHead>{tAny("fust.linkedVouchers")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {readyOrders.map((order) => {
                    const isSelected = selectedIds.has(order.id);
                    const itemsSummary = order.items
                      .map((item) => `${item.quantity}x ${item.fustType.name}`)
                      .join(", ");
                    return (
                      <TableRow
                        key={order.id}
                        className={
                          isSelected ? "bg-primary/5" : "cursor-pointer"
                        }
                        onClick={() => toggleSelection(order.id)}
                      >
                        <TableCell>
                          <div
                            className="flex items-center justify-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() =>
                                toggleSelection(order.id)
                              }
                            />
                          </div>
                        </TableCell>
                        <TableCell className="font-mono font-medium">
                          {order.orderNumber}
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">
                            {order.grower.code}
                          </span>
                          <span className="ml-1.5 text-muted-foreground">
                            {order.grower.company || order.grower.name}
                          </span>
                        </TableCell>
                        <TableCell>
                          {order.deliveredAt
                            ? formatDate(order.deliveredAt)
                            : "\u2014"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {itemsSummary}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {order.voucherLinks?.map((link) => (
                              <Badge
                                key={link.id}
                                variant="outline"
                                className="gap-1"
                              >
                                <RiLink className="h-3 w-3" />
                                #{link.voucher.transactionNumber}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      {/* ─── Tab 2: Sent Invoices ────────────────────── */}
      {activeTab === "invoiced" && (
        <>
          {invoicesLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : !invoices || invoices.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <RiFileTextLine className="mx-auto mb-2 h-10 w-10 opacity-30" />
              <p className="text-sm">{tAny("fust.noInvoices")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tAny("fust.invoiceNumber")}</TableHead>
                    <TableHead>{tAny("fust.date")}</TableHead>
                    <TableHead>{tAny("fust.grower")}</TableHead>
                    <TableHead className="text-right">
                      {tAny("fust.amount")}
                    </TableHead>
                    <TableHead>{tAny("fust.status")}</TableHead>
                    <TableHead>{tAny("common.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-mono font-medium">
                        {invoice.invoiceNumber}
                      </TableCell>
                      <TableCell>
                        {formatDate(invoice.invoiceDate)}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">
                          {invoice.grower.code}
                        </span>
                        <span className="ml-1.5 text-muted-foreground">
                          {invoice.grower.company || invoice.grower.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrencyDetailed(Number(invoice.totalInclVat))}
                      </TableCell>
                      <TableCell>
                        <InvoiceStatusBadge status={invoice.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {invoice.pdfUrl && (
                            <a
                              href={invoice.pdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="PDF"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                            >
                              <RiDownloadLine className="h-4 w-4" />
                            </a>
                          )}
                          {invoice.xmlUrl && (
                            <a
                              href={invoice.xmlUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="XML"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                            >
                              <RiFileTextLine className="h-4 w-4" />
                            </a>
                          )}
                          {invoice.status === "draft" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950"
                              onClick={() => handleSendInvoice(invoice)}
                              disabled={actionLoading === invoice.id}
                              title={tAny("fust.send")}
                            >
                              <RiSendPlaneLine className="h-4 w-4" />
                            </Button>
                          )}
                          {invoice.status === "sent" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-green-600 hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-950"
                              onClick={() => handleMarkPaid(invoice)}
                              disabled={actionLoading === invoice.id}
                              title={tAny("fust.markAsPaid")}
                            >
                              <RiCheckLine className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      {/* ─── Generate Invoice Dialog ─────────────────── */}
      <Dialog
        open={showGenerateDialog}
        onOpenChange={(open) => !open && setShowGenerateDialog(false)}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tAny("fust.generateInvoice")}</DialogTitle>
            <DialogDescription>
              {selectedOrders.length > 0 && (
                <>
                  {selectedOrders[0].grower.code} &mdash;{" "}
                  {selectedOrders[0].grower.company ||
                    selectedOrders[0].grower.name}{" "}
                  ({selectedOrders.length}{" "}
                  {selectedOrders.length === 1 ? "order" : "orders"})
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Preview table */}
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tAny("fust.articleCode")}</TableHead>
                  <TableHead>{tAny("fust.description")}</TableHead>
                  <TableHead className="text-right">
                    {tAny("fust.qty")}
                  </TableHead>
                  <TableHead className="text-right">
                    {tAny("fust.unitPrice")}
                  </TableHead>
                  <TableHead className="text-right">
                    {tAny("fust.total")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewLines.map((line, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-sm">
                      {line.articleCode}
                    </TableCell>
                    <TableCell>{line.description}</TableCell>
                    <TableCell className="text-right">{line.quantity}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrencyDetailed(line.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrencyDetailed(line.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {tAny("fust.subtotal")}
                </span>
                <span>{formatCurrencyDetailed(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {tAny("fust.vat")} (21%)
                </span>
                <span>{formatCurrencyDetailed(vatAmount)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-medium">
                <span>{tAny("fust.totalInclVat")}</span>
                <span>{formatCurrencyDetailed(totalInclVat)}</span>
              </div>
            </div>
          </div>

          {/* Invoice date + notes */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="invoice-date">{tAny("fust.invoiceDate")}</Label>
              <Input
                id="invoice-date"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-notes">{tAny("fust.notes")}</Label>
              <textarea
                id="invoice-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                placeholder={tAny("fust.notesPlaceholder")}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowGenerateDialog(false)}
            >
              {tAny("fust.cancel")}
            </Button>
            <Button
              variant="outline"
              onClick={handlePreview}
              disabled={previewing || generating}
            >
              <RiEyeLine className="mr-1.5 h-4 w-4" />
              {previewing
                ? tAny("fust.loadingPreview")
                : tAny("fust.previewPdf")}
            </Button>
            <Button onClick={handleGenerate} disabled={generating || previewing}>
              {generating
                ? tAny("fust.generating")
                : tAny("fust.generate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────

function InvoiceStatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const tAny = t as unknown as (key: string) => string;

  switch (status) {
    case "draft":
      return <Badge variant="outline">{tAny("fust.draft")}</Badge>;
    case "sent":
      return <Badge variant="default">{tAny("fust.sent")}</Badge>;
    case "paid":
      return (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900 dark:text-green-200">
          {tAny("fust.paid")}
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
