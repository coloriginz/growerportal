// ─── ROLES ───────────────────────────────────────────────

export const ROLES = ["grower", "commercie", "admin"] as const;
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
