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

// ─── Voucher Columns ──────────────────────────────────

const voucherHelper = createColumnHelper<Voucher>();

export function createVoucherColumns(
  t: TranslationFn,
  selection: UseRangeSelectionReturn
) {
  return [
    voucherHelper.display({
      id: "select",
      size: 40,
      header: () => (
        <Checkbox
          checked={selection.allSelected}
          indeterminate={selection.selectedCount > 0 && !selection.allSelected}
          onCheckedChange={() => selection.toggleAll()}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={selection.isSelected(row.original.id)}
          onCheckedChange={() => {}}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            selection.toggleRow(row.original.id, e.shiftKey);
          }}
        />
      ),
    }),
    voucherHelper.accessor("transactionNumber", {
      header: () => t("fust.transactionNumber"),
      size: 120,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-sm">#{row.original.transactionNumber}</span>
          {row.original.pdfUrl && (
            <a
              href={row.original.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <RiExternalLinkLine className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
            </a>
          )}
        </div>
      ),
    }),
    voucherHelper.accessor("type", {
      header: () => t("common.type"),
      size: 80,
      cell: ({ getValue }) => (
        <Badge variant={getValue() === "uitgifte" ? "default" : "secondary"}>
          {t(`fust.${getValue()}`)}
        </Badge>
      ),
    }),
    voucherHelper.accessor("transactionDate", {
      header: () => t("fust.transactionDate"),
      size: 100,
      cell: ({ getValue }) => (
        <span className="text-sm">{formatDate(getValue())}</span>
      ),
    }),
    voucherHelper.accessor("transporterName", {
      header: () => t("fust.transporter"),
      cell: ({ getValue }) => (
        <span className="truncate text-sm">{getValue() || "—"}</span>
      ),
    }),
    voucherHelper.display({
      id: "items",
      header: () => t("fust.items"),
      cell: ({ row }) => {
        const summary = row.original.items
          .map((item) => `${Math.abs(item.quantity)}x ${item.description}`)
          .join(", ");
        return (
          <span className="truncate text-sm text-muted-foreground" title={summary}>
            {summary || "—"}
          </span>
        );
      },
    }),
    voucherHelper.display({
      id: "status",
      header: () => t("fust.status"),
      size: 90,
      cell: ({ row }) => {
        const count = row.original.orderLinks.length;
        if (count === 0) return null;
        return (
          <Badge variant="outline" className="gap-1">
            <RiLink className="h-3 w-3" />
            {count}
          </Badge>
        );
      },
    }),
  ];
}

// ─── Order Columns ────────────────────────────────────

const orderHelper = createColumnHelper<OrderRef>();

export function createOrderColumns(
  t: TranslationFn,
  selection: UseRangeSelectionReturn
) {
  return [
    orderHelper.display({
      id: "select",
      size: 40,
      header: () => (
        <Checkbox
          checked={selection.allSelected}
          indeterminate={selection.selectedCount > 0 && !selection.allSelected}
          onCheckedChange={() => selection.toggleAll()}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={selection.isSelected(row.original.id)}
          onCheckedChange={() => {}}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            selection.toggleRow(row.original.id, e.shiftKey);
          }}
        />
      ),
    }),
    orderHelper.accessor("orderNumber", {
      header: () => t("fust.orderNumber"),
      size: 120,
      cell: ({ getValue }) => (
        <span className="font-mono text-sm">{getValue()}</span>
      ),
    }),
    orderHelper.display({
      id: "grower",
      header: () => t("fust.grower"),
      cell: ({ row }) => {
        const g = row.original.grower;
        return (
          <span className="truncate text-sm">
            <span className="font-medium">{g.code}</span>
            <span className="ml-1.5 text-muted-foreground">
              {g.company || g.name}
            </span>
          </span>
        );
      },
    }),
    orderHelper.accessor("deliveredAt", {
      header: () => t("fust.delivered"),
      size: 100,
      cell: ({ getValue }) => (
        <span className="text-sm">
          {getValue() ? formatDate(getValue()!) : "—"}
        </span>
      ),
    }),
    orderHelper.display({
      id: "items",
      header: () => t("fust.items"),
      cell: ({ row }) => {
        const summary = row.original.items
          .map((item) => `${item.quantity}x ${item.fustType.name}`)
          .join(", ");
        return (
          <span className="truncate text-sm text-muted-foreground" title={summary}>
            {summary || "—"}
          </span>
        );
      },
    }),
    orderHelper.display({
      id: "linked",
      header: () => "",
      size: 70,
      cell: ({ row }) => {
        const count = row.original.voucherLinks?.length ?? 0;
        if (count === 0) return null;
        return (
          <Badge variant="outline" className="gap-1">
            <RiLink className="h-3 w-3" />
            {count}
          </Badge>
        );
      },
    }),
  ];
}
