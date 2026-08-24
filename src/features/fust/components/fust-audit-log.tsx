"use client";

import { useState, useMemo } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/pagination";
import { pageLabels } from "@/components/pagination-labels";
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
import { RiHistoryLine } from "@remixicon/react";
import { FUST_AUDIT_ENTITY_TYPES } from "@/types";
import { FUST_AUDIT_ACTIONS } from "@/lib/fust-audit";
import { FustOrderTimeline } from "./fust-order-timeline";

interface AuditEvent {
  id: string;
  entityType: string;
  entityId: string;
  orderId: string | null;
  action: string;
  actorId: string | null;
  actorName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditResponse {
  events: AuditEvent[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const actionCategoryColors: Record<string, string> = {
  order: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  pickup: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  delivery: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  invoice: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  voucher: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  charge: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
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

export function FustAuditLog() {
  const { t } = useLanguage();
  const [entityTypeFilter, setEntityTypeFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [timelineOrderId, setTimelineOrderId] = useState<string | null>(null);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (entityTypeFilter !== "all") params.set("entityType", entityTypeFilter);
    if (actionFilter !== "all") params.set("action", actionFilter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    params.set("page", String(page));
    params.set("limit", "50");
    return `/api/fust/audit?${params.toString()}`;
  }, [entityTypeFilter, actionFilter, dateFrom, dateTo, page]);

  const { data, loading } = useFetch<AuditResponse>(url);

  const filteredActions = useMemo(() => {
    if (entityTypeFilter === "all") return [...FUST_AUDIT_ACTIONS];
    return FUST_AUDIT_ACTIONS.filter((a) => a.startsWith(entityTypeFilter + "_"));
  }, [entityTypeFilter]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("fust.auditLog")}</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={entityTypeFilter} onValueChange={(v) => { setEntityTypeFilter(v ?? "all"); setActionFilter("all"); setPage(1); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("fust.allEntityTypes")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("fust.allEntityTypes")}</SelectItem>
            {FUST_AUDIT_ENTITY_TYPES.map((et) => (
              <SelectItem key={et} value={et}>
                {et.charAt(0).toUpperCase() + et.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v ?? "all"); setPage(1); }}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder={t("fust.allActions")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("fust.allActions")}</SelectItem>
            {filteredActions.map((a) => (
              <SelectItem key={a} value={a}>
                {t(`fust.audit.${a}` as Parameters<typeof t>[0])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="w-[150px]"
          placeholder={t("fust.dateFrom")}
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="w-[150px]"
          placeholder={t("fust.dateTo")}
        />
      </div>

      {/* Table */}
      {loading ? (
        <Skeleton className="h-48" />
      ) : !data || data.events.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <RiHistoryLine className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p>{t("fust.noAuditEvents")}</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">Timestamp</TableHead>
                  <TableHead>{t("fust.entity")}</TableHead>
                  <TableHead>{t("common.actions")}</TableHead>
                  <TableHead>{t("fust.actor")}</TableHead>
                  <TableHead>{t("fust.details")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.events.map((event) => {
                  const category = event.action.split("_")[0];
                  const badgeColor = actionCategoryColors[category] || "bg-muted text-muted-foreground";

                  return (
                    <TableRow key={event.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatTimestamp(event.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {event.entityType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${badgeColor} border-0`}>
                          {t(`fust.audit.${event.action}` as Parameters<typeof t>[0])}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {event.actorName || (
                          <span className="text-muted-foreground italic">{t("fust.systemAction")}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {event.metadata ? summarizeMetadata(event.metadata) : ""}
                      </TableCell>
                      <TableCell>
                        {event.orderId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setTimelineOrderId(event.orderId)}
                            title={t("fust.orderTimeline")}
                          >
                            <RiHistoryLine className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {data.pagination.total} events
              </p>
              <Pagination
                page={page}
                totalPages={data.pagination.totalPages}
                onPageChange={setPage}
                labels={pageLabels}
              />
            </div>
          )}
        </>
      )}

      {/* Order timeline sheet */}
      <Sheet open={!!timelineOrderId} onOpenChange={(open) => { if (!open) setTimelineOrderId(null); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("fust.orderTimeline")}</SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            {timelineOrderId && <FustOrderTimeline orderId={timelineOrderId} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function summarizeMetadata(metadata: Record<string, unknown>): string {
  const parts: string[] = [];
  if (metadata.orderNumber) parts.push(`#${metadata.orderNumber}`);
  if (metadata.invoiceNumber) parts.push(`Inv: ${metadata.invoiceNumber}`);
  if (metadata.transactionNumber) parts.push(`Txn: ${metadata.transactionNumber}`);
  if (metadata.status) parts.push(`→ ${metadata.status}`);
  if (metadata.fromStatus && metadata.toStatus) parts.push(`${metadata.fromStatus} → ${metadata.toStatus}`);
  if (metadata.rejectionReason) parts.push(String(metadata.rejectionReason));
  return parts.join(" · ");
}
