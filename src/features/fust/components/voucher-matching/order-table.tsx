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
import { createOrderColumns } from "./columns";
import type { OrderRef } from "./types";
import type { UseRangeSelectionReturn } from "./use-range-selection";

interface OrderTableProps {
  data: OrderRef[];
  loading: boolean;
  selection: UseRangeSelectionReturn;
}

export function OrderTable({ data, loading, selection }: OrderTableProps) {
  const { t } = useLanguage();
  const tAny = t as unknown as (key: string) => string;

  // Sort by supplier code for grouping
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) =>
      a.supplier.code.localeCompare(b.supplier.code)
    );
  }, [data]);

  const columns = useMemo(
    () => createOrderColumns(tAny, selection),
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
    const starts = new Map<number, { code: string; label: string }>();
    let lastCode = "";
    rows.forEach((row, idx) => {
      const g = row.original.supplier;
      if (g.code !== lastCode) {
        starts.set(idx, {
          code: g.code,
          label: `${g.code} — ${g.company || g.name}`,
        });
        lastCode = g.code;
      }
    });
    return starts;
  }, [rows]);

  const colCount = columns.length;

  return (
    <div className="flex flex-col rounded-lg border">
      <div className="border-b px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {tAny("fust.ordersCount")} ({data.length})
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
            <p className="text-xs">{tAny("fust.noOrdersToMatch")}</p>
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
                const isSelected = selection.isSelected(row.original.id);
                const group = groupStarts.get(idx);

                return (
                  <GroupedRows key={row.id} groupLabel={group?.label} colCount={colCount}>
                    <TableRow
                      data-state={isSelected ? "selected" : undefined}
                      onClick={(e) => {
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
