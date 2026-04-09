"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  RiUploadLine,
  RiFileTextLine,
  RiLink,
  RiLinkUnlink,
  RiExternalLinkLine,
  RiCheckLine,
  RiCloseLine,
  RiAlertLine,
} from "@remixicon/react";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────

interface FustTypeRef {
  id: string;
  code: string;
  name: string;
}

interface VoucherItem {
  id: string;
  fustCode: string;
  description: string;
  quantity: number;
  fustTypeId: string | null;
  fustType: FustTypeRef | null;
}

interface OrderRef {
  id: string;
  orderNumber: string;
  status: string;
  deliveredAt: string | null;
  grower: { id: string; code: string; name: string; company: string | null };
  items: Array<{
    id: string;
    quantity: number;
    fustType: FustTypeRef;
  }>;
}

interface VoucherOrderLink {
  id: string;
  orderId: string;
  order: OrderRef;
  createdAt: string;
}

interface Voucher {
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

interface UploadStatus {
  fileName: string;
  status: "uploading" | "success" | "error" | "duplicate";
  message?: string;
}

// ─── Main Component ─────────────────────────────────────

export function FustVouchers() {
  const { t } = useLanguage();
  const [uploadStatuses, setUploadStatuses] = useState<UploadStatus[]>([]);
  const [matchVoucher, setMatchVoucher] = useState<Voucher | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: vouchers, loading, refetch } = useFetch<Voucher[]>("/api/fust/vouchers");

  const unmatchedVouchers = useMemo(
    () => vouchers?.filter((v) => v.orderLinks.length === 0) ?? [],
    [vouchers]
  );

  const matchedVouchers = useMemo(
    () => vouchers?.filter((v) => v.orderLinks.length > 0) ?? [],
    [vouchers]
  );

  const isUploading = uploadStatuses.some((s) => s.status === "uploading");

