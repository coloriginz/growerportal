// ─── Shared Types for Voucher Matching ─────────────────

export interface FustTypeRef {
  id: string;
  code: string;
  name: string;
}

export interface VoucherItem {
  id: string;
  fustCode: string;
  description: string;
  quantity: number;
  fustTypeId: string | null;
  fustType: FustTypeRef | null;
}

export interface OrderRef {
  id: string;
  orderNumber: string;
  status: string;
  deliveredAt: string | null;
  supplier: { id: string; code: string; name: string; company: string | null };
  items: Array<{
    id: string;
    quantity: number;
    fustType: FustTypeRef;
  }>;
  voucherLinks?: Array<{
    id: string;
    voucher: { id: string; transactionNumber: string; type: string; transactionDate: string };
  }>;
}

export interface VoucherOrderLink {
  id: string;
  orderId: string;
  order: OrderRef;
  createdAt: string;
}

export interface Voucher {
  id: string;
  transactionNumber: string;
  type: string;
  transactionDate: string;
  creationDate: string | null;
  location: string | null;
  customerNumber: string | null;
  customerName: string | null;
  transporterName: string | null;
  cardNumber: string | null;
  pdfUrl: string | null;
  items: VoucherItem[];
  orderLinks: VoucherOrderLink[];
}

export interface UploadStatus {
  fileName: string;
  status: "uploading" | "success" | "error" | "duplicate";
  message?: string;
}

export type ViewMode = "unmatched" | "all";
