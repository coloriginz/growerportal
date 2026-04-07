"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { RiExternalLinkLine, RiLink } from "@remixicon/react";
import { formatDate } from "@/lib/format";
import type { Voucher, OrderRef } from "./types";
import type { UseRangeSelectionReturn } from "./use-range-selection";

// Re-export for convenience
export type { UseRangeSelectionReturn } from "./use-range-selection";

type TranslationFn = (key: string) => string;

// ─── Voucher Columns (no transporter — grouped by it) ──

const voucherHelper = createColumnHelper<Voucher>();

export function createVoucherColumns(
  t: TranslationFn,
  selection: UseRangeSelectionReturn
) {
  return [
    voucherHelper.display({
      id: "select",
      size: 32,
      header: () => (
        <div
          className="flex items-center justify-center cursor-pointer px-1 py-1 -mx-1 -my-1"
          onClick={(e) => { e.stopPropagation(); selection.toggleAll(); }}
        >
          <Checkbox
            checked={selection.allSelected}
            indeterminate={selection.selectedCount > 0 && !selection.allSelected}
            tabIndex={-1}
          />
        </div>
      ),
      cell: ({ row }) => (
        <div
          className="flex items-center justify-center cursor-pointer px-1 py-1 -mx-1 -my-1"
          onClick={(e) => { e.stopPropagation(); selection.toggleRow(row.original.id, e.shiftKey); }}
        >
          <Checkbox
            checked={selection.isSelected(row.original.id)}
            tabIndex={-1}
          />
        </div>
      ),
    }),
    voucherHelper.accessor("transactionNumber", {
      header: () => "#",
      size: 90,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <span className="font-mono">{row.original.transactionNumber}</span>
          {row.original.pdfUrl && (
            <a
              href={row.original.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <RiExternalLinkLine className="h-3 w-3 text-muted-foreground hover:text-foreground" />
            </a>
          )}
        </div>
      ),
    }),
    voucherHelper.accessor("type", {
      header: () => t("common.type"),
      size: 60,
      cell: ({ getValue }) => (
        <Badge
          variant={getValue() === "uitgifte" ? "default" : "secondary"}
          className="text-[10px] px-1.5 h-4"
        >
          {t(`fust.${getValue()}`)}
        </Badge>
      ),
    }),
    voucherHelper.accessor("transactionDate", {
      header: () => t("common.date"),
      size: 80,
      cell: ({ getValue }) => formatDate(getValue()),
    }),
    voucherHelper.display({
      id: "items",
      header: () => t("fust.items"),
      cell: ({ row }) => {
        const summary = row.original.items
          .map((item) => `${Math.abs(item.quantity)}x ${item.description}`)
          .join(", ");
        return (
          <span className="truncate text-muted-foreground" title={summary}>
            {summary || "—"}
          </span>
        );
      },
    }),
    voucherHelper.display({
      id: "status",
      size: 50,
      header: () => "",
      cell: ({ row }) => {
        const count = row.original.orderLinks.length;
        if (count === 0) return null;
        return (
          <Badge variant="outline" className="gap-0.5 text-[10px] px-1.5 h-4">
            <RiLink className="h-2.5 w-2.5" />
            {count}
          </Badge>
        );
      },
    }),
  ];
}

// ─── Order Columns (no grower — grouped by it) ────────

const orderHelper = createColumnHelper<OrderRef>();

export function createOrderColumns(
  t: TranslationFn,
  selection: UseRangeSelectionReturn
) {
  return [
    orderHelper.display({
      id: "select",
      size: 32,
      header: () => (
        <div
          className="flex items-center justify-center cursor-pointer px-1 py-1 -mx-1 -my-1"
          onClick={(e) => { e.stopPropagation(); selection.toggleAll(); }}
        >
          <Checkbox
            checked={selection.allSelected}
            indeterminate={selection.selectedCount > 0 && !selection.allSelected}
            tabIndex={-1}
          />
        </div>
      ),
      cell: ({ row }) => (
        <div
          className="flex items-center justify-center cursor-pointer px-1 py-1 -mx-1 -my-1"
          onClick={(e) => { e.stopPropagation(); selection.toggleRow(row.original.id, e.shiftKey); }}
        >
          <Checkbox
            checked={selection.isSelected(row.original.id)}
            tabIndex={-1}
          />
        </div>
      ),
    }),
    orderHelper.accessor("orderNumber", {
      header: () => t("fust.orderNumber"),
      size: 110,
      cell: ({ getValue }) => (
        <span className="font-mono">{getValue()}</span>
      ),
    }),
    orderHelper.accessor("deliveredAt", {
      header: () => t("fust.delivered"),
      size: 80,
      cell: ({ getValue }) =>
        getValue() ? formatDate(getValue()!) : "—",
    }),
    orderHelper.display({
      id: "items",
      header: () => t("fust.items"),
      cell: ({ row }) => {
        const summary = row.original.items
          .map((item) => `${item.quantity}x ${item.fustType.name}`)
          .join(", ");
        return (
          <span className="truncate text-muted-foreground" title={summary}>
            {summary || "—"}
          </span>
        );
      },
    }),
    orderHelper.display({
      id: "linked",
      size: 50,
      header: () => "",
      cell: ({ row }) => {
        const count = row.original.voucherLinks?.length ?? 0;
        if (count === 0) return null;
        return (
          <Badge variant="outline" className="gap-0.5 text-[10px] px-1.5 h-4">
            <RiLink className="h-2.5 w-2.5" />
            {count}
          </Badge>
        );
      },
    }),
  ];
}
