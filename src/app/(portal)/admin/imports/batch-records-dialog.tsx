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
import { Pagination } from "@/components/pagination";
import { pageLabels } from "@/components/pagination-labels";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RiDatabase2Line, RiInformationLine } from "@remixicon/react";
import { useFetch } from "@/hooks/use-fetch";
import { formatCurrencyDetailed, formatDate, formatNumber, formatTime } from "@/lib/format";
import type { ImportBatch } from "./shared";

export type RecordMode = "created" | "updated";

interface LotRecord {
  type: "lot";
  id: string;
  lotNumber: string;
  supplierCode: string;
  supplierName: string;
  productName: string;
  articleGroup: string;
  totalStems: number;
  deliveryDate: string;
}

interface CorrectionRecord {
  type: "correction";
  id: string;
  lotId: string;
  lotNumber: string;
  supplierCode: string;
  supplierName: string;
  productName: string;
  facttypeSub: string;
  reason: string | null;
  reasonCode: string | null;
  correctionVolume: number | null;
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
  /** Waarom het getal in de tabel niet hetzelfde telt als deze lijst; leeg als het klopt. */
  notes: string[];
  mode: RecordMode;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Wat de batch zelf meldt, tegenover `counts`: wat er nog te vinden is. */
  reported: { created: number; updated: number };
  counts: { created: number; updated: number };
}

/** `kind` zegt welk model de rijen zijn; null betekent dat dit endpoint er geen draagt. */
type RecordsResponse = RecordsResponseBase &
  (
    | { kind: "lots"; reason: null; records: (LotRecord | CorrectionRecord)[] }
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

// Een correctie heeft geen eigen pagina; hij verwijst naar de partij waar hij
// bij hoort. De reden komt uit de redencodetabel; ontbreekt die, dan valt hij
// terug op het facttype dat Fabric meestuurt.
const CORRECTION_COLUMNS: Column<CorrectionRecord>[] = [
  { label: "Lot", cell: (r) => <DetailLink href={`/lots/${r.lotId}`}>{r.lotNumber}</DetailLink> },
  { label: "Supplier", cell: (r) => <SupplierCell code={r.supplierCode} name={r.supplierName} /> },
  { label: "Article", cell: (r) => r.productName },
  {
    label: "Reason",
    cell: (r) => (
      <>
        {r.reason ?? r.facttypeSub}
        {r.reasonCode && <span className="ml-2 text-muted-foreground">({r.reasonCode})</span>}
      </>
    ),
  },
  {
    label: "Volume",
    align: "right",
    cell: (r) => (r.correctionVolume === null ? dash : formatNumber(r.correctionVolume)),
  },
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
 * Een lots-ronde raakt partijen én partijcorrecties aan, en telt ze allebei mee
 * in zijn aantallen. De route zet de partijen vooraan en de correcties erachter;
 * hier komen ze in twee tabellen te staan, want ze beschrijven iets anders. Een
 * kop verschijnt alleen als beide op deze pagina staan.
 */
function LotTables({ records }: { records: (LotRecord | CorrectionRecord)[] }) {
  const lots = records.filter((r): r is LotRecord => r.type === "lot");
  const corrections = records.filter((r): r is CorrectionRecord => r.type === "correction");
  const both = lots.length > 0 && corrections.length > 0;

  return (
    <div className="space-y-3">
      {lots.length > 0 && (
        <div className="space-y-1.5">
          {both && <p className="text-xs font-medium">Lots</p>}
          <RecordTable rows={lots} columns={LOT_COLUMNS} />
        </div>
      )}
      {corrections.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Lot corrections</p>
          <RecordTable rows={corrections} columns={CORRECTION_COLUMNS} />
        </div>
      )}
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

        {/* De opmerkingen verklaren het verschil tussen het aantal in de tabel en
            wat hier staat; de route stelt ze op voor het geopende tabblad. */}
        {data?.notes.map((note) => (
          <p key={note} className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <RiInformationLine className="mt-px h-3.5 w-3.5 shrink-0" />
            {note}
          </p>
        ))}

        {loading && !data ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
        ) : error ? (
          <p className="py-8 text-center text-sm text-red-600 dark:text-red-400">
            Failed to load the records of this run.
          </p>
        ) : !data ? null : data.kind === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{data.reason}</p>
        ) : data.records.length === 0 ? (
          // Meldde de ronde hier zelf niets, dan valt er ook niets te verklaren;
          // anders staat de verklaring al in de opmerkingen hierboven.
          <p className="py-8 text-center text-sm text-muted-foreground">
            {data.reported[mode] === 0
              ? `This run ${mode} no records.`
              : "No records to list; the note above explains why."}
          </p>
        ) : (
          <div className="space-y-3">
            {data.kind === "lots" && <LotTables records={data.records} />}
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
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                labels={pageLabels}
                disabled={loading}
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
