"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RiUploadLine,
  RiFileTextLine,
  RiExternalLinkLine,
  RiLink,
  RiCheckLine,
  RiCloseLine,
  RiAlertLine,
} from "@remixicon/react";
import { formatDate } from "@/lib/format";

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
  items: Array<{ id: string; quantity: number; fustType: FustTypeRef }>;
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

type StatusFilter = "all" | "matched" | "unmatched";

// ─── Component ──────────────────────────────────────────

export function FustReceivedVouchers() {
  const { t } = useLanguage();
  const tAny = t as unknown as (key: string) => string;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [uploadStatuses, setUploadStatuses] = useState<UploadStatus[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: vouchers, loading, refetch } = useFetch<Voucher[]>("/api/fust/vouchers");

  const isUploading = uploadStatuses.some((s) => s.status === "uploading");

  const filteredVouchers = useMemo(() => {
    if (!vouchers) return [];
    if (statusFilter === "matched") return vouchers.filter((v) => v.orderLinks.length > 0);
    if (statusFilter === "unmatched") return vouchers.filter((v) => v.orderLinks.length === 0);
    return vouchers;
  }, [vouchers, statusFilter]);

  const counts = useMemo(() => {
    if (!vouchers) return { all: 0, matched: 0, unmatched: 0 };
    return {
      all: vouchers.length,
      matched: vouchers.filter((v) => v.orderLinks.length > 0).length,
      unmatched: vouchers.filter((v) => v.orderLinks.length === 0).length,
    };
  }, [vouchers]);

  // ─── Upload Logic ──────────────────────────────────────

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
                    ? { ...s, status: "duplicate", message: tAny("fust.voucherDuplicate") }
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
                i === currentIdx
                  ? { ...s, status: "error", message: "Network error" }
                  : s
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
      setTimeout(() => setUploadStatuses([]), 5000);
    },
    [tAny, refetch]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) handleFiles(files);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleFiles]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {tAny("fust.receivedVouchers")}
        </h1>
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          size="sm"
        >
          <RiUploadLine className="mr-2 h-4 w-4" />
          {tAny("fust.uploadVouchers")}
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
        <div className="rounded-lg border p-3 space-y-2">
          <p className="text-sm font-medium">
            {tAny("fust.uploading")}...{" "}
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
                  <span className="text-xs text-muted-foreground">— {s.message}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 border-b">
        {(["all", "unmatched", "matched"] as const).map((filter) => (
          <button
            key={filter}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              statusFilter === filter
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setStatusFilter(filter)}
          >
            {filter === "all" && `${tAny("fust.viewAll")} (${counts.all})`}
            {filter === "unmatched" && `${tAny("fust.viewUnmatched")} (${counts.unmatched})`}
            {filter === "matched" && `${tAny("fust.matched")} (${counts.matched})`}
          </button>
        ))}
      </div>

      {/* Voucher table */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : filteredVouchers.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <RiFileTextLine className="mx-auto mb-2 h-10 w-10 opacity-30" />
          <p className="text-sm">{tAny("fust.noUnmatchedVouchers")}</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>{tAny("common.type")}</TableHead>
                <TableHead>{tAny("common.date")}</TableHead>
                <TableHead>{tAny("fust.transporter")}</TableHead>
                <TableHead>{tAny("fust.items")}</TableHead>
                <TableHead>{tAny("fust.status")}</TableHead>
                <TableHead>{tAny("fust.linkedOrders")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredVouchers.map((voucher) => {
                const itemsSummary = voucher.items
                  .map((item) => `${Math.abs(item.quantity)}x ${item.description}`)
                  .join(", ");
                const linkCount = voucher.orderLinks.length;

                return (
                  <TableRow key={voucher.id}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-sm">{voucher.transactionNumber}</span>
                        {voucher.pdfUrl && (
                          <a
                            href={voucher.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <RiExternalLinkLine className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={voucher.type === "uitgifte" ? "default" : "secondary"}>
                        {tAny(`fust.${voucher.type}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(voucher.transactionDate)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {voucher.transporterName || "—"}
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground" title={itemsSummary}>
                        {itemsSummary || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {linkCount > 0 ? (
                        <Badge variant="outline" className="gap-1">
                          <RiLink className="h-3 w-3" />
                          {tAny("fust.matched")}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">{tAny("fust.viewUnmatched")}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {linkCount > 0 ? (
                        <div className="space-y-0.5">
                          {voucher.orderLinks.map((link) => (
                            <div key={link.id} className="text-xs text-muted-foreground">
                              {link.order.orderNumber} — {link.order.grower.code}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
