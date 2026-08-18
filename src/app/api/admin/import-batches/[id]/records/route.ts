import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

const PAGE_SIZE = 50;

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  mode: z.enum(["created", "updated"]).default("created"),
});

/** Welk model de herkomst van dit endpoint draagt. `suppliers` draagt hem niet. */
const KIND_BY_ENDPOINT = {
  lots: "lots",
  orders: "orders",
  growers: "growers",
  costs: "costs",
} as const;

type Kind = (typeof KIND_BY_ENDPOINT)[keyof typeof KIND_BY_ENDPOINT];

function isKnownEndpoint(endpoint: string): endpoint is keyof typeof KIND_BY_ENDPOINT {
  return endpoint in KIND_BY_ENDPOINT;
}

/**
 * De records die één ronde heeft aangeraakt, gescheiden in aangemaakt en
 * bijgewerkt. Die scheiding is afgeleid en niet opgeslagen: een record waarvan
 * `createdAt` op of ná de starttijd van de batch ligt is door die batch
 * aangemaakt, de rest bestond al. Dat klopt per definitie zolang de batch de
 * laatste is die het record aanraakte — en dat is precies wat
 * `lastImportBatchId` zegt.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const { id } = await params;
  const searchParams = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    page: searchParams.get("page") ?? undefined,
    mode: searchParams.get("mode") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid page or mode" }, { status: 400 });
  }
  const { page, mode } = parsed.data;

  const batch = await prisma.importBatch.findUnique({
    where: { id },
    select: {
      id: true,
      endpoint: true,
      startedAt: true,
      recordsCreated: true,
      recordsUpdated: true,
      details: true,
    },
  });
  if (!batch) {
    return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
  }

  const empty = (reason: string) =>
    NextResponse.json({
      batchId: batch.id,
      endpoint: batch.endpoint,
      startedAt: batch.startedAt,
      kind: null,
      reason,
      note: null,
      mode,
      page: 1,
      pageSize: PAGE_SIZE,
      total: 0,
      totalPages: 1,
      counts: { created: 0, updated: 0 },
      records: [],
    });

  if (batch.endpoint === "suppliers") {
    return empty(
      "Suppliers do not carry an import origin: every run rewrites all of them, so the list would be the whole supplier table."
    );
  }
  if (!isKnownEndpoint(batch.endpoint)) {
    return empty(`No model carries the origin of a "${batch.endpoint}" run.`);
  }

  const kind: Kind = KIND_BY_ENDPOINT[batch.endpoint];
  const createdFilter = { gte: batch.startedAt };
  const updatedFilter = { lt: batch.startedAt };
  const createdAt = mode === "created" ? createdFilter : updatedFilter;
  const skip = (page - 1) * PAGE_SIZE;

  const [counts, records] = await Promise.all([
    countRecords(kind, id, createdFilter, updatedFilter),
    fetchRecords(kind, id, createdAt, skip),
  ]);

  const total = mode === "created" ? counts.created : counts.updated;

  return NextResponse.json({
    batchId: batch.id,
    endpoint: batch.endpoint,
    startedAt: batch.startedAt,
    kind,
    reason: null,
    note: divergenceNote(batch, counts.created),
    mode,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(Math.ceil(total / PAGE_SIZE), 1),
    counts,
    records,
  });
}

/**
 * Waarom het getal in de tabel niet hetzelfde telt als deze lijst. Alleen de
 * lots-ronde loopt uiteen: die rekent aangemaakte partijcorrecties mee in
 * `recordsCreated`, en die landen in `LotCorrection` — een tabel zonder
 * herkomstkolom. Zonder deze regel lijkt het verschil een gat in de data.
 */
function divergenceNote(
  batch: { endpoint: string; recordsCreated: number; details: unknown },
  created: number
): string | null {
  if (batch.endpoint !== "lots" || batch.recordsCreated === created) return null;
  const details = batch.details as { corrections?: { created?: number } } | null;
  const corrections = details?.corrections?.created;
  return (
    `The run reports ${batch.recordsCreated} created` +
    (typeof corrections === "number" ? `, of which ${corrections} are lot corrections` : "") +
    ". Corrections live in a separate table that carries no origin, so only the lots are listed here."
  );
}

type DateFilter = { gte: Date } | { lt: Date };

