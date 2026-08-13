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
  RiSendPlaneLine,
  RiDownloadLine,
  RiCheckLine,
  RiEyeLine,
} from "@remixicon/react";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────

interface RfhInvoiceLine {
  id: string;
  fustCode: string;
  description: string;
  quantity: number;
  statiegeldPrice: string | null;
  statiegeldAmount: string | null;
  fusthuurPrice: string | null;
  fusthuurAmount: string | null;
  vatCode: string;
  voucherNumber: string;
}

interface Allocation {
  id: string;
  rfhInvoiceId: string;
  voucherNumber: string;
  supplierId: string | null;
  rfhInvoice: {
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    status: string;
    lines: RfhInvoiceLine[];
  };
  supplier: {
    id: string;
    code: string;
    name: string;
    company: string | null;
    companyEntity: { name: string } | null;
  } | null;
  voucher: {
    id: string;
    transactionNumber: string;
    notes: string | null;
  } | null;
}

interface SupplierGroup {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  companyName: string | null;
  allocations: Allocation[];
  rfhInvoiceIds: string[];
  voucherNumbers: string[];
}

interface SupplierInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplierId: string;
  supplier: { code: string; name: string; company: string | null };
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

function buildInvoiceLinesFromAllocations(allocations: Allocation[]): InvoiceLine[] {
  // Collect all voucher numbers from the allocations
  const allocatedVoucherNumbers = new Set(allocations.map((a) => a.voucherNumber));

  // Group by fustCode + lineType, sum amounts
  const grouped = new Map<string, { articleCode: string; description: string; quantity: number; totalPrice: number }>();

  for (const alloc of allocations) {
    for (const line of alloc.rfhInvoice.lines) {
      if (!allocatedVoucherNumbers.has(line.voucherNumber)) continue;

      const statiegeldAmount = Number(line.statiegeldAmount ?? 0);
      const fusthuurAmount = Number(line.fusthuurAmount ?? 0);

      // Statiegeld (deposit)
      if (statiegeldAmount !== 0) {
        const key = `${line.fustCode}-deposit`;
        const existing = grouped.get(key);
        if (existing) {
          existing.quantity += line.quantity;
          existing.totalPrice += statiegeldAmount;
        } else {
          grouped.set(key, {
            articleCode: "2907",
            description: `${line.description} - Statiegeld`,
            quantity: line.quantity,
            totalPrice: statiegeldAmount,
          });
        }
      }

      // Fusthuur (rental)
      if (fusthuurAmount !== 0) {
        const key = `${line.fustCode}-rental`;
        const existing = grouped.get(key);
        if (existing) {
          existing.quantity += line.quantity;
          existing.totalPrice += fusthuurAmount;
        } else {
          grouped.set(key, {
            articleCode: "2908",
            description: `${line.description} - Huur`,
            quantity: line.quantity,
            totalPrice: fusthuurAmount,
          });
        }
      }
    }
  }

  return Array.from(grouped.values()).map((item) => ({
    articleCode: item.articleCode,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.quantity !== 0 ? Math.round((item.totalPrice / item.quantity) * 100) / 100 : 0,
    total: Math.round(item.totalPrice * 100) / 100,
  }));
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
    data: allocations,
    loading: allocationsLoading,
    refetch: refetchAllocations,
  } = useFetch<Allocation[]>("/api/fust/grower-invoices?source=rfh");

  const {
    data: invoices,
    loading: invoicesLoading,
    refetch: refetchInvoices,
  } = useFetch<SupplierInvoice[]>("/api/fust/grower-invoices");

  // Selection state (by supplierId)
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<Set<string>>(new Set());

  // Dialog state
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [generating, setGenerating] = useState(false);

  // Action loading state
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Group allocations by supplier
  const supplierGroups = useMemo(() => {
    if (!allocations) return [];
    const groupMap = new Map<string, SupplierGroup>();
    for (const alloc of allocations) {
      if (!alloc.supplier) continue;
      const sid = alloc.supplier.id;
      let group = groupMap.get(sid);
      if (!group) {
        group = {
          supplierId: sid,
          supplierCode: alloc.supplier.code,
          supplierName: alloc.supplier.name,
          companyName: alloc.supplier.company ?? alloc.supplier.companyEntity?.name ?? null,
          allocations: [],
          rfhInvoiceIds: [],
          voucherNumbers: [],
        };
        groupMap.set(sid, group);
      }
      group.allocations.push(alloc);
      if (!group.rfhInvoiceIds.includes(alloc.rfhInvoiceId)) {
        group.rfhInvoiceIds.push(alloc.rfhInvoiceId);
      }
      if (!group.voucherNumbers.includes(alloc.voucherNumber)) {
        group.voucherNumbers.push(alloc.voucherNumber);
      }
    }
    return Array.from(groupMap.values());
  }, [allocations]);

  // Selected supplier group (only one at a time for invoice generation)
  const selectedGroup = useMemo(() => {
    if (selectedSupplierIds.size !== 1) return null;
    const sid = Array.from(selectedSupplierIds)[0];
    return supplierGroups.find((g) => g.supplierId === sid) ?? null;
  }, [selectedSupplierIds, supplierGroups]);

  const canGenerate = selectedSupplierIds.size === 1 && selectedGroup !== null;

  // Invoice preview lines
  const previewLines = useMemo(
    () => (selectedGroup ? buildInvoiceLinesFromAllocations(selectedGroup.allocations) : []),
    [selectedGroup]
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
      ready: supplierGroups.length,
      invoiced: invoices?.length ?? 0,
    }),
    [supplierGroups, invoices]
  );

  // ─── Selection handlers ───────────────────────────────

  const toggleSelection = (supplierId: string) => {
    setSelectedSupplierIds((prev) => {
      const next = new Set(prev);
      if (next.has(supplierId)) {
        next.delete(supplierId);
      } else {
        next.add(supplierId);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedSupplierIds.size === supplierGroups.length) {
      setSelectedSupplierIds(new Set());
    } else {
      setSelectedSupplierIds(new Set(supplierGroups.map((g) => g.supplierId)));
    }
  };

  // ─── Generate invoice ─────────────────────────────────

  const openGenerateDialog = () => {
    setInvoiceDate(todayISO());
    setNotes("");
    setShowGenerateDialog(true);
  };

  const handleGenerate = async () => {
    if (!canGenerate || !selectedGroup) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/fust/grower-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: selectedGroup.supplierId,
          rfhInvoiceIds: selectedGroup.rfhInvoiceIds,
          invoiceDate,
          notes: notes.trim() || undefined,
        }),
      });
      if (res.ok) {
        toast.success(tAny("fust.invoiceGenerated"));
        setShowGenerateDialog(false);
        setSelectedSupplierIds(new Set());
        refetchAllocations();
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
    if (!canGenerate || !selectedGroup) return;
    setPreviewing(true);
    try {
      const res = await fetch("/api/fust/grower-invoices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: selectedGroup.supplierId,
          rfhInvoiceIds: selectedGroup.rfhInvoiceIds,
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

  const handleSendInvoice = async (invoice: SupplierInvoice) => {
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

  const handleMarkPaid = async (invoice: SupplierInvoice) => {
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
            {selectedSupplierIds.size > 1 && (
              <p className="text-sm text-destructive">
                {tAny("fust.selectSameSupplierWarning")}
              </p>
            )}
          </div>

          {allocationsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : supplierGroups.length === 0 ? (
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
                            selectedSupplierIds.size === supplierGroups.length &&
                            supplierGroups.length > 0
                          }
                          onCheckedChange={toggleAll}
                        />
                      </div>
                    </TableHead>
                    <TableHead>{tAny("fust.supplier")}</TableHead>
                    <TableHead>{tAny("fust.rfhInvoices")}</TableHead>
                    <TableHead>{tAny("fust.vouchers")}</TableHead>
                    <TableHead>{tAny("fust.rfh.voucherNotes")}</TableHead>
                    <TableHead className="text-right">{tAny("fust.allocations")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supplierGroups.map((group) => {
                    const isSelected = selectedSupplierIds.has(group.supplierId);
                    return (
                      <TableRow
                        key={group.supplierId}
                        className={
                          isSelected ? "bg-primary/5" : "cursor-pointer"
                        }
                        onClick={() => toggleSelection(group.supplierId)}
                      >
                        <TableCell>
                          <div
                            className="flex items-center justify-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() =>
                                toggleSelection(group.supplierId)
                              }
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">
                            {group.supplierCode}
                          </span>
                          <span className="ml-1.5 text-muted-foreground">
                            {group.companyName || group.supplierName}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {group.rfhInvoiceIds.map((invId) => {
                              const inv = group.allocations.find(
                                (a) => a.rfhInvoiceId === invId
                              )?.rfhInvoice;
                              return (
                                <Badge
                                  key={invId}
                                  variant="outline"
                                  className="text-xs"
                                >
                                  {inv?.invoiceNumber ?? invId.slice(0, 8)}
                                </Badge>
                              );
                            })}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {group.voucherNumbers.join(", ")}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-xs">
                          {(() => {
                            const notes = group.allocations
                              .map((a) => a.voucher?.notes)
                              .filter(Boolean);
                            const unique = [...new Set(notes)];
                            return unique.length > 0
                              ? unique.map((note, i) => (
                                  <p key={i} className="whitespace-pre-line">{note}</p>
                                ))
                              : "-";
                          })()}
                        </TableCell>
                        <TableCell className="text-right">
                          {group.allocations.length}
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
                    <TableHead>{tAny("fust.supplier")}</TableHead>
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
                          {invoice.supplier.code}
                        </span>
                        <span className="ml-1.5 text-muted-foreground">
                          {invoice.supplier.company || invoice.supplier.name}
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
              {selectedGroup && (
                <>
                  {selectedGroup.supplierCode} &mdash;{" "}
                  {selectedGroup.companyName || selectedGroup.supplierName}{" "}
                  ({selectedGroup.allocations.length}{" "}
                  {selectedGroup.allocations.length === 1
                    ? "allocation"
                    : "allocations"}
                  , {selectedGroup.rfhInvoiceIds.length}{" "}
                  {selectedGroup.rfhInvoiceIds.length === 1
                    ? "RFH invoice"
                    : "RFH invoices"})
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
