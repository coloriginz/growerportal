"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { formatCurrencyDetailed, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  RiArrowLeftLine,
  RiDeleteBinLine,
  RiExternalLinkLine,
  RiFilePdfLine,
  RiLoader4Line,
  RiCheckLine,
  RiCloseLine,
} from "@remixicon/react";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────

interface RfhInvoiceData {
  id: string;
  invoiceNumber: string;
  rfhInvoiceNumber: string;
  invoiceDate: string;
  totalStatiegeld: string;
  totalFusthuur: string;
  status: string;
  pdfUrl: string | null;
  company: { id: string; name: string; slug: string } | null;
  lines: Array<{
    id: string;
    date: string;
    fustCode: string;
    description: string;
    transactionType: string;
    location: string;
    voucherNumber: string;
    quantity: number;
    statiegeldPrice: string | null;
    statiegeldAmount: string | null;
    fusthuurPrice: string | null;
    fusthuurAmount: string | null;
    vatCode: string;
  }>;
  allocations: Array<{
    id: string;
    voucherNumber: string;
    voucherId: string | null;
    supplierId: string | null;
    allocatedAt: string | null;
    voucher: {
      id: string;
      transactionNumber: string;
      notes: string | null;
      transporterName: string | null;
      customerName: string | null;
      pdfUrl: string | null;
    } | null;
    supplier: { id: string; code: string; name: string } | null;
    allocatedBy: { id: string; name: string } | null;
  }>;
}

interface SupplierOption {
  id: string;
  code: string;
  name: string;
  fustEnabled: boolean;
}

interface VoucherGroup {
  voucherNumber: string;
  lines: RfhInvoiceData["lines"];
  allocation: RfhInvoiceData["allocations"][0] | null;
}

// ─── Voucher Card ───────────────────────────────────────

