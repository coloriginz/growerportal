"use client";

import { useState, useMemo } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { Input } from "@/components/ui/input";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  RiMailLine,
  RiRefreshLine,
  RiExternalLinkLine,
  RiFileTextLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";

interface Ingestion {
  id: string;
  subject: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  processedAt: string;
  status: string;
  errors: string | null;
  transactionNumber: string | null;
  reportId: string | null;
  pdfUrl: string | null;
  voucherId: string | null;
  voucher: {
    id: string;
    transactionNumber: string;
    type: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface IngestionDetail extends Ingestion {
  emailBody: string | null;
  emailBodyHtml: string | null;
  voucher: {
    id: string;
    transactionNumber: string;
    type: string;
    transactionDate: string;
    customerName: string | null;
    items: {
      id: string;
      fustCode: string;
      description: string;
      quantity: number;
    }[];
  } | null;
}

interface IngestionResponse {
  ingestions: Ingestion[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const statusBadgeVariant: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
  PROCESSED: "default",
  ERROR: "destructive",
  PROCESSING: "secondary",
};

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FustEmailLog() {
  const { t } = useLanguage();
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);

  // Debounce search
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceTimer) clearTimeout(debounceTimer);
    setDebounceTimer(
      setTimeout(() => {
        setSearchDebounced(value);
        setPage(1);
      }, 300)
    );
  }

  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (searchDebounced) params.set("search", searchDebounced);
    params.set("page", String(page));
    params.set("limit", "20");
    return `/api/fust/email-ingestions?${params.toString()}`;
  }, [statusFilter, searchDebounced, page]);

  const { data, loading, refetch } = useFetch<IngestionResponse>(listUrl);

  const detailUrl = selectedId ? `/api/fust/email-ingestions/${selectedId}` : null;
  const { data: detail, loading: detailLoading, refetch: refetchDetail } = useFetch<IngestionDetail>(detailUrl);

  async function handleReprocess() {
    if (!selectedId) return;
    setReprocessing(true);
    try {
      const res = await fetch(`/api/fust/email-ingestions/${selectedId}/reprocess`, {
        method: "POST",
      });
      const result = await res.json();
      if (result.status === "PROCESSED") {
        toast.success(t("fust.emailLog.reprocessed" as Parameters<typeof t>[0]));
      } else {
        toast.error(t("fust.emailLog.reprocessFailed" as Parameters<typeof t>[0]));
      }
      refetchDetail();
      refetch();
    } catch {
      toast.error(t("fust.emailLog.reprocessFailed" as Parameters<typeof t>[0]));
    } finally {
      setReprocessing(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">
        {t("fust.emailLog.title" as Parameters<typeof t>[0])}
      </h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Input
          placeholder={t("fust.emailLog.search" as Parameters<typeof t>[0])}
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-[300px]"
        />
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v ?? "all");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("fust.emailLog.allStatuses" as Parameters<typeof t>[0])} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("fust.emailLog.allStatuses" as Parameters<typeof t>[0])}
            </SelectItem>
            <SelectItem value="PROCESSED">
              {t("fust.emailLog.processed" as Parameters<typeof t>[0])}
            </SelectItem>
            <SelectItem value="ERROR">
              {t("fust.emailLog.error" as Parameters<typeof t>[0])}
            </SelectItem>
            <SelectItem value="PROCESSING">
              {t("fust.emailLog.processing" as Parameters<typeof t>[0])}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {loading ? (
        <Skeleton className="h-48" />
      ) : !data || data.ingestions.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <RiMailLine className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p>{t("fust.emailLog.noEmails" as Parameters<typeof t>[0])}</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">{t("common.date" as Parameters<typeof t>[0])}</TableHead>
                  <TableHead>{t("fust.emailLog.subject" as Parameters<typeof t>[0])}</TableHead>
                  <TableHead>{t("fust.emailLog.from" as Parameters<typeof t>[0])}</TableHead>
                  <TableHead>{t("fust.transactionNumber" as Parameters<typeof t>[0])}</TableHead>
                  <TableHead>{t("common.status" as Parameters<typeof t>[0])}</TableHead>
                  <TableHead>{t("fust.voucher" as Parameters<typeof t>[0])}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.ingestions.map((ing) => (
                  <TableRow
                    key={ing.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedId(ing.id)}
                  >
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatTimestamp(ing.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-[250px] truncate text-sm">
                      {ing.subject || "-"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ing.fromAddress || "-"}
                    </TableCell>
                    <TableCell className="text-sm font-mono">
                      {ing.transactionNumber || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant[ing.status] || "outline"}>
                        {t(`fust.emailLog.${ing.status.toLowerCase()}` as Parameters<typeof t>[0])}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {ing.voucher ? (
                        <span className="text-primary">
                          {ing.voucher.transactionNumber}
                        </span>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {data.pagination.total} emails
              </p>
              <Pagination
                page={page}
                totalPages={data.pagination.totalPages}
                onPageChange={setPage}
              />
            </div>
          )}
        </>
      )}

      {/* Detail Sheet */}
      <Sheet open={!!selectedId} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <SheetContent className="w-full sm:w-[50vw] data-[side=right]:sm:max-w-none overflow-y-auto p-6">
          <SheetHeader className="pb-4 border-b">
            <div className="flex items-center justify-between">
              <SheetTitle>{t("fust.emailLog.details" as Parameters<typeof t>[0])}</SheetTitle>
              {detail && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReprocess}
                  disabled={reprocessing}
                >
                  <RiRefreshLine className={`mr-1.5 h-3.5 w-3.5 ${reprocessing ? "animate-spin" : ""}`} />
                  {reprocessing
                    ? t("fust.emailLog.reprocessing" as Parameters<typeof t>[0])
                    : t("fust.emailLog.reprocess" as Parameters<typeof t>[0])}
                </Button>
              )}
            </div>
          </SheetHeader>

          {detailLoading ? (
            <div className="mt-6 space-y-4">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : detail ? (
            <div className="mt-5 space-y-5">
              {/* ── Top: Email metadata ── */}
              <div className="space-y-2">
                <p className="text-sm font-medium leading-snug">
                  {detail.subject || "-"}
                </p>
                <div className="grid grid-cols-3 gap-4">
                  <DetailRow
                    label={t("fust.emailLog.from" as Parameters<typeof t>[0])}
                    value={detail.fromAddress}
                  />
                  <DetailRow
                    label={t("fust.emailLog.received" as Parameters<typeof t>[0])}
                    value={detail.receivedAt ? formatTimestamp(detail.receivedAt) : null}
                  />
                  <DetailRow
                    label={t("common.status" as Parameters<typeof t>[0])}
                  >
                    <Badge variant={statusBadgeVariant[detail.status] || "outline"}>
                      {t(`fust.emailLog.${detail.status.toLowerCase()}` as Parameters<typeof t>[0])}
                    </Badge>
                  </DetailRow>
                </div>
              </div>

              {/* ── Processing + PDF row ── */}
              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="grid grid-cols-3 gap-4">
                  <DetailRow
                    label={t("fust.emailLog.transactionNumber" as Parameters<typeof t>[0])}
                    value={detail.transactionNumber}
                  />
                  <DetailRow
                    label={t("fust.emailLog.reportId" as Parameters<typeof t>[0])}
                    value={detail.reportId}
                    mono
                  />
                  <DetailRow label={t("fust.emailLog.viewPdf" as Parameters<typeof t>[0])}>
                    {detail.pdfUrl ? (
                      <a
                        href={detail.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        <RiFileTextLine className="h-4 w-4" />
                        PDF
                        <RiExternalLinkLine className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </DetailRow>
                </div>
              </div>

              {/* ── Errors ── */}
              {detail.errors && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wider mb-1.5">
                    {t("fust.emailLog.errors" as Parameters<typeof t>[0])}
                  </p>
                  {detail.errors.split(";").map((err, i) => (
                    <p key={i} className="text-sm text-amber-800 dark:text-amber-200">
                      {err.trim()}
                    </p>
                  ))}
                </div>
              )}

              {/* ── Parsed voucher with items table ── */}
              {detail.voucher && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {t("fust.emailLog.linkedVoucher" as Parameters<typeof t>[0])}
                  </h3>
                  <div className="rounded-lg border overflow-hidden">
                    {/* Voucher header */}
                    <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold">
                          #{detail.voucher.transactionNumber}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(new Date(detail.voucher.transactionDate))}
                        </span>
                        {detail.voucher.customerName && (
                          <span className="text-xs text-muted-foreground">
                            &middot; {detail.voucher.customerName}
                          </span>
                        )}
                      </div>
                      <Badge variant="outline">{detail.voucher.type}</Badge>
                    </div>
                    {/* Voucher items as table */}
                    {detail.voucher.items.length > 0 && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">{t("fust.code" as Parameters<typeof t>[0])}</TableHead>
                            <TableHead className="text-xs">{t("fust.fustType" as Parameters<typeof t>[0])}</TableHead>
                            <TableHead className="text-xs text-right">{t("fust.quantity" as Parameters<typeof t>[0])}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detail.voucher.items.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="font-mono text-xs py-1.5">{item.fustCode}</TableCell>
                              <TableCell className="text-sm py-1.5">{item.description}</TableCell>
                              <TableCell className="text-sm font-semibold text-right py-1.5">{item.quantity}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                </div>
              )}

              {/* ── Email body ── */}
              {(detail.emailBodyHtml || detail.emailBody) && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {t("fust.emailLog.emailBody" as Parameters<typeof t>[0])}
                  </h3>
                  <div className="rounded-lg border bg-muted/20 overflow-hidden">
                    {detail.emailBodyHtml ? (
                      <iframe
                        srcDoc={detail.emailBodyHtml}
                        className="w-full h-[350px] border-0"
                        sandbox=""
                        title="Email body"
                      />
                    ) : (
                      <pre className="p-4 text-xs leading-relaxed whitespace-pre-wrap max-h-[350px] overflow-y-auto">
                        {detail.emailBody}
                      </pre>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <div className={`text-sm truncate ${mono ? "font-mono text-xs" : ""}`}>
        {children || value || "-"}
      </div>
    </div>
  );
}
