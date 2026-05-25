"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { formatCurrencyDetailed, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { RiUploadLine, RiFileTextLine } from "@remixicon/react";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────

interface RfhInvoiceListItem {
  id: string;
  invoiceNumber: string;
  rfhInvoiceNumber: string;
  invoiceDate: string;
  totalStatiegeld: string;
  totalFusthuur: string;
  status: string;
  pdfUrl: string | null;
  company: { id: string; name: string; slug: string } | null;
  voucherCount: number;
  allocatedCount: number;
}

interface Company {
  id: string;
  name: string;
}

// ─── Status Badge ───────────────────────────────────────

function RfhStatusBadge({
  status,
  allocatedCount,
  voucherCount,
}: {
  status: string;
  allocatedCount: number;
  voucherCount: number;
}) {
  const { t } = useLanguage();
  const variantMap: Record<string, "destructive" | "secondary" | "default" | "outline"> = {
    open: "destructive",
    partial: "secondary",
    complete: "default",
    invoiced: "outline",
  };
  const labelMap: Record<string, string> = {
    open: "fust.rfh.statusOpen",
    partial: "fust.rfh.statusPartial",
    complete: "fust.rfh.statusComplete",
    invoiced: "fust.rfh.statusInvoiced",
  };

  const variant = variantMap[status] || "outline";
  const label = labelMap[status];

  return (
    <Badge variant={variant}>
      {label ? t(label as Parameters<typeof t>[0]) : status}{" "}
      {voucherCount > 0 && `${allocatedCount}/${voucherCount}`}
    </Badge>
  );
}

// ─── Main Component ─────────────────────────────────────

export function RfhInvoices() {
  const { t } = useLanguage();
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
    if (companyFilter && companyFilter !== "all") params.set("companyId", companyFilter);
    return `/api/fust/rfh-invoices?${params.toString()}`;
  }, [statusFilter, companyFilter]);

  const { data: invoices, loading, refetch } = useFetch<RfhInvoiceListItem[]>(url);
  const { data: companies } = useFetch<Company[]>("/api/companies");

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/fust/rfh-invoices", {
          method: "POST",
          body: formData,
        });

        if (res.ok) {
          toast.success(t("fust.rfh.importSuccess" as Parameters<typeof t>[0]));
          refetch();
        } else if (res.status === 409) {
          toast.error(t("fust.rfh.duplicateInvoice" as Parameters<typeof t>[0]));
        } else {
          const err = await res.json();
          toast.error(err.error || t("fust.rfh.importError" as Parameters<typeof t>[0]));
        }
      } catch {
        toast.error(t("fust.rfh.importError" as Parameters<typeof t>[0]));
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

  const totalForInvoice = (invoice: RfhInvoiceListItem) =>
    Number(invoice.totalStatiegeld) + Number(invoice.totalFusthuur);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {t("fust.rfh.title" as Parameters<typeof t>[0])}
        </h1>
        <div>
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <RiUploadLine className="mr-2 h-4 w-4" />
            {t("fust.rfh.uploadInvoice" as Parameters<typeof t>[0])}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={handleFileChange}
            disabled={uploading}
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("fust.rfh.filterStatus" as Parameters<typeof t>[0])} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("fust.rfh.allStatuses" as Parameters<typeof t>[0])}
            </SelectItem>
            <SelectItem value="open">
              {t("fust.rfh.statusOpen" as Parameters<typeof t>[0])}
            </SelectItem>
            <SelectItem value="partial">
              {t("fust.rfh.statusPartial" as Parameters<typeof t>[0])}
            </SelectItem>
            <SelectItem value="complete">
              {t("fust.rfh.statusComplete" as Parameters<typeof t>[0])}
            </SelectItem>
            <SelectItem value="invoiced">
              {t("fust.rfh.statusInvoiced" as Parameters<typeof t>[0])}
            </SelectItem>
          </SelectContent>
        </Select>

        <Select value={companyFilter} onValueChange={(v) => setCompanyFilter(v ?? "all")}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("fust.rfh.filterCompany" as Parameters<typeof t>[0])} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("fust.rfh.allCompanies" as Parameters<typeof t>[0])}
            </SelectItem>
            {companies?.map((company) => (
              <SelectItem key={company.id} value={company.id}>
                {company.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {loading ? (
        <Skeleton className="h-48" />
      ) : !invoices || invoices.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <RiFileTextLine className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p>{t("fust.rfh.noInvoices" as Parameters<typeof t>[0])}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fust.rfh.status" as Parameters<typeof t>[0])}</TableHead>
                <TableHead>{t("fust.rfh.invoiceNumber" as Parameters<typeof t>[0])}</TableHead>
                <TableHead>{t("fust.rfh.invoiceDate" as Parameters<typeof t>[0])}</TableHead>
                <TableHead>{t("fust.rfh.company" as Parameters<typeof t>[0])}</TableHead>
                <TableHead>{t("fust.rfh.vouchers" as Parameters<typeof t>[0])}</TableHead>
                <TableHead className="text-right">
                  {t("fust.rfh.statiegeld" as Parameters<typeof t>[0])}
                </TableHead>
                <TableHead className="text-right">
                  {t("fust.rfh.fusthuur" as Parameters<typeof t>[0])}
                </TableHead>
                <TableHead className="text-right">
                  {t("fust.rfh.total" as Parameters<typeof t>[0])}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow
                  key={invoice.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/fust/rfh-invoices/${invoice.id}`)}
                >
                  <TableCell>
                    <RfhStatusBadge
                      status={invoice.status}
                      allocatedCount={invoice.allocatedCount}
                      voucherCount={invoice.voucherCount}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {invoice.rfhInvoiceNumber || invoice.invoiceNumber}
                  </TableCell>
                  <TableCell>{formatDate(invoice.invoiceDate)}</TableCell>
                  <TableCell>{invoice.company?.name || "-"}</TableCell>
                  <TableCell>
                    {invoice.voucherCount} {invoice.voucherCount === 1 ? "bon" : "bonnen"}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrencyDetailed(Number(invoice.totalStatiegeld))}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrencyDetailed(Number(invoice.totalFusthuur))}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrencyDetailed(totalForInvoice(invoice))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