  const handleFiles = useCallback(
    async (files: FileList) => {
      const fileArray = Array.from(files).filter(
        (f) => f.type === "application/pdf"
      );
      if (fileArray.length === 0) return;

      const statuses: UploadStatus[] = fileArray.map((f) => ({
        fileName: f.name,
        status: "uploading" as const,
      }));
      setUploadStatuses(statuses);

      // Upload with concurrency limit of 3
      const concurrency = 3;
      let idx = 0;

      const uploadOne = async () => {
        while (idx < fileArray.length) {
          const currentIdx = idx++;
          const file = fileArray[currentIdx];

          try {
            const formData = new FormData();
            formData.append("file", file);

            const res = await fetch("/api/fust/vouchers", {
              method: "POST",
              body: formData,
            });

            if (res.ok) {
              setUploadStatuses((prev) =>
                prev.map((s, i) =>
                  i === currentIdx ? { ...s, status: "success" } : s
                )
              );
            } else if (res.status === 409) {
              setUploadStatuses((prev) =>
                prev.map((s, i) =>
                  i === currentIdx
                    ? { ...s, status: "duplicate", message: t("fust.voucherDuplicate" as Parameters<typeof t>[0]) }
                    : s
                )
              );
            } else {
              const err = await res.json();
              if (err.debug) {
                console.log("[VoucherUpload] Parse debug for", file.name, err.debug);
              }
              setUploadStatuses((prev) =>
                prev.map((s, i) =>
                  i === currentIdx
                    ? { ...s, status: "error", message: err.error || "Failed" }
                    : s
                )
              );
            }
          } catch {
            setUploadStatuses((prev) =>
              prev.map((s, i) =>
                i === currentIdx ? { ...s, status: "error", message: "Network error" } : s
              )
            );
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, fileArray.length) }, () =>
          uploadOne()
        )
      );

      refetch();

      // Clear upload statuses after a delay
      setTimeout(() => setUploadStatuses([]), 5000);
    },
    [t, refetch]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) handleFiles(files);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleFiles]
  );

  const handleUnmatch = useCallback(
    async (voucherId: string, orderId: string) => {
      try {
        const res = await fetch(`/api/fust/vouchers/${voucherId}/match`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });
        if (res.ok) {
          toast.success(t("fust.voucherUnmatched" as Parameters<typeof t>[0]));
          refetch();
        } else {
          toast.error("Failed to unmatch");
        }
      } catch {
        toast.error("Failed to unmatch");
      }
    },
    [t, refetch]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">
          {t("fust.vouchers" as Parameters<typeof t>[0])}
        </h2>
        <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
          <RiUploadLine className="mr-2 h-4 w-4" />
          {t("fust.uploadVouchers" as Parameters<typeof t>[0])}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Upload progress */}
      {uploadStatuses.length > 0 && (
        <div className="rounded-lg border p-4 space-y-2">
          <p className="text-sm font-medium">
            {t("fust.uploading" as Parameters<typeof t>[0])}...{" "}
            {uploadStatuses.filter((s) => s.status !== "uploading").length}/
            {uploadStatuses.length}
          </p>
          <div className="space-y-1">
            {uploadStatuses.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                {s.status === "uploading" && (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                )}
                {s.status === "success" && (
                  <RiCheckLine className="h-4 w-4 text-green-600" />
                )}
                {s.status === "error" && (
                  <RiCloseLine className="h-4 w-4 text-destructive" />
                )}
                {s.status === "duplicate" && (
                  <RiAlertLine className="h-4 w-4 text-yellow-600" />
                )}
                <span className={s.status === "error" ? "text-destructive" : ""}>
                  {s.fileName}
                </span>
                {s.message && (
                  <span className="text-xs text-muted-foreground">
                    — {s.message}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          {/* Unmatched Vouchers */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {t("fust.unmatchedVouchers" as Parameters<typeof t>[0])} ({unmatchedVouchers.length})
            </h3>
            {unmatchedVouchers.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <RiFileTextLine className="mx-auto mb-2 h-8 w-8 opacity-30" />
                <p className="text-sm">{t("fust.noUnmatchedVouchers" as Parameters<typeof t>[0])}</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {unmatchedVouchers.map((voucher) => (
                  <VoucherCard
                    key={voucher.id}
                    voucher={voucher}
                    onMatch={() => setMatchVoucher(voucher)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Matched Vouchers */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {t("fust.matchedVouchers" as Parameters<typeof t>[0])} ({matchedVouchers.length})
            </h3>
            {matchedVouchers.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <RiFileTextLine className="mx-auto mb-2 h-8 w-8 opacity-30" />
                <p className="text-sm">{t("fust.noMatchedVouchers" as Parameters<typeof t>[0])}</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {matchedVouchers.map((voucher) => (
                  <VoucherCard
                    key={voucher.id}
                    voucher={voucher}
                    onUnmatch={handleUnmatch}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Match Dialog */}
      {matchVoucher && (
        <MatchDialog
          voucher={matchVoucher}
          onClose={() => setMatchVoucher(null)}
          onMatched={() => {
            setMatchVoucher(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

// ─── Voucher Card ─────────────────────────────────────

function VoucherCard({
  voucher,
  onMatch,
  onUnmatch,
}: {
  voucher: Voucher;
  onMatch?: () => void;
  onUnmatch?: (voucherId: string, orderId: string) => void;
}) {
  const { t } = useLanguage();

  const itemsSummary = voucher.items
    .map((item) => `${Math.abs(item.quantity)}x ${item.description}`)
    .join(", ");

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">#{voucher.transactionNumber}</span>
            <Badge variant={voucher.type === "uitgifte" ? "default" : "secondary"}>
              {t(`fust.${voucher.type}` as Parameters<typeof t>[0])}
            </Badge>
            {voucher.pdfUrl && (
              <a href={voucher.pdfUrl} target="_blank" rel="noopener noreferrer">
                <RiExternalLinkLine className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
              </a>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {voucher.transporterName && (
              <span>{voucher.transporterName}</span>
            )}
            <span>{formatDate(voucher.transactionDate)}</span>
            {voucher.location && <span>{voucher.location}</span>}
          </div>
          {itemsSummary && (
            <p className="text-sm">{itemsSummary}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onMatch && (
            <Button variant="outline" size="sm" onClick={onMatch}>
              <RiLink className="mr-1.5 h-3.5 w-3.5" />
              {t("fust.matchToOrder" as Parameters<typeof t>[0])}
            </Button>
          )}
        </div>
      </div>

      {/* Linked orders */}
      {voucher.orderLinks.length > 0 && (
        <div className="border-t pt-3 space-y-2">
          {voucher.orderLinks.map((link) => (
            <div
              key={link.id}
              className="flex items-center justify-between rounded bg-muted/50 px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium">{link.order.orderNumber}</span>
                <span className="ml-2 text-muted-foreground">
                  {link.order.grower.code} — {link.order.grower.company || link.order.grower.name}
                </span>
                {link.order.deliveredAt && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {formatDate(link.order.deliveredAt)}
                  </span>
                )}
              </div>
              {onUnmatch && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onUnmatch(voucher.id, link.orderId)}
                >
                  <RiLinkUnlink className="mr-1 h-3.5 w-3.5" />
                  {t("fust.unmatch" as Parameters<typeof t>[0])}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Match Dialog ───────────────────────────────────────

function MatchDialog({
  voucher,
  onClose,
  onMatched,
}: {
  voucher: Voucher;
  onClose: () => void;
  onMatched: () => void;
}) {
  const { t } = useLanguage();
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Fetch delivered orders
  const { data: orders, loading: ordersLoading } = useFetch<OrderRef[]>(
    "/api/fust/orders?status=delivered"
  );

  const toggleOrder = useCallback((orderId: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  }, []);

  const handleMatch = async () => {
    if (selectedOrderIds.size === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/fust/vouchers/${voucher.id}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: Array.from(selectedOrderIds) }),
      });
      if (res.ok) {
        toast.success(t("fust.voucherMatched" as Parameters<typeof t>[0]));
        onMatched();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to match");
      }
    } catch {
      toast.error("Failed to match");
    } finally {
      setSubmitting(false);
    }
  };

  const itemsSummary = voucher.items
    .map((item) => `${Math.abs(item.quantity)}x ${item.description}`)
    .join(", ");

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("fust.matchToOrder" as Parameters<typeof t>[0])} — #{voucher.transactionNumber}
          </DialogTitle>
        </DialogHeader>

        {/* Voucher summary */}
        <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant={voucher.type === "uitgifte" ? "default" : "secondary"}>
              {t(`fust.${voucher.type}` as Parameters<typeof t>[0])}
            </Badge>
            {voucher.transporterName && (
              <span className="text-muted-foreground">{voucher.transporterName}</span>
            )}
            <span className="text-muted-foreground">{formatDate(voucher.transactionDate)}</span>
          </div>
          {itemsSummary && <p>{itemsSummary}</p>}
        </div>

        {/* Order selection */}
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {t("fust.selectOrderToMatch" as Parameters<typeof t>[0])}
          </p>
          {ordersLoading ? (
            <Skeleton className="h-32" />
          ) : !orders || orders.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t("fust.noDeliveries" as Parameters<typeof t>[0])}
            </p>
          ) : (
            <div className="space-y-2 max-h-[40vh] overflow-y-auto">
              {orders.map((order) => (
                <label
                  key={order.id}
                  className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    selectedOrderIds.has(order.id)
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <Checkbox
                    checked={selectedOrderIds.has(order.id)}
                    onCheckedChange={() => toggleOrder(order.id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{order.orderNumber}</span>
                      <span className="text-muted-foreground">
                        {order.grower.code} — {order.grower.company || order.grower.name}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      {order.items
                        .map((item) => `${item.quantity}x ${item.fustType.code} — ${item.fustType.name}`)
                        .join(", ")}
                    </div>
                    {order.deliveredAt && (
                      <span className="text-xs text-muted-foreground">
                        {t("fust.delivered" as Parameters<typeof t>[0])}: {formatDate(order.deliveredAt)}
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleMatch}
            disabled={selectedOrderIds.size === 0 || submitting}
          >
            {submitting
              ? t("common.loading")
              : `${t("fust.matchToOrder" as Parameters<typeof t>[0])} (${selectedOrderIds.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
