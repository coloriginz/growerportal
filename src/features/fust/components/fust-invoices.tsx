"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { formatCurrencyDetailed, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  RiUploadLine,
  RiFileTextLine,
  RiEyeLine,
  RiMoneyEuroCircleLine,
  RiExternalLinkLine,
} from "@remixicon/react";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────

interface FustTypeRef {
  id: string;
  code: string;
  name: string;
  category?: string;
}

interface InvoiceItem {
  id: string;
  fustTypeId: string;
  fustType: FustTypeRef;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
}

interface SupplierRef {
  id: string;
  code: string;
  name: string;
  company: string | null;
}

interface SupplierCharge {
  id: string;
  supplierId: string;
  supplier: SupplierRef;
  amount: string;
  description: string | null;
  status: string;
  createdAt: string;
}

interface FustInvoice {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalAmount: string;
  status: string;
  pdfUrl: string | null;
  notes: string | null;
  createdAt: string;
  items: InvoiceItem[];
  charges: SupplierCharge[];
}

interface SupplierOption {
  id: string;
  code: string;
  name: string;
  company: string | null;
}

// ─── Status Badge ───────────────────────────────────────

function InvoiceStatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const statusMap: Record<
    string,
    { variant: "default" | "secondary" | "destructive" | "outline"; key: string }
  > = {
    pending: { variant: "outline", key: "fust.pending" },
    matched: { variant: "secondary", key: "fust.matched" },
    charged: { variant: "default", key: "fust.charged" },
    paid: { variant: "default", key: "fust.paid" },
  };
  const config = statusMap[status] || { variant: "outline" as const, key: status };
  return (
    <Badge variant={config.variant}>
      {t(config.key as Parameters<typeof t>[0])}
    </Badge>
  );
}

function ChargeStatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const statusMap: Record<
    string,
    { variant: "default" | "secondary" | "destructive" | "outline"; key: string }
  > = {
    pending: { variant: "outline", key: "fust.pending" },
    invoiced: { variant: "secondary", key: "fust.invoiced" },
    paid: { variant: "default", key: "fust.paid" },
  };
  const config = statusMap[status] || { variant: "outline" as const, key: status };
  return (
    <Badge variant={config.variant}>
      {t(config.key as Parameters<typeof t>[0])}
    </Badge>
  );
}

// ─── Main Component ─────────────────────────────────────

