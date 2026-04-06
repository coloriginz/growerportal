"use client";

import { useState, useCallback, useRef } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { Button } from "@/components/ui/button";
import {
  RiUploadLine,
  RiCheckLine,
  RiCloseLine,
  RiAlertLine,
} from "@remixicon/react";
import type { UploadStatus } from "./types";

interface UploadButtonProps {
  onUploaded: () => void;
}

export function UploadButton({ onUploaded }: UploadButtonProps) {
  const { t } = useLanguage();
  const [uploadStatuses, setUploadStatuses] = useState<UploadStatus[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
                    ? {
                        ...s,
                        status: "duplicate",
                        message: t(
                          "fust.voucherDuplicate" as Parameters<typeof t>[0]
                        ),
                      }
                    : s
                )
              );
            } else {
              const err = await res.json();
              if (err.debug) {
                console.log(
                  "[VoucherUpload] Parse debug for",
                  file.name,
                  err.debug
                );
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

      onUploaded();
      setTimeout(() => setUploadStatuses([]), 5000);
    },
    [t, onUploaded]
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
    <>
      <Button
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        size="sm"
      >
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

      {/* Upload progress overlay */}
      {uploadStatuses.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-20 mt-2 rounded-lg border bg-card p-4 shadow-lg space-y-2">
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
    </>
  );
}
