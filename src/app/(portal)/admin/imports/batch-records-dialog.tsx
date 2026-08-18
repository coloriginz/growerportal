"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RiDatabase2Line, RiInformationLine } from "@remixicon/react";
import { useFetch } from "@/hooks/use-fetch";
import { formatCurrencyDetailed, formatDate, formatNumber, formatTime } from "@/lib/format";
import type { ImportBatch } from "./shared";

export type RecordMode = "created" | "updated";

interface LotRecord {
  id: string;
  lotNumber: string;
  supplierCode: string;
  supplierName: string;
  productName: string;
  articleGroup: string;
  totalStems: number;
  deliveryDate: string;
}

interface TransactionRecord {
  id: string;
  lotId: string;
  lotNumber: string;
  supplierCode: string;
  supplierName: string;
  ordregId: number | null;
  date: string;
  salesType: string;
  stems: number;
  amount: number;
}

interface GrowerRecord {
  id: string;
  supplierId: string;
  code: string | null;
  name: string | null;
  country: string | null;
  city: string | null;
  supplierCode: string;
  supplierName: string;
}

interface CostRecord {
  id: string;
  salesSheetId: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplierCode: string;
  supplierName: string;
  description: string;
  costTypeCode: string | null;
  amount: number;
}

interface RecordsResponseBase {
  batchId: string;
  endpoint: string;
  startedAt: string;
  /** Waarom het getal in de tabel niet hetzelfde telt als deze lijst. */
  note: string | null;
  mode: RecordMode;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  counts: { created: number; updated: number };
}

/** `kind` zegt welk model de rijen zijn; null betekent dat dit endpoint er geen draagt. */
type RecordsResponse = RecordsResponseBase &
  (
    | { kind: "lots"; reason: null; records: LotRecord[] }
    | { kind: "orders"; reason: null; records: TransactionRecord[] }
    | { kind: "growers"; reason: null; records: GrowerRecord[] }
    | { kind: "costs"; reason: null; records: CostRecord[] }
    | { kind: null; reason: string; records: never[] }
  );

interface Column<T> {
  label: string;
  align?: "right";
  cell: (row: T) => React.ReactNode;
}

const dash = <span className="text-muted-foreground">-</span>;

function DetailLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-primary hover:underline">
      {children}
    </Link>
  );
}

function SupplierCell({ code, name }: { code: string; name: string }) {
  return (
    <>
      <span className="font-mono">{code}</span>
      <span className="ml-2 text-muted-foreground">{name}</span>
    </>
  );
}

const LOT_COLUMNS: Column<LotRecord>[] = [
  { label: "Lot", cell: (r) => <DetailLink href={`/lots/${r.id}`}>{r.lotNumber}</DetailLink> },
  { label: "Supplier", cell: (r) => <SupplierCell code={r.supplierCode} name={r.supplierName} /> },
  { label: "Article", cell: (r) => r.productName },
  { label: "Group", cell: (r) => r.articleGroup },
  { label: "Stems", align: "right", cell: (r) => formatNumber(r.totalStems) },
  { label: "Delivery", align: "right", cell: (r) => formatDate(r.deliveryDate) },
];

// Een orderregel heeft geen eigen pagina; de partij waar hij op zit wel.
const TRANSACTION_COLUMNS: Column<TransactionRecord>[] = [
  {
    label: "Lot",
    cell: (r) => <DetailLink href={`/lots/${r.lotId}`}>{r.lotNumber}</DetailLink>,
  },
  { label: "Supplier", cell: (r) => <SupplierCell code={r.supplierCode} name={r.supplierName} /> },
  { label: "Ordreg", cell: (r) => (r.ordregId === null ? dash : String(r.ordregId)) },
  { label: "Channel", cell: (r) => r.salesType },
  { label: "Stems", align: "right", cell: (r) => formatNumber(r.stems) },
  { label: "Amount", align: "right", cell: (r) => formatCurrencyDetailed(r.amount) },
  { label: "Date", align: "right", cell: (r) => formatDate(r.date) },
];

// Een kweker heeft geen eigen pagina; de leverancier waar hij onder hangt wel.
const GROWER_COLUMNS: Column<GrowerRecord>[] = [
  { label: "Code", cell: (r) => (r.code ? <span className="font-mono">{r.code}</span> : dash) },
  { label: "Name", cell: (r) => r.name ?? dash },
  { label: "Country", cell: (r) => r.country ?? dash },
  { label: "City", cell: (r) => r.city ?? dash },
  {
    label: "Supplier",
    cell: (r) => (
      <DetailLink href={`/suppliers/${r.supplierId}`}>
        <SupplierCell code={r.supplierCode} name={r.supplierName} />
      </DetailLink>
    ),
  },
];

