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
type Mode = z.infer<typeof querySchema>["mode"];

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

  const reported = { created: batch.recordsCreated, updated: batch.recordsUpdated };

  const empty = (reason: string) =>
    NextResponse.json({
      batchId: batch.id,
      endpoint: batch.endpoint,
      startedAt: batch.startedAt,
      kind: null,
      reason,
      notes: [],
      mode,
      page: 1,
      pageSize: PAGE_SIZE,
      total: 0,
      totalPages: 1,
      reported,
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
  // Een orderregel-import gooit alles binnen zijn venster weg en zet het opnieuw
  // neer, dus elke rij is vers en de scheiding hierboven zegt niets meer. Beide
  // tabbladen tonen dan dezelfde lijst: alles wat deze ronde schreef. De
  // verdeling nieuw/gewijzigd staat wél in de totalen — die komt uit het aantal
  // verwijderde rijen, niet uit de rijen zelf.
  const rewritesEverything = kind === "orders";
  const createdAt = rewritesEverything
    ? createdFilter
    : mode === "created"
      ? createdFilter
      : updatedFilter;
  const skip = (page - 1) * PAGE_SIZE;

  // De telling gaat vooraf aan het ophalen omdat een lots-ronde twee tabellen
  // achter elkaar plakt: hoeveel partijen er in deze modus zijn bepaalt waar de
  // correcties op de pagina beginnen.
  const counts = await countRecords(kind, id, createdFilter, updatedFilter);
  const listMode: Mode = rewritesEverything ? "created" : mode;
  const records = await fetchRecords(kind, id, createdAt, skip, counts.primary[listMode]);

  const total = counts[listMode];

  return NextResponse.json({
    batchId: batch.id,
    endpoint: batch.endpoint,
    startedAt: batch.startedAt,
    kind,
    reason: null,
    notes: rewriteNotes(kind, batch.details, reported).concat(
      // Bij een herschrijvende import zegt het verschil tussen gemeld en
      // getoond niets over een latere ronde: de lijst is dan bewust de hele
      // ronde in plaats van één helft ervan.
      rewritesEverything ? [] : divergenceNotes(mode, reported[mode], total, rewrittenCount(kind, batch.details))
    ),
    mode,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(Math.ceil(total / PAGE_SIZE), 1),
    reported,
    counts: { created: counts.created, updated: counts.updated },
    records,
  });
}

/**
 * Waarom het getal in de tabel hoger ligt dan wat deze lijst toont.
 * `lastImportBatchId` houdt maar één ronde vast, dus een latere ronde neemt de
 * herkomst over van alles wat hij opnieuw aanraakte; wat die ronde eerder
 * aanraakte is dan niet meer aan hem toe te schrijven.
 */
function divergenceNotes(
  mode: Mode,
  reported: number,
  found: number,
  rewritten: number
): string[] {
  const gap = reported - found;
  if (gap <= 0) return [];

  // Herschreven records dragen een verse aanmaakdatum en staan daardoor onder
  // "created", hoe ze ook geteld zijn. Wie dat niet zegt, schrijft het gat toe
  // aan een latere ronde en stuurt de lezer de verkeerde kant op.
  if (mode === "updated" && rewritten > 0) {
    const rest = gap - rewritten;
    const eerste =
      `The run reports ${reported} updated; this list has ${found}. ` +
      `${rewritten} of them were rewritten rather than edited in place, so they carry a fresh ` +
      "creation date and appear under created.";
    return rest > 0
      ? [
          eerste,
          `A later run has touched the remaining ${rest} record${rest === 1 ? "" : "s"} again ` +
            "and now carries their origin.",
        ]
      : [eerste];
  }

  return [
    `The run reports ${reported} ${mode}; this list has ${found}. ` +
      `A later run has touched the other ${gap} record${gap === 1 ? "" : "s"} ` +
      "again and now carries their origin.",
  ];
}

/** Hoeveel records deze ronde overschreef in plaats van bijwerkte. */
function rewrittenCount(kind: Kind, details: unknown): number {
  if (!details || typeof details !== "object") return 0;
  const d = details as Record<string, unknown>;
  if (kind === "orders") return typeof d.txDeleted === "number" ? d.txDeleted : 0;
  if (kind === "lots") {
    const corrections = d.corrections;
    if (corrections && typeof corrections === "object") {
      const c = corrections as Record<string, unknown>;
      return typeof c.updated === "number" ? c.updated : 0;
    }
  }
  return 0;
}

/**
 * De uitleg bovenaan een lijst van een import die alles opnieuw wegschrijft.
 * Zonder deze regel lijkt het alsof een ronde over een smal venster honderden
 * regels vond die de vorige ronde gemist had.
 */
function rewriteNotes(
  kind: Kind,
  details: unknown,
  reported: { created: number; updated: number }
): string[] {
  if (kind !== "orders") return [];
  const rewritten = rewrittenCount(kind, details);
  const written = reported.created + reported.updated;
  if (written === 0) return [];

  return [
    `This run wrote ${written} row${written === 1 ? "" : "s"}: ${reported.created} that were not ` +
      `there before and ${rewritten} that replaced an existing row. The orders import deletes and ` +
      "reinserts everything inside its window, so a row cannot say afterwards which of the two it " +
      "was — both tabs show the same list.",
  ];
}

type DateFilter = { gte: Date } | { lt: Date };

interface Counts {
  created: number;
  updated: number;
  /** Zonder de correcties. Bij een lots-ronde staan die achter de partijen in de
   *  lijst, en dit getal zegt dus waar die reeks begint; bij de andere endpoints
   *  is het gelijk aan de totalen. */
  primary: { created: number; updated: number };
}

async function countRecords(
  kind: Kind,
  batchId: string,
  createdFilter: DateFilter,
  updatedFilter: DateFilter
): Promise<Counts> {
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
  const countCorrections = (createdAt: DateFilter) =>
    kind === "lots"
      ? prisma.lotCorrection.count({ where: { lastImportBatchId: batchId, createdAt } })
      : Promise.resolve(0);

  const [created, updated, corrCreated, corrUpdated] = await Promise.all([
    count(createdFilter),
    count(updatedFilter),
    countCorrections(createdFilter),
    countCorrections(updatedFilter),
  ]);
  return {
    created: created + corrCreated,
    updated: updated + corrUpdated,
    primary: { created, updated },
  };
}

interface LotRecord {
  type: "lot";
  id: string;
  lotNumber: string;
  supplierCode: string;
  supplierName: string;
  productName: string;
  articleGroup: string;
  totalStems: number;
  deliveryDate: Date;
}

/** Een correctie heeft geen eigen pagina; hij verwijst naar de partij waar hij
 *  bij hoort, en leent daar ook zijn artikel en leverdatum van. */
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
  skip: number,
  primaryTotal: number
): Promise<
  (LotRecord | CorrectionRecord)[] | TransactionRecord[] | GrowerRecord[] | CostRecord[]