function VoucherCard({
  group,
  invoiceId,
  invoiceStatus,
  suppliers,
  onAllocate,
  onDeallocate,
}: {
  group: VoucherGroup;
  invoiceId: string;
  invoiceStatus: string;
  suppliers: SupplierOption[];
  onAllocate: (voucherNumber: string, supplierId: string) => Promise<void>;
  onDeallocate: (voucherNumber: string) => Promise<void>;
}) {
  const { t } = useLanguage();
  const tAny = t as (key: string) => string;
  const [selectedSupplier, setSelectedSupplier] = useState<string>("");
  const [allocating, setAllocating] = useState(false);
  const [deallocating, setDeallocating] = useState(false);

  const isAllocated = group.allocation?.supplierId !== null && group.allocation?.supplierId !== undefined;
  const isInvoiced = invoiceStatus === "invoiced";

  // Calculate totals for this voucher
  const totals = useMemo(() => {
    let statiegeld = 0;
    let fusthuur = 0;
    for (const line of group.lines) {
      statiegeld += Number(line.statiegeldAmount || 0);
      fusthuur += Number(line.fusthuurAmount || 0);
    }
    return { statiegeld, fusthuur };
  }, [group.lines]);

  const handleAllocate = async () => {
    if (!selectedSupplier) return;
    setAllocating(true);
    try {
      await onAllocate(group.voucherNumber, selectedSupplier);
      setSelectedSupplier("");
    } finally {
      setAllocating(false);
    }
  };

  const handleDeallocate = async () => {
    setDeallocating(true);
    try {
      await onDeallocate(group.voucherNumber);
    } finally {
      setDeallocating(false);
    }
  };

  return (
    <Card
      className={
        isAllocated
          ? "border-green-500/50 bg-green-50/30 dark:bg-green-950/10"
          : undefined
      }
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            Bon {group.voucherNumber}
          </CardTitle>
          {isAllocated && group.allocation?.supplier ? (
            <Badge variant="default" className="bg-green-600">
              <RiCheckLine className="mr-1 h-3 w-3" />
              {group.allocation.supplier.code} — {group.allocation.supplier.name}
            </Badge>
          ) : (
            <Badge variant="secondary">
              {tAny("fust.rfh.unallocated")}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Voucher hints */}
        {group.allocation?.voucher ? (
          <div className="space-y-1 text-sm text-muted-foreground">
            {group.allocation.voucher.notes && (
              <p>
                <span className="font-medium">{tAny("fust.rfh.voucherNotes")}:</span>{" "}
                {group.allocation.voucher.notes}
              </p>
            )}
            {group.allocation.voucher.transporterName && (
              <p>
                <span className="font-medium">{tAny("fust.rfh.transporter")}:</span>{" "}
                {group.allocation.voucher.transporterName}
              </p>
            )}
            {group.allocation.voucher.customerName && (
              <p>
                <span className="font-medium">{tAny("fust.rfh.customer")}:</span>{" "}
                {group.allocation.voucher.customerName}
              </p>
            )}
            {group.allocation.voucher.pdfUrl && (
              <a
                href={group.allocation.voucher.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <RiFilePdfLine className="h-3.5 w-3.5" />
                {tAny("fust.rfh.viewVoucherPdf")}
                <RiExternalLinkLine className="h-3 w-3" />
              </a>
            )}
          </div>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            {tAny("fust.rfh.voucherNotFound")}
          </p>
        )}

        {/* Fust lines table */}
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>{tAny("fust.rfh.fustLines")}</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">
                  {tAny("fust.rfh.statiegeld")}
                </TableHead>
                <TableHead className="text-right">
                  {tAny("fust.rfh.fusthuur")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="font-mono text-xs">
                    {line.fustCode}
                  </TableCell>
                  <TableCell>{line.description}</TableCell>
                  <TableCell className="text-right">{line.quantity}</TableCell>
                  <TableCell className="text-right">
                    {line.statiegeldAmount
                      ? formatCurrencyDetailed(Number(line.statiegeldAmount))
                      : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    {line.fusthuurAmount
                      ? formatCurrencyDetailed(Number(line.fusthuurAmount))
                      : "-"}
                  </TableCell>
                </TableRow>
              ))}
              {/* Total row */}
              <TableRow className="font-medium border-t-2">
                <TableCell colSpan={3} className="text-right">
                  {tAny("fust.rfh.total")}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrencyDetailed(totals.statiegeld)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrencyDetailed(totals.fusthuur)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Allocation controls */}
        {!isInvoiced && (
          <div className="flex items-center gap-3 pt-2">
            {!isAllocated ? (
              <>
                <Select
                  value={selectedSupplier}
                  onValueChange={(v) => setSelectedSupplier(v ?? "")}
                >
                  <SelectTrigger className="w-[280px]">
                    <SelectValue
                      placeholder={tAny("fust.rfh.selectGrower")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.code} — {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={handleAllocate}
                  disabled={!selectedSupplier || allocating}
                >
                  {allocating ? (
                    <RiLoader4Line className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <RiCheckLine className="mr-1 h-4 w-4" />
                  )}
                  {tAny("fust.rfh.allocateToGrower")}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={handleDeallocate}
                disabled={deallocating}
              >
                {deallocating ? (
                  <RiLoader4Line className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <RiCloseLine className="mr-1 h-4 w-4" />
                )}
                {tAny("fust.rfh.deallocate")}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Component ─────────────────────────────────────

export function RfhInvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const { t } = useLanguage();
  const tAny = t as (key: string) => string;
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const { data: invoice, loading, refetch } = useFetch<RfhInvoiceData>(
    `/api/fust/rfh-invoices/${invoiceId}`
  );
  const { data: allSuppliers } = useFetch<SupplierOption[]>("/api/suppliers");

  // Filter to fust-enabled suppliers only
  const suppliers = useMemo(
    () => (allSuppliers || []).filter((s) => s.fustEnabled),
    [allSuppliers]
  );

  // Group lines by voucherNumber
  const voucherGroups = useMemo<VoucherGroup[]>(() => {
    if (!invoice) return [];

    const groupMap = new Map<string, RfhInvoiceData["lines"]>();
    for (const line of invoice.lines) {
      const existing = groupMap.get(line.voucherNumber);
      if (existing) {
        existing.push(line);
      } else {
        groupMap.set(line.voucherNumber, [line]);
      }
    }

    return Array.from(groupMap.entries()).map(([voucherNumber, lines]) => ({
      voucherNumber,
      lines,
      allocation:
        invoice.allocations.find((a) => a.voucherNumber === voucherNumber) ||
        null,
    }));
  }, [invoice]);

  const handleAllocate = useCallback(
    async (voucherNumber: string, supplierId: string) => {
      const res = await fetch(
        `/api/fust/rfh-invoices/${invoiceId}/allocate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voucherNumber, supplierId }),
        }
      );

      if (res.ok) {
        toast.success(tAny("fust.rfh.allocationSaved"));
        refetch();
      } else {
        const err = await res.json();
        toast.error(err.error || "Allocation failed");
      }
    },
    [invoiceId, tAny, refetch]
  );

  const handleDeallocate = useCallback(
    async (voucherNumber: string) => {
      const res = await fetch(
        `/api/fust/rfh-invoices/${invoiceId}/allocate`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voucherNumber }),
        }
      );

      if (res.ok) {
        toast.success(tAny("fust.rfh.allocationRemoved"));
        refetch();
      } else {
        const err = await res.json();
        toast.error(err.error || "Deallocation failed");
      }
    },
    [invoiceId, tAny, refetch]
  );

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/fust/rfh-invoices/${invoiceId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        toast.success(tAny("fust.rfh.deleted"));
        router.back();
      } else {
        const err = await res.json();
        toast.error(err.error || "Delete failed");
      }
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }, [invoiceId, tAny, router]);

  // Grand total
  const grandTotal = invoice
    ? Number(invoice.totalStatiegeld) + Number(invoice.totalFusthuur)
    : 0;

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <p>Invoice not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Header ───────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.back()}
            className="mt-1"
          >
            <RiArrowLeftLine className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Invoice {invoice.rfhInvoiceNumber || invoice.invoiceNumber}
            </h1>
            <p className="text-sm text-muted-foreground">
              {invoice.rfhInvoiceNumber && (
                <span className="mr-3">{invoice.invoiceNumber}</span>
              )}
              {formatDate(invoice.invoiceDate)}
              {invoice.company && (
                <span className="ml-3">{invoice.company.name}</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {invoice.pdfUrl && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(invoice.pdfUrl!, "_blank")}
            >
              <RiFilePdfLine className="mr-1 h-4 w-4" />
              {tAny("fust.rfh.viewPdf")}
            </Button>
          )}
          <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <DialogTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10"
                  disabled={invoice.status === "invoiced"}
                />
              }
            >
              <RiDeleteBinLine className="mr-1 h-4 w-4" />
              Delete
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{tAny("fust.rfh.deleteConfirm")}</DialogTitle>
                <DialogDescription>
                  This will permanently delete invoice{" "}
                  {invoice.rfhInvoiceNumber || invoice.invoiceNumber} and all
                  its allocations.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDeleteDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting && (
                    <RiLoader4Line className="mr-1 h-4 w-4 animate-spin" />
                  )}
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ─── Summary Cards ────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card size="sm">
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {tAny("fust.rfh.statiegeld")}
            </p>
            <p className="text-xl font-bold">
              {formatCurrencyDetailed(Number(invoice.totalStatiegeld))}
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {tAny("fust.rfh.fusthuur")}
            </p>
            <p className="text-xl font-bold">
              {formatCurrencyDetailed(Number(invoice.totalFusthuur))}
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {tAny("fust.rfh.total")}
            </p>
            <p className="text-xl font-bold">
              {formatCurrencyDetailed(grandTotal)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ─── Voucher Cards ────────────────────────────────── */}
      <div className="space-y-4">
        {voucherGroups.map((group) => (
          <VoucherCard
            key={group.voucherNumber}
            group={group}
            invoiceId={invoiceId}
            invoiceStatus={invoice.status}
            suppliers={suppliers}
            onAllocate={handleAllocate}
            onDeallocate={handleDeallocate}
          />
        ))}
      </div>
    </div>
  );
}