const COST_COLUMNS: Column<CostRecord>[] = [
  {
    label: "Sales sheet",
    cell: (r) => <DetailLink href={`/shipments/${r.salesSheetId}`}>{r.invoiceNumber}</DetailLink>,
  },
  { label: "Supplier", cell: (r) => <SupplierCell code={r.supplierCode} name={r.supplierName} /> },
  { label: "Cost", cell: (r) => r.description },
  { label: "Type", cell: (r) => r.costTypeCode ?? dash },
  { label: "Amount", align: "right", cell: (r) => formatCurrencyDetailed(r.amount) },
  { label: "Invoice date", align: "right", cell: (r) => formatDate(r.invoiceDate) },
];

function RecordTable<T extends { id: string }>({
  rows,
  columns,
}: {
  rows: T[];
  columns: Column<T>[];
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th
                key={column.label}
                className={`px-3 py-1.5 font-medium ${column.align === "right" ? "text-right" : "text-left"}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t">
              {columns.map((column) => (
                <td
                  key={column.label}
                  className={`px-3 py-1.5 whitespace-nowrap ${column.align === "right" ? "text-right" : ""}`}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Welke records een ronde heeft aangeraakt. De twee tabs tonen dezelfde query
 * met een andere kant van de starttijd van de batch; de aantallen erachter komen
 * uit hetzelfde antwoord, zodat ze niet uit de pas kunnen lopen met de lijst.
 */
export function BatchRecordsDialog({
  batch,
  initialMode,
  onClose,
}: {
  batch: ImportBatch;
  initialMode: RecordMode;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<RecordMode>(initialMode);
  const [page, setPage] = useState(1);

  const url = useMemo(
    () => `/api/admin/import-batches/${batch.id}/records?mode=${mode}&page=${page}`,
    [batch.id, mode, page]
  );
  const { data, loading, error } = useFetch<RecordsResponse>(url);

  const changeMode = (next: RecordMode) => {
    setMode(next);
    setPage(1);
  };

  const counts = data?.counts ?? { created: 0, updated: 0 };
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const pageStart = total === 0 ? 0 : (page - 1) * (data?.pageSize ?? 50) + 1;
  const pageEnd = Math.min(page * (data?.pageSize ?? 50), total);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-5xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RiDatabase2Line className="h-5 w-5 text-muted-foreground" />
            Records touched — {batch.endpoint}
          </DialogTitle>
          <DialogDescription>
            {formatDate(batch.startedAt)} {formatTime(batch.startedAt)}
            {batch.job && <> &middot; {batch.job.source} round</>}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(value) => changeMode(value === "updated" ? "updated" : "created")}>
          <TabsList>
            <TabsTrigger value="created">Created ({formatNumber(counts.created)})</TabsTrigger>
            <TabsTrigger value="updated">Updated ({formatNumber(counts.updated)})</TabsTrigger>
          </TabsList>
        </Tabs>

        {data?.note && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <RiInformationLine className="mt-px h-3.5 w-3.5 shrink-0" />
            {data.note}
          </p>
        )}

        {loading && !data ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
        ) : error ? (
          <p className="py-8 text-center text-sm text-red-600 dark:text-red-400">
            Failed to load the records of this run.
          </p>
        ) : !data ? null : data.kind === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{data.reason}</p>
        ) : data.records.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            This run {mode === "created" ? "created" : "updated"} no records that still carry its
            origin — a later run may have overwritten them.
          </p>
        ) : (
          <div className="space-y-3">
            {data.kind === "lots" && <RecordTable rows={data.records} columns={LOT_COLUMNS} />}
            {data.kind === "orders" && (
              <RecordTable rows={data.records} columns={TRANSACTION_COLUMNS} />
            )}
            {data.kind === "growers" && (
              <RecordTable rows={data.records} columns={GROWER_COLUMNS} />
            )}
            {data.kind === "costs" && <RecordTable rows={data.records} columns={COST_COLUMNS} />}

            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {pageStart}-{pageEnd} of {formatNumber(total)}
              </p>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || loading}
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages || loading}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
