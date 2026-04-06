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

  // Sort by transporter for grouping
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) =>
      (a.transporterName || "").localeCompare(b.transporterName || "")
    );
  }, [data]);

  const columns = useMemo(
    () => createVoucherColumns(tAny, selection),
    [tAny, selection]
  );

  const table = useReactTable({
    data: sortedData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  // Build group boundaries
  const rows = table.getRowModel().rows;
  const groupStarts = useMemo(() => {
    const starts = new Map<number, string>();
    let lastGroup = "";
    rows.forEach((row, idx) => {
      const group = row.original.transporterName || "—";
      if (group !== lastGroup) {
        starts.set(idx, group);
        lastGroup = group;
      }
    });
    return starts;
  }, [rows]);

  const colCount = columns.length;

  return (
    <div className="flex flex-col rounded-lg border">
      <div className="border-b px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {tAny("fust.vouchersCount")} ({data.length})
        </h3>
      </div>
      <div className="max-h-[calc(100vh-240px)] overflow-y-auto">
        {loading ? (
          <div className="p-3 space-y-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : data.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <RiFileTextLine className="mx-auto mb-2 h-8 w-8 opacity-30" />
            <p className="text-xs">{tAny("fust.noVouchersToMatch")}</p>
          </div>
        ) : (
          <Table className="text-xs">
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className="h-8 px-2 text-[10px]"
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
              {rows.map((row, idx) => {
                const isLinked = row.original.orderLinks.length > 0;
                const isSelected = selection.isSelected(row.original.id);
                const groupLabel = groupStarts.get(idx);

                return (
                  <GroupedRows key={row.id} groupLabel={groupLabel} colCount={colCount}>
                    <TableRow
                      data-state={isSelected ? "selected" : undefined}
                      className={
                        viewMode === "all" && isLinked ? "opacity-50" : ""
                      }
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("[data-slot=checkbox]")) return;
                        selection.toggleRow(row.original.id, e.shiftKey);
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="px-2 py-1.5">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  </GroupedRows>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

// Renders optional group header + row
function GroupedRows({
  groupLabel,
  colCount,
  children,
}: {
  groupLabel?: string;
  colCount: number;
  children: React.ReactNode;
}) {
  return (
    <>
      {groupLabel && (
        <tr className="bg-muted/60">
          <td colSpan={colCount} className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {groupLabel}
          </td>
        </tr>
      )}
      {children}
    </>
  );
}