async function countRecords(
  kind: Kind,
  batchId: string,
  createdFilter: DateFilter,
  updatedFilter: DateFilter
): Promise<{ created: number; updated: number }> {
  const count = (createdAt: DateFilter) => {
    const where = { lastImportBatchId: batchId, createdAt };
    switch (kind) {
      case "lots":
        return prisma.lot.count({ where });
      case "orders":
        return prisma.transaction.count({ where });
      case "growers":
        return prisma.grower.count({ where });
      case "costs":
        return prisma.salesSheetCost.count({ where });
    }
  };
  const [created, updated] = await Promise.all([count(createdFilter), count(updatedFilter)]);
  return { created, updated };
}

interface LotRecord {
  id: string;
  lotNumber: string;
  supplierCode: string;
  supplierName: string;
  productName: string;
  articleGroup: string;
  totalStems: number;
  deliveryDate: Date;
}

interface TransactionRecord {
  id: string;
  lotId: string;
  lotNumber: string;
  supplierCode: string;
  supplierName: string;
  ordregId: number | null;
  date: Date;
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
  invoiceDate: Date;
  supplierCode: string;
  supplierName: string;
  description: string;
  costTypeCode: string | null;
  amount: number;
}

async function fetchRecords(
  kind: Kind,
  batchId: string,
  createdAt: DateFilter,
  skip: number
): Promise<LotRecord[] | TransactionRecord[] | GrowerRecord[] | CostRecord[]> {
  const where = { lastImportBatchId: batchId, createdAt };
  const page = { skip, take: PAGE_SIZE };

  switch (kind) {
    case "lots": {
      const rows = await prisma.lot.findMany({
        where,
        ...page,
        orderBy: [{ supplier: { code: "asc" } }, { deliveryDate: "asc" }, { lotNumber: "asc" }],
        select: {
          id: true,
          lotNumber: true,
          productName: true,
          articleGroup: true,
          totalStems: true,
          deliveryDate: true,
          supplier: { select: { code: true, name: true } },
        },
      });
      return rows.map(({ supplier, ...lot }) => ({
        ...lot,
        supplierCode: supplier.code,
        supplierName: supplier.name,
      }));
    }
    case "orders": {
      const rows = await prisma.transaction.findMany({
        where,
        ...page,
        orderBy: [{ lot: { supplier: { code: "asc" } } }, { date: "asc" }, { fabricOrdregId: "asc" }],
        select: {
          id: true,
          fabricOrdregId: true,
          date: true,
          salesType: true,
          stems: true,
          amount: true,
          lot: {
            select: { id: true, lotNumber: true, supplier: { select: { code: true, name: true } } },
          },
        },
      });
      return rows.map((tx) => ({
        id: tx.id,
        lotId: tx.lot.id,
        lotNumber: tx.lot.lotNumber,
        supplierCode: tx.lot.supplier.code,
        supplierName: tx.lot.supplier.name,
        ordregId: tx.fabricOrdregId,
        date: tx.date,
        salesType: tx.salesType,
        stems: tx.stems,
        amount: Number(tx.amount),
      }));
    }
    case "growers": {
      const rows = await prisma.grower.findMany({
        where,
        ...page,
        orderBy: [{ supplier: { code: "asc" } }, { name: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          country: true,
          city: true,
          supplier: { select: { id: true, code: true, name: true } },
        },
      });
      return rows.map(({ supplier, ...grower }) => ({
        ...grower,
        supplierId: supplier.id,
        supplierCode: supplier.code,
        supplierName: supplier.name,
      }));
    }
    case "costs": {
      const rows = await prisma.salesSheetCost.findMany({
        where,
        ...page,
        orderBy: [
          { salesSheet: { supplier: { code: "asc" } } },
          { salesSheet: { invoiceDate: "asc" } },
          { description: "asc" },
        ],
        select: {
          id: true,
          description: true,
          costTypeCode: true,
          amount: true,
          salesSheet: {
            select: {
              id: true,
              invoiceNumber: true,
              invoiceDate: true,
              supplier: { select: { code: true, name: true } },
            },
          },
        },
      });
      return rows.map((cost) => ({
        id: cost.id,
        salesSheetId: cost.salesSheet.id,
        invoiceNumber: cost.salesSheet.invoiceNumber,
        invoiceDate: cost.salesSheet.invoiceDate,
        supplierCode: cost.salesSheet.supplier.code,
        supplierName: cost.salesSheet.supplier.name,
        description: cost.description,
        costTypeCode: cost.costTypeCode,
        amount: Number(cost.amount),
      }));
    }
  }
}
