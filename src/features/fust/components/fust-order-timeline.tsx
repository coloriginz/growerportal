"use client";

import { useMemo } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  RiAddLine,
  RiCheckLine,
  RiCloseLine,
  RiTruckLine,
  RiBox3Line,
  RiFileTextLine,
  RiLink,
  RiDeleteBinLine,
  RiFlashlightLine,
  RiReceiptLine,
} from "@remixicon/react";

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
  pagination: { total: number };
}

const actionIcons: Record<string, React.ElementType> = {
  order_created: RiAddLine,
  order_auto_approved: RiFlashlightLine,
  order_approved: RiCheckLine,
  order_rejected: RiCloseLine,
  order_cancelled: RiCloseLine,
  order_deleted: RiDeleteBinLine,
  pickup_created: RiTruckLine,
  pickup_orders_linked: RiLink,
  pickup_picked_up: RiTruckLine,
  pickup_completed: RiCheckLine,
  delivery_in_transit: RiTruckLine,
  delivery_delivered: RiBox3Line,
  invoice_uploaded: RiReceiptLine,
  invoice_status_changed: RiReceiptLine,
  invoice_charges_created: RiReceiptLine,
  voucher_uploaded: RiFileTextLine,
  voucher_matched: RiLink,
  voucher_unmatched: RiCloseLine,
};

const actionColors: Record<string, string> = {
  order_created: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  order_auto_approved: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  order_approved: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  order_rejected: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  order_cancelled: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  order_deleted: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  pickup_created: "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
  pickup_orders_linked: "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
  pickup_picked_up: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
  pickup_completed: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  delivery_in_transit: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
  delivery_delivered: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  invoice_uploaded: "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400",
  invoice_status_changed: "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400",
  invoice_charges_created: "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400",
  voucher_uploaded: "bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400",
  voucher_matched: "bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400",
  voucher_unmatched: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
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

interface FustOrderTimelineProps {
  orderId: string;
}

export function FustOrderTimeline({ orderId }: FustOrderTimelineProps) {
  const { t } = useLanguage();

  const url = useMemo(() => `/api/fust/audit?orderId=${orderId}&limit=100`, [orderId]);
  const { data, loading } = useFetch<AuditResponse>(url);

  if (loading) {
    return <Skeleton className="h-48" />;
  }

  const events = data?.events || [];

  if (events.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        <p className="text-sm">{t("fust.noAuditEvents")}</p>
        <p className="mt-1 text-xs">{t("fust.auditTrailStarted")}</p>
      </div>
    );
  }

  return (
    <div className="relative space-y-0">
      {/* Vertical line */}
      <div className="absolute left-[17px] top-2 bottom-2 w-px bg-border" />

      {events.map((event, idx) => {
        const Icon = actionIcons[event.action] || RiBox3Line;
        const colorClass = actionColors[event.action] || "bg-muted text-muted-foreground";
        const actionKey = `fust.audit.${event.action}` as Parameters<typeof t>[0];
        const label = t(actionKey);

        return (
          <div key={event.id} className="relative flex gap-3 pb-4">
            {/* Icon circle */}
            <div className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${colorClass}`}>
              <Icon className="h-4 w-4" />
            </div>

            {/* Content */}
            <div className="flex-1 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{label}</span>
                {idx === 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    Latest
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{formatTimestamp(event.createdAt)}</span>
                <span>·</span>
                <span>{event.actorName || t("fust.systemAction")}</span>
              </div>
              {/* Metadata summary */}
              {event.action === "order_rejected" && event.metadata && typeof (event.metadata as Record<string, unknown>).rejectionReason === "string" && (
                <p className="mt-1 text-xs text-destructive">
                  {(event.metadata as Record<string, string>).rejectionReason}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
