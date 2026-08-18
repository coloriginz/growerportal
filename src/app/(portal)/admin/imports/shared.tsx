import { Badge } from "@/components/ui/badge";
import {
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiAlertLine,
} from "@remixicon/react";

export interface ImportBatchJob {
  importBatchId: string;
  runId: string;
  source: string;
  sequence: number;
  attempts: number;
  windowFrom: string;
  windowTo: string;
  status: "pending" | "dispatched" | "done" | "failed" | "cancelled";
}

export interface ImportBatch {
  id: string;
  endpoint: string;
  status: "running" | "success" | "error";
  recordsReceived: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  durationMs: number | null;
  errorMessage: string | null;
  details: Record<string, unknown> | null;
  startedAt: string;
  completedAt: string | null;
  job: ImportBatchJob | null;
}

export interface ImportBatchResponse {
  batches: ImportBatch[];
  page: number;
  totalPages: number;
  summary: {
    totalBatches: number;
    errors24h: number;
    lastSuccessful: Record<string, string>;
  };
}

export const ENDPOINTS = ["suppliers", "growers", "lots", "orders", "costs"] as const;

export function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "< 1 min";
  if (diffMin < 60) return `${diffMin} min`;
  if (diffHour < 24) return `${diffHour}h`;
  return `${diffDay}d`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

const windowDateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** e.g. "10 Aug – 18 Aug" — the window a sync job fetched, not tied to any locale used elsewhere. */
export function formatWindowRange(from: string, to: string): string {
  return `${windowDateFormat.format(new Date(from))} – ${windowDateFormat.format(new Date(to))}`;
}

/** rel_id -> skipped lot count, sorted busiest-first. Empty when the batch has none. */
export function skippedSuppliersOf(batch: Pick<ImportBatch, "details">): [string, number][] {
  const raw = batch.details?.skippedSuppliers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort((a, b) => b[1] - a[1]);
}

export function StatusBadge({ status }: { status: ImportBatch["status"] }) {
  switch (status) {
    case "success":
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          <RiCheckLine className="mr-1 h-3 w-3" />
          Success
        </Badge>
      );
    case "error":
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
          <RiErrorWarningLine className="mr-1 h-3 w-3" />
          Error
        </Badge>
      );
    case "running":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
          <RiLoader4Line className="mr-1 h-3 w-3 animate-spin" />
          Running
        </Badge>
      );
  }
}

export interface SalesSheetIngestion {
  id: string;
  subject: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  processedAt: string;
  status: string;
  attachmentCount: number;
  processedCount: number;
  skippedCount: number;
  errors: string | null;
  createdAt: string;
  processed: { fileName: string; salesSheetId: string; invoiceNumber: string; ourInvoiceNumber: string; supplierCode: string }[];
  skipped: { fileName: string; reason: string }[];
}

export function IngestionStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "PROCESSED":
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          <RiCheckLine className="mr-1 h-3 w-3" />
          Processed
        </Badge>
      );
    case "PARTIAL":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
          <RiAlertLine className="mr-1 h-3 w-3" />
          Partial
        </Badge>
      );
    case "ERROR":
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
          <RiErrorWarningLine className="mr-1 h-3 w-3" />
          Error
        </Badge>
      );
    case "PROCESSING":
      return (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
          <RiLoader4Line className="mr-1 h-3 w-3 animate-spin" />
          Processing
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export interface IngestionResponse {
  items: SalesSheetIngestion[];
  page: number;
  totalPages: number;
  total: number;
}
