"use client";

import { useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from "@tanstack/react-table";
import { useLanguage } from "@/components/providers/language-provider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { RiFileTextLine } from "@remixicon/react";
import { createVoucherColumns } from "./columns";
import type { Voucher, ViewMode } from "./types";
import type { UseRangeSelectionReturn } from "./use-range-selection";

interface VoucherTableProps {
  data: Voucher[];
  loading: boolean;
  selection: UseRangeSelectionReturn;
  viewMode: ViewMode;
}

export function VoucherTable({
  data,
  loading,
  selection,
  viewMode,
}: VoucherTableProps) {
  const { t } = useLanguage();
  const tAny = t as unknown as (key: string) => string;

  const columns = useMemo(
    () => createVoucherColumns(tAny, selection),
    [tAny, selection]
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  return (
    <div className="flex flex-col rounded-lg border">
      <div className="border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {tAny("fust.vouchersCount")} ({data.length})
        </h3>
      </div>
      <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
        {loading ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : data.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <RiFileTextLine className="mx-auto mb-2 h-8 w-8 opacity-30" />
            <p className="text-sm">{tAny("fust.noVouchersToMatch")}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      style={{
                        width: header.getSize() !== 150 ? header.getSize() : undefined,
                      }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody className="select-none">
              {table.getRowModel().rows.map((row) => {
                const isLinked = row.original.orderLinks.length > 0;
                const isSelected = selection.isSelected(row.original.id);
                return (
                  <TableRow
                    key={row.id}
                    data-state={isSelected ? "selected" : undefined}
                    className={
                      viewMode === "all" && isLinked ? "opacity-50" : ""
                    }
                    onClick={(e) => {
                      // Don't trigger on checkbox click (handled by checkbox onClick)
                      if ((e.target as HTMLElement).closest("[data-slot=checkbox]")) return;
                      selection.toggleRow(row.original.id, e.shiftKey);
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
