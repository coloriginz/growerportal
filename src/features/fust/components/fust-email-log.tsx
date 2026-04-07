"use client";

import { useState, useMemo } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  RiArrowLeftSLine,
  RiArrowRightSLine,
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
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <RiArrowLeftSLine className="h-4 w-4" />
                </Button>
                <span className="text-sm">
                  {page} / {data.pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  <RiArrowRightSLine className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Detail Sheet */}
      <Sheet open={!!selectedId} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <SheetContent className="w-full sm:w-[50vw] data-[side=right]:sm:max-w-none overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("fust.emailLog.details" as Parameters<typeof t>[0])}</SheetTitle>
          </SheetHeader>

          {detailLoading ? (
            <div className="mt-6 space-y-4">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : detail ? (
            <div className="mt-6 space-y-6">
              {/* Metadata */}
              <div className="space-y-3">
                <DetailRow
                  label={t("fust.emailLog.subject" as Parameters<typeof t>[0])}
                  value={detail.subject}
                />
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

              {/* Processing details */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Processing
                </h3>
                <DetailRow
                  label={t("fust.emailLog.transactionNumber" as Parameters<typeof t>[0])}
                  value={detail.transactionNumber}
                />
                <DetailRow
                  label={t("fust.emailLog.reportId" as Parameters<typeof t>[0])}
                  value={detail.reportId}
                  mono
                />
                {detail.pdfUrl && (
                  <DetailRow label={t("fust.emailLog.viewPdf" as Parameters<typeof t>[0])}>
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
                  </DetailRow>
                )}
              </div>

              {/* Linked voucher */}
              {detail.voucher && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    {t("fust.emailLog.linkedVoucher" as Parameters<typeof t>[0])}
                  </h3>
                  <div className="rounded-lg border p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        #{detail.voucher.transactionNumber}
                      </span>
                      <Badge variant="outline">{detail.voucher.type}</Badge>
                    </div>
                    {detail.voucher.customerName && (
                      <p className="text-sm text-muted-foreground">{detail.voucher.customerName}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatDate(new Date(detail.voucher.transactionDate))}
                    </p>
                    {detail.voucher.items.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {detail.voucher.items.map((item) => (
                          <div key={item.id} className="flex justify-between text-xs">
                            <span>{item.description} ({item.fustCode})</span>
                            <span className="font-mono">{item.quantity}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Errors */}
              {detail.errors && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    {t("fust.emailLog.errors" as Parameters<typeof t>[0])}
                  </h3>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                    {detail.errors.split(";").map((err, i) => (
                      <p key={i} className="text-sm text-amber-800 dark:text-amber-200">
                        {err.trim()}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Email body */}
              {(detail.emailBodyHtml || detail.emailBody) && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    {t("fust.emailLog.emailBody" as Parameters<typeof t>[0])}
                  </h3>
                  <div className="rounded-lg border bg-muted/30 max-h-[200px] overflow-y-auto">
                    {detail.emailBodyHtml ? (
                      <iframe
                        srcDoc={detail.emailBodyHtml}
                        className="w-full h-[180px] border-0"
                        sandbox=""
                        title="Email body"
                      />
                    ) : (
                      <pre className="p-3 text-xs whitespace-pre-wrap">
                        {detail.emailBody}
                      </pre>
                    )}
                  </div>
                </div>
              )}

              {/* Reprocess button */}
              {detail.status === "ERROR" && (
                <Button
                  onClick={handleReprocess}
                  disabled={reprocessing}
                  className="w-full"
                >
                  <RiRefreshLine className={`mr-2 h-4 w-4 ${reprocessing ? "animate-spin" : ""}`} />
                  {reprocessing
                    ? t("fust.emailLog.reprocessing" as Parameters<typeof t>[0])
                    : t("fust.emailLog.reprocess" as Parameters<typeof t>[0])}
                </Button>
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
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className={`text-sm break-all ${mono ? "font-mono text-xs" : ""}`}>
        {children || value || "-"}
      </div>
    </div>
  );
}
