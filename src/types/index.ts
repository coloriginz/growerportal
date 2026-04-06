// ─── ROLES ───────────────────────────────────────────────

export const ROLES = ["grower", "commercie", "admin", "transporteur", "finance"] as const;
export type Role = (typeof ROLES)[number];

// ─── LOT STATUS ──────────────────────────────────────────

export const LOT_STATUSES = ["in_transit", "selling", "sold"] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

export const LOT_STATUS_LABELS: Record<LotStatus, string> = {
  in_transit: "In Transit",
  selling: "Selling",
  sold: "Sold",
};

// ─── SALES TYPES ─────────────────────────────────────────

export const SALES_TYPES = [
  "Direct sales",
  "VBA",
  "VPL",
  "Production",
] as const;
export type SalesType = (typeof SALES_TYPES)[number];

// ─── DOCUMENT TYPES ──────────────────────────────────────

export const DOCUMENT_TYPES = [
  "salessheet",
  "contract",
  "growing_plan",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  salessheet: "Sales Sheet",
  contract: "Contract",
  growing_plan: "Growing Plan",
  other: "Other",
};

// ─── CONTAINER TYPES ─────────────────────────────────────

export const CONTAINER_TYPES = ["Box", "Bucket", "Other"] as const;
export type ContainerType = (typeof CONTAINER_TYPES)[number];

// ─── CHANGE REQUEST STATUS ───────────────────────────────

export const CHANGE_REQUEST_STATUSES = ["pending", "handled"] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

// ─── FUST ───────────────────────────────────────────────

export const FUST_ORDER_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "scheduled",
  "in_transit",
  "delivered",
  "cancelled",
] as const;
export type FustOrderStatus = (typeof FUST_ORDER_STATUSES)[number];

export const FUST_ORDER_STATUS_LABELS: Record<FustOrderStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  scheduled: "Scheduled",
  in_transit: "In Transit",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const FUST_CATEGORIES = [
  "emmers",
  "karren",
  "kratten",
  "dozen",
  "opzetrekken",
  "overig",
] as const;
export type FustCategory = (typeof FUST_CATEGORIES)[number];

export const FUST_DELIVERY_STATUSES = ["pending", "in_transit", "delivered"] as const;
export type FustDeliveryStatus = (typeof FUST_DELIVERY_STATUSES)[number];

export const FUST_INVOICE_STATUSES = ["pending", "matched", "charged", "paid"] as const;
export type FustInvoiceStatus = (typeof FUST_INVOICE_STATUSES)[number];

export const FUST_CHARGE_STATUSES = ["pending", "invoiced", "paid"] as const;
export type FustChargeStatus = (typeof FUST_CHARGE_STATUSES)[number];