> {
  const where = { lastImportBatchId: batchId, createdAt };
  const page = { skip, take: PAGE_SIZE };

  // `id` sluit elke sortering af: bij een niet-unieke sleutel mag Postgres rijen
  // met dezelfde waarde elke keer anders ordenen, en dan springt er met OFFSET
  // een rij naar twee pagina's of naar geen enkele.
  switch (kind) {
    case "lots":
      return fetchLotRecords(batchId, createdAt, skip, primaryTotal);
    case "orders": {
      const rows = await prisma.transaction.findMany({
        where,
        ...page,
        orderBy: [
          { lot: { supplier: { code: "asc" } } },
          { date: "asc" },
          { fabricOrdregId: "asc" },
          { id: "asc" },
        ],
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
        orderBy: [{ supplier: { code: "asc" } }, { name: "asc" }, { id: "asc" }],
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
          { id: "asc" },
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

/**
 * Een lots-ronde verwerkt twee soorten rijen: partijen en correcties. Ze tellen
 * allebei mee in `recordsCreated`, dus staan ze ook allebei in deze lijst — de
 * partijen eerst, de correcties erachter. Die vaste volgorde maakt de
 * paginering over twee tabellen deterministisch: tot `lotTotal` komt de rij uit
 * `Lot`, daarna uit `LotCorrection`.
 *
 * Correcties komen in de praktijk alleen op het tabblad Created voor: de import
 * verwijdert ze en voegt ze opnieuw in, dus een correctie die deze ronde als
 * herkomst draagt is er ook door aangemaakt. Het filter op `createdAt` staat er
 * toch, zodat de scheiding dezelfde regel volgt als bij de andere modellen.
 */
async function fetchLotRecords(
  batchId: string,
  createdAt: DateFilter,
  skip: number,
  lotTotal: number
): Promise<(LotRecord | CorrectionRecord)[]> {
  const where = { lastImportBatchId: batchId, createdAt };
  const lotTake = Math.max(0, Math.min(PAGE_SIZE, lotTotal - skip));
  const correctionTake = PAGE_SIZE - lotTake;

  const [lots, corrections] = await Promise.all([
    lotTake === 0
      ? []
      : prisma.lot.findMany({
          where,
          skip: Math.min(skip, lotTotal),
          take: lotTake,
          orderBy: [
            { supplier: { code: "asc" } },
            { deliveryDate: "asc" },
            { lotNumber: "asc" },
            { id: "asc" },
          ],
          select: {
            id: true,
            lotNumber: true,
            productName: true,
            articleGroup: true,
            totalStems: true,
            deliveryDate: true,
            supplier: { select: { code: true, name: true } },
          },
        }),
    correctionTake === 0
      ? []
      : prisma.lotCorrection.findMany({
          where,
          skip: Math.max(0, skip - lotTotal),
          take: correctionTake,
          orderBy: [
            { lot: { supplier: { code: "asc" } } },
            { lot: { deliveryDate: "asc" } },
            { lot: { lotNumber: "asc" } },
            { id: "asc" },
          ],
          select: {
            id: true,
            facttypeSub: true,
            correctionVolume: true,
            correctionReason: { select: { code: true, nameEn: true, nameNl: true } },
            lot: {
              select: {
                id: true,
                lotNumber: true,
                productName: true,
                deliveryDate: true,
                supplier: { select: { code: true, name: true } },
              },
            },
          },
        }),
  ]);

  return [
    ...lots.map(({ supplier, ...lot }): LotRecord => ({
      type: "lot",
      ...lot,
      supplierCode: supplier.code,
      supplierName: supplier.name,
    })),
    ...corrections.map(
      (correction): CorrectionRecord => ({
        type: "correction",
        id: correction.id,
        lotId: correction.lot.id,
        lotNumber: correction.lot.lotNumber,
        supplierCode: correction.lot.supplier.code,
        supplierName: correction.lot.supplier.name,
        productName: correction.lot.productName,
        facttypeSub: correction.facttypeSub,
        reason: correction.correctionReason
          ? correction.correctionReason.nameEn || correction.correctionReason.nameNl
          : null,
        reasonCode: correction.correctionReason?.code ?? null,
        correctionVolume: correction.correctionVolume,
        deliveryDate: correction.lot.deliveryDate,
      })
    ),
  ];
}