export function FustInvoices() {
  const { t } = useLanguage();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [detailInvoice, setDetailInvoice] = useState<FustInvoice | null>(null);
  const [chargeDialogInvoice, setChargeDialogInvoice] = useState<FustInvoice | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
    return `/api/fust/invoices?${params.toString()}`;
  }, [statusFilter]);

  const { data: invoices, loading, refetch } = useFetch<FustInvoice[]>(url);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/fust/invoices", {
          method: "POST",
          body: formData,
        });

        if (res.ok) {
          toast.success(t("fust.invoiceUploaded" as Parameters<typeof t>[0]));
          setUploadDialogOpen(false);
          refetch();
        } else {
          const err = await res.json();
          toast.error(err.error || "Failed to upload invoice");
        }
      } catch {
        toast.error("Failed to upload invoice");
      } finally {
        setUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [t, refetch]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(file);
    },
    [handleUpload]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {t("fust.invoices" as Parameters<typeof t>[0])}
        </h1>
        <div className="flex items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v ?? "all")}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("fust.filterByStatus" as Parameters<typeof t>[0])} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.all")}</SelectItem>
              <SelectItem value="pending">{t("fust.pending" as Parameters<typeof t>[0])}</SelectItem>
              <SelectItem value="matched">{t("fust.matched" as Parameters<typeof t>[0])}</SelectItem>
              <SelectItem value="charged">{t("fust.charged" as Parameters<typeof t>[0])}</SelectItem>
              <SelectItem value="paid">{t("fust.paid" as Parameters<typeof t>[0])}</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setUploadDialogOpen(true)}>
            <RiUploadLine className="mr-2 h-4 w-4" />
            {t("fust.uploadInvoicePdf" as Parameters<typeof t>[0])}
          </Button>
        </div>
      </div>

      {/* Invoice Table */}
      {loading ? (
        <Skeleton className="h-48" />
      ) : !invoices || invoices.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <RiFileTextLine className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p>{t("fust.noInvoices" as Parameters<typeof t>[0])}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fust.invoiceNumber" as Parameters<typeof t>[0])}</TableHead>
                <TableHead>{t("fust.invoiceDate" as Parameters<typeof t>[0])}</TableHead>
                <TableHead className="text-right">
                  {t("fust.totalAmount" as Parameters<typeof t>[0])}
                </TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="text-center">{t("fust.items" as Parameters<typeof t>[0])}</TableHead>
                <TableHead className="text-center">{t("fust.charges" as Parameters<typeof t>[0])}</TableHead>
                <TableHead>{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-medium">
                    {invoice.invoiceNumber || "-"}
                  </TableCell>
                  <TableCell>
                    {invoice.invoiceDate
                      ? formatDate(invoice.invoiceDate)
                      : "-"}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrencyDetailed(Number(invoice.totalAmount))}
                  </TableCell>
                  <TableCell>
                    <InvoiceStatusBadge status={invoice.status} />
                  </TableCell>
                  <TableCell className="text-center">
                    {invoice.items.length}
                  </TableCell>
                  <TableCell className="text-center">
                    {invoice.charges.length}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setDetailInvoice(invoice)}
                        title={t("common.view")}
                      >
                        <RiEyeLine className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setChargeDialogInvoice(invoice)}
                        title={t("fust.createCharges" as Parameters<typeof t>[0])}
                      >
                        <RiMoneyEuroCircleLine className="h-4 w-4" />
                      </Button>
                      {invoice.pdfUrl && (
                        <a
                          href={invoice.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="PDF"
                          >
                            <RiExternalLinkLine className="h-4 w-4" />
                          </Button>
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Upload Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("fust.uploadInvoicePdf" as Parameters<typeof t>[0])}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <label
              htmlFor="invoice-pdf-upload"
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 transition-colors hover:border-muted-foreground/50"
            >
              <RiUploadLine className="mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">
                {t("fust.selectPdf" as Parameters<typeof t>[0])}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("fust.dragDropPdf" as Parameters<typeof t>[0])}
              </p>
              <input
                id="invoice-pdf-upload"
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={handleFileChange}
                disabled={uploading}
              />
            </label>
            {uploading && (
              <p className="mt-3 text-center text-sm text-muted-foreground">
                {t("fust.parsingInvoice" as Parameters<typeof t>[0])}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUploadDialogOpen(false)}
              disabled={uploading}
            >
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      {detailInvoice && (
        <InvoiceDetailDialog
          invoice={detailInvoice}
          onClose={() => setDetailInvoice(null)}
        />
      )}

      {/* Charge Assignment Dialog */}
      {chargeDialogInvoice && (
        <ChargeAssignmentDialog
          invoice={chargeDialogInvoice}
          onClose={() => setChargeDialogInvoice(null)}
          onCreated={() => {
            setChargeDialogInvoice(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

// ─── Invoice Detail Dialog ──────────────────────────────

function InvoiceDetailDialog({
  invoice,
  onClose,
}: {
  invoice: FustInvoice;
  onClose: () => void;
}) {
  const { t } = useLanguage();

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("fust.invoice" as Parameters<typeof t>[0])} {invoice.invoiceNumber || "-"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          {/* Invoice info */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">
                {t("fust.invoiceNumber" as Parameters<typeof t>[0])}:
              </span>{" "}
              <span className="font-medium">{invoice.invoiceNumber || "-"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">
                {t("fust.invoiceDate" as Parameters<typeof t>[0])}:
              </span>{" "}
              <span className="font-medium">
                {invoice.invoiceDate ? formatDate(invoice.invoiceDate) : "-"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">
                {t("fust.totalAmount" as Parameters<typeof t>[0])}:
              </span>{" "}
              <span className="font-medium">
                {formatCurrencyDetailed(Number(invoice.totalAmount))}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">{t("common.status")}:</span>{" "}
              <InvoiceStatusBadge status={invoice.status} />
            </div>
          </div>

          {/* Items */}
          {invoice.items.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">
                {t("fust.parsedItems" as Parameters<typeof t>[0])}
              </h3>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("fust.fustType" as Parameters<typeof t>[0])}</TableHead>
                      <TableHead className="text-right">
                        {t("fust.quantity" as Parameters<typeof t>[0])}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("fust.price" as Parameters<typeof t>[0])}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("fust.total" as Parameters<typeof t>[0])}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div>
                            <span className="font-medium">{item.fustType.name}</span>
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {item.fustType.code}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrencyDetailed(Number(item.unitPrice))}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrencyDetailed(Number(item.totalPrice))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Charges */}
          {invoice.charges.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">
                {t("fust.supplierCharges" as Parameters<typeof t>[0])}
              </h3>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("fust.supplier" as Parameters<typeof t>[0])}</TableHead>
                      <TableHead className="text-right">
                        {t("fust.amount" as Parameters<typeof t>[0])}
                      </TableHead>
                      <TableHead>{t("common.description")}</TableHead>
                      <TableHead>{t("fust.chargeStatus" as Parameters<typeof t>[0])}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.charges.map((charge) => (
                      <TableRow key={charge.id}>
                        <TableCell>
                          <div>
                            <span className="font-medium">{charge.supplier.code}</span>
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {charge.supplier.company || charge.supplier.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrencyDetailed(Number(charge.amount))}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {charge.description || "-"}
                        </TableCell>
                        <TableCell>
                          <ChargeStatusBadge status={charge.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {invoice.notes && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">
                {t("fust.notes" as Parameters<typeof t>[0])}
              </h3>
              <p className="text-sm text-muted-foreground">{invoice.notes}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.back")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Charge Assignment Dialog ───────────────────────────

interface ChargeRow {
  supplierId: string;
  amount: string;
  description: string;
}

function ChargeAssignmentDialog({
  invoice,
  onClose,
  onCreated,
}: {
  invoice: FustInvoice;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useLanguage();
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Fetch suppliers with fust enabled for the dropdown
  const { data: suppliers } = useFetch<SupplierOption[]>("/api/suppliers");

  const addChargeRow = useCallback(() => {
    setCharges((prev) => [...prev, { supplierId: "", amount: "", description: "" }]);
  }, []);

  const removeChargeRow = useCallback((index: number) => {
    setCharges((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateChargeRow = useCallback(
    (index: number, field: keyof ChargeRow, value: string) => {
      setCharges((prev) =>
        prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
      );
    },
    []
  );

  const autoDistribute = useCallback(() => {
    if (!suppliers || suppliers.length === 0) return;
    const totalAmount = Number(invoice.totalAmount);
    const perSupplier = totalAmount / suppliers.length;
    setCharges(
      suppliers.map((g) => ({
        supplierId: g.id,
        amount: perSupplier.toFixed(2),
        description: "",
      }))
    );
  }, [suppliers, invoice.totalAmount]);

  const totalCharged = useMemo(
    () => charges.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0),
    [charges]
  );

  const isValid = useMemo(
    () =>
      charges.length > 0 &&
      charges.every((c) => c.supplierId && parseFloat(c.amount) > 0),
    [charges]
  );

  const handleSubmit = async () => {
    if (!isValid) return;
    setSubmitting(true);
    try {
      const body = {
        charges: charges.map((c) => ({
          supplierId: c.supplierId,
          amount: parseFloat(c.amount),
          description: c.description || null,
        })),
      };

      const res = await fetch(`/api/fust/invoices/${invoice.id}/charges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast.success(t("fust.chargesAssigned" as Parameters<typeof t>[0]));
        onCreated();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to create charges");
      }
    } catch {
      toast.error("Failed to create charges");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t("fust.chargeDistribution" as Parameters<typeof t>[0])} -{" "}
            {invoice.invoiceNumber || "-"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Invoice summary */}
          <div className="flex items-center justify-between rounded-lg bg-muted p-3 text-sm">
            <span>
              {t("fust.totalAmount" as Parameters<typeof t>[0])}:{" "}
              <strong>{formatCurrencyDetailed(Number(invoice.totalAmount))}</strong>
            </span>
            <span>
              {t("fust.charged" as Parameters<typeof t>[0])}:{" "}
              <strong>{formatCurrencyDetailed(totalCharged)}</strong>
              {totalCharged > 0 && totalCharged !== Number(invoice.totalAmount) && (
                <span className="ml-2 text-xs text-muted-foreground">
                  ({formatCurrencyDetailed(Number(invoice.totalAmount) - totalCharged)}{" "}
                  remaining)
                </span>
              )}
            </span>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={addChargeRow}>
              + {t("fust.supplier" as Parameters<typeof t>[0])}
            </Button>
            <Button variant="outline" size="sm" onClick={autoDistribute}>
              {t("fust.autoDistribute" as Parameters<typeof t>[0])}
            </Button>
          </div>

          {/* Charge rows */}
          {charges.length > 0 && (
            <div className="space-y-3">
              {charges.map((charge, index) => (
                <div
                  key={index}
                  className="flex items-end gap-2 rounded-lg border p-3"
                >
                  <div className="flex-1">
                    <Label className="text-xs">
                      {t("fust.supplier" as Parameters<typeof t>[0])}
                    </Label>
                    <Select
                      value={charge.supplierId || undefined}
                      onValueChange={(v) =>
                        updateChargeRow(index, "supplierId", v ?? "")
                      }
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue
                          placeholder={t("fust.filterBySupplier" as Parameters<typeof t>[0])}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers?.map((g) => (
                          <SelectItem key={g.id} value={g.id}>
                            {g.code} - {g.company || g.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-32">
                    <Label className="text-xs">
                      {t("fust.amount" as Parameters<typeof t>[0])}
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={charge.amount}
                      onChange={(e) =>
                        updateChargeRow(index, "amount", e.target.value)
                      }
                      className="mt-1"
                      placeholder="0.00"
                    />
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs">{t("common.description")}</Label>
                    <Input
                      value={charge.description}
                      onChange={(e) =>
                        updateChargeRow(index, "description", e.target.value)
                      }
                      className="mt-1"
                      placeholder={t("common.description")}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeChargeRow(index)}
                  >
                    {t("common.delete")}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {charges.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t("fust.noInvoices" as Parameters<typeof t>[0])}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || submitting}>
            {submitting
              ? t("common.loading")
              : t("fust.createCharges" as Parameters<typeof t>[0])}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
