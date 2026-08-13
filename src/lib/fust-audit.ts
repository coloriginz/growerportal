import { prisma } from "@/lib/db";

export const FUST_AUDIT_ACTIONS = [
  // Order
  "order_created",
  "order_auto_approved",
  "order_approved",
  "order_rejected",
  "order_cancelled",
  "order_deleted",
  // Pickup
  "pickup_created",
  "pickup_orders_linked",
  "pickup_picked_up",
  "pickup_completed",
  // Delivery
  "delivery_in_transit",
  "delivery_delivered",
  // Invoice
  "invoice_uploaded",
  "invoice_status_changed",
  "invoice_charges_created",
  // Voucher
  "voucher_uploaded",
  "voucher_matched",
  "voucher_unmatched",
  // Grower Invoice
  "grower_invoice_created",
  "grower_invoice_sent",
  "grower_invoice_status_changed",
  // RFH Invoice
  "rfh_invoice_imported",
  "rfh_invoice_deleted",
  "rfh_voucher_allocated",
  "rfh_voucher_deallocated",
] as const;

export type FustAuditAction = (typeof FUST_AUDIT_ACTIONS)[number];

interface LogFustEventParams {
  entityType: string;
  entityId: string;
  orderId?: string | null;
  action: FustAuditAction;
  actorId?: string | null;
  actorName?: string | null;
  metadata?: Record<string, unknown> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx?: any;
}

export async function logFustEvent({
  entityType,
  entityId,
  orderId,
  action,
  actorId,
  actorName,
  metadata,
  tx,
}: LogFustEventParams): Promise<void> {
  const client = tx ?? prisma;
  try {
    await client.fustAuditLog.create({
      data: {
        entityType,
        entityId,
        orderId: orderId ?? null,
        action,
        actorId: actorId ?? null,
        actorName: actorName ?? null,
        metadata: metadata ?? undefined,
      },
    });
  } catch (err) {
    // Audit logging should never break the main operation
    console.error("[FustAudit] Failed to log event:", action, err);
  }
}
