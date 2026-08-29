import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { Prisma } from "@/generated/prisma";

/**
 * Twee afwijkingen die de status van een levering niet mag verbergen.
 *
 * `missing-pdf` — de afrekening is gedraaid (er zijn kostenregels) maar de sales
 * sheet-PDF is nooit gekoppeld. De levering staat dan terecht op Completed, want
 * de PDF is een portal-artefact en geen bedrijfsfeit, maar de kweker mist wel
 * zijn document. Dit overzicht is de werklijst voor het koppelen.
 *
 * `stem-gap` — de afrekening is gedraaid terwijl er minder stelen verkocht zijn
 * dan aangevoerd. De afrekening wint bij het bepalen van de status, dus zonder
 * dit overzicht valt zo'n gat stil weg. Vrijwel altijd het gevolg van een
 * orderregel die de warehouse later heeft ingevuld (zie scripts/repair-zero-orders.ts).
 */
const ISSUE_TYPES = ["missing-pdf", "stem-gap"] as const;
type IssueType = (typeof ISSUE_TYPES)[number];

/**
 * Alles hangt aan één afgeleide: verkochte stelen per levering. Dat is een
 * aggregatie over Transaction, niet uit te drukken in een Prisma-filter, dus
 * hier één romp die beide vragen bedient.
 */
function issueBody(type: IssueType, search: string) {
  const condition =
    type === "missing-pdf"
      ? Prisma.sql`ss."pdfDocumentId" IS NULL`
      : Prisma.sql`COALESCE(t.sold, 0) < COALESCE(l.delivered, 0)`;

  const searchFilter = search
    ? Prisma.sql`AND (
        ss."invoiceNumber" ILIKE ${"%" + search + "%"}
        OR COALESCE(ss."ourInvoiceNumber", '') ILIKE ${"%" + search + "%"}
        OR sup.code ILIKE ${"%" + search + "%"}
        OR sup.name ILIKE ${"%" + search + "%"}
      )`
    : Prisma.empty;

  return Prisma.sql`
    FROM "SalesSheet" ss
    JOIN "Supplier" sup ON sup.id = ss."supplierId"
    LEFT JOIN (
      SELECT "salesSheetId", SUM("totalStems") AS delivered
      FROM "Lot" WHERE "salesSheetId" IS NOT NULL GROUP BY "salesSheetId"
    ) l ON l."salesSheetId" = ss.id
    LEFT JOIN (
      SELECT lo."salesSheetId", SUM(tx.stems) AS sold
      FROM "Transaction" tx JOIN "Lot" lo ON lo.id = tx."lotId"
      WHERE lo."salesSheetId" IS NOT NULL GROUP BY lo."salesSheetId"
    ) t ON t."salesSheetId" = ss.id
    WHERE EXISTS (SELECT 1 FROM "SalesSheetCost" c WHERE c."salesSheetId" = ss.id)
      AND ${condition}
      ${searchFilter}
  `;
}

const countSql = (body: Prisma.Sql) =>
  Prisma.sql`SELECT CAST(COUNT(*) AS INT) AS count ${body}`;

const pageSql = (body: Prisma.Sql, limit: number, offset: number) => Prisma.sql`
  SELECT ss.id,
         ss."invoiceNumber",
         ss."ourInvoiceNumber",
         ss."deliveryDate",
         sup.id AS "supplierId",
         sup.code AS "supplierCode",
         sup.name AS "supplierName",
         CAST(COALESCE(l.delivered, 0) AS INT) AS "deliveredStems",
         CAST(COALESCE(t.sold, 0) AS INT) AS "soldStems",
         CAST((SELECT COUNT(*) FROM "SalesSheetCost" c WHERE c."salesSheetId" = ss.id) AS INT) AS "costCount",
         (ss."pdfDocumentId" IS NOT NULL) AS "hasPdf"
  ${body}
  -- Sorteren op een unieke sleutel: leverdatum alleen laat Postgres met OFFSET
  -- een rij op twee pagina's of op geen enkele tonen.
  ORDER BY ss."deliveryDate" DESC, ss.id ASC
  LIMIT ${limit} OFFSET ${offset}
`;

interface IssueRow {
  id: string;
  invoiceNumber: string;
  ourInvoiceNumber: string | null;
  deliveryDate: Date;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  deliveredStems: number;
  soldStems: number;
  costCount: number;
  hasPdf: boolean;
}

export async function GET(request: NextRequest) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const requestedType = searchParams.get("type") || "missing-pdf";
  const type = (ISSUE_TYPES as readonly string[]).includes(requestedType)
    ? (requestedType as IssueType)
    : "missing-pdf";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25", 10)));
  const search = searchParams.get("search")?.trim() || "";

  const body = issueBody(type, search);

  // Elke query wordt eerst als Prisma.Sql opgebouwd en dan als argument
  // meegegeven. De tagged-template-vorm met een genest Prisma.Sql-fragment erin
  // gaat door de SWC-compilatie van Next stuk: Postgres krijgt dan een $1 die er
  // niet hoort te staan en antwoordt met 42601. Gemeten op deze route: dezelfde
  // SQL faalt als tagged template en slaagt als vooraf gebouwd object.
  const [items, totalRows, counts] = await Promise.all([
    prisma.$queryRaw<IssueRow[]>(pageSql(body, limit, (page - 1) * limit)),
    prisma.$queryRaw<{ count: number }[]>(countSql(body)),
    // De aantallen van beide tabbladen, zonder zoekfilter: dat is het totaal
    // openstaande werk, niet wat er toevallig gefilterd op het scherm staat.
    Promise.all(
      ISSUE_TYPES.map(async (kind) => {
        const rows = await prisma.$queryRaw<{ count: number }[]>(
          countSql(issueBody(kind, ""))
        );
        return [kind, rows[0]?.count ?? 0] as const;
      })
    ),
  ]);

  const total = totalRows[0]?.count ?? 0;

  return NextResponse.json({
    type,
    items: items.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      ourInvoiceNumber: r.ourInvoiceNumber,
      deliveryDate: r.deliveryDate.toISOString(),
      supplierId: r.supplierId,
      supplierCode: r.supplierCode,
      supplierName: r.supplierName,
      deliveredStems: r.deliveredStems,
      soldStems: r.soldStems,
      missingStems: Math.max(0, r.deliveredStems - r.soldStems),
      costCount: r.costCount,
      hasPdf: r.hasPdf,
    })),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    counts: Object.fromEntries(counts) as Record<IssueType, number>,
  });
}
