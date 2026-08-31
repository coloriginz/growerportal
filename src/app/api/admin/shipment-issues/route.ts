import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { Prisma } from "@/generated/prisma";
import { SALESSHEET_MATCH_TOLERANCE } from "@/lib/salessheet-match";

/**
 * Drie afwijkingen die de status van een levering niet mag verbergen.
 *
 * `missing-pdf` — de afrekening is gedraaid (er zijn kostenregels) maar de sales
 * sheet-PDF is nooit gekoppeld. De levering staat dan terecht op Completed, want
 * de PDF is een portal-artefact en geen bedrijfsfeit, maar de kweker mist wel
 * zijn document. Dit overzicht is de werklijst voor het koppelen.
 *
 * `stem-gap` — de afrekening is gedraaid terwijl aangevoerd plus correcties niet
 * uitkomt op verkocht. De afrekening wint bij het bepalen van de status, dus
 * zonder dit overzicht valt zo'n gat stil weg. Vrijwel altijd het gevolg van een
 * orderregel die de warehouse later heeft ingevuld (zie scripts/repair-zero-orders.ts).
 * Zie `STEM_GAP_MARGIN` hieronder voor waarom dit niet op een gat van exact nul test.
 *
 * `pdf-mismatch` — de sales sheet-PDF is gelezen en het netto dat erop staat
 * wijkt meer dan de tolerantie af van wat de portal zelf berekent. Twee
 * onafhankelijke bronnen (factuursysteem vs. Fabric) die hetzelfde horen te
 * zeggen; zie `resolveSalesSheetMatch` in `salessheet-match.ts` voor waarom
 * alleen het netto wordt vergeleken.
 */
const ISSUE_TYPES = ["missing-pdf", "stem-gap", "pdf-mismatch"] as const;
type IssueType = (typeof ISSUE_TYPES)[number];

/**
 * Het netto zoals de PDF het zegt: rechtstreeks afgedrukt, of afgeleid uit omzet
 * en kosten als dat label ontbreekt op de sales sheet. Zelfde afleiding als
 * `derivePdfNetResult` in `salessheet-match.ts`, hier in SQL omdat de vergelijking
 * hier ook in SQL gebeurt (filteren op een aggregatie kan niet in een Prisma-filter).
 *
 * Bewust zonder de binnenste COALESCE op `pdfCosts`: ontbrekende kosten tellen
 * niet als nul maar als "niet gelezen", dus de hele uitdrukking valt dan naar
 * NULL en de rij valt buiten `IS NOT NULL` hierboven — precies de beslissing die
 * `derivePdfNetResult` in TypeScript ook neemt.
 */
const pdfAmountSql = Prisma.sql`COALESCE(ss."pdfNetResult", ss."pdfTurnover" - ss."pdfCosts")`;

/**
 * De marge voor de stem-gap-controle: aangevoerd + correcties − verkocht mag tot
 * dit aantal stelen afwijken zonder als gat te tellen. Gemeten op test, 7.690
 * afgerekende leveringen: bij marge 0 wijken 855 af, bij marge 10 nog 810, bij
 * marge 100 nog 477 — geen knik die een duidelijke ruisgrens toont, dus de keuze
 * is een oordeel: onder de tien stelen is het afrondingsruis binnen één doos,
 * daarboven mist er aantoonbaar iets. Zonder deze marge (dus > 0) meldt de tak
 * ook leveringen die exact kloppen op de laatste steel na afronding elders in de
 * keten.
 */
const STEM_GAP_MARGIN = 10;

/**
 * Alles hangt aan drie afgeleiden per levering: aangevoerd (Lot.invoicedVolume),
 * correcties (LotCorrection.correctionVolume) en verkocht (Transaction.stems).
 * Geen van drie is uit te drukken in een Prisma-filter, dus hier één romp die
 * alle drie de vragen bedient.
 */
function issueBody(type: IssueType, search: string) {
  const condition =
    type === "missing-pdf"
      ? Prisma.sql`ss."pdfDocumentId" IS NULL`
      : type === "stem-gap"
        ? Prisma.sql`ABS(COALESCE(l.delivered, 0) + COALESCE(corr.corrections, 0) - COALESCE(t.sold, 0)) > ${STEM_GAP_MARGIN}`
        : Prisma.sql`
            ss."pdfDocumentId" IS NOT NULL
            AND ss."pdfParsedAt" IS NOT NULL
            AND ${pdfAmountSql} IS NOT NULL
            AND ABS(${pdfAmountSql} - ss."netResult") > ${SALESSHEET_MATCH_TOLERANCE}
          `;

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
    -- "delivered" komt uit invoicedVolume, niet totalStems: de orders-import
    -- overschrijft Lot.totalStems achteraf met de som van de verkochte stelen
    -- (zie src/app/api/import/orders/route.ts), dus totalStems draagt hier
    -- "verkocht" en niet "aangevoerd". COALESCE op de kolom zelf: 207 partijen
    -- hebben geen invoicedVolume.
    LEFT JOIN (
      SELECT "salesSheetId", SUM(COALESCE("invoicedVolume", 0)) AS delivered
      FROM "Lot" WHERE "salesSheetId" IS NOT NULL GROUP BY "salesSheetId"
    ) l ON l."salesSheetId" = ss.id
    -- correctionVolume is betekenisvol getekend (12.296 negatief, 4.758 positief
    -- van 17.056 regels op test) en hoort dus opgeteld, niet op absolute waarde
    -- genomen: aangevoerd + correcties komt zo op verkocht uit. Aparte subquery
    -- per salesSheetId, net als bij "l" en "t": in één FROM meejoinen vermenigvuldigt
    -- de rijen van partijen, correcties en transacties tegen elkaar en klopt geen
    -- enkel totaal meer.
    LEFT JOIN (
      SELECT lo."salesSheetId", SUM(COALESCE(lc."correctionVolume", 0)) AS corrections
      FROM "LotCorrection" lc JOIN "Lot" lo ON lo.id = lc."lotId"
      WHERE lo."salesSheetId" IS NOT NULL GROUP BY lo."salesSheetId"
    ) corr ON corr."salesSheetId" = ss.id
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
         CAST(COALESCE(corr.corrections, 0) AS INT) AS "correctionStems",
         CAST(COALESCE(t.sold, 0) AS INT) AS "soldStems",
         CAST((SELECT COUNT(*) FROM "SalesSheetCost" c WHERE c."salesSheetId" = ss.id) AS INT) AS "costCount",
         (ss."pdfDocumentId" IS NOT NULL) AS "hasPdf",
         -- Altijd meegeselecteerd (ook voor de andere twee typen): de kolommen
         -- staan al op ss, en zo hoeft het scherm geen tweede aanroep te doen.
         CAST(${pdfAmountSql} AS DOUBLE PRECISION) AS "pdfAmount",
         CAST(ss."netResult" AS DOUBLE PRECISION) AS "computedAmount"
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
  correctionStems: number;
  soldStems: number;
  costCount: number;
  hasPdf: boolean;
  pdfAmount: number | null;
  computedAmount: number | null;
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
    // De aantallen van alle drie de tabbladen, zonder zoekfilter: dat is het totaal
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
      correctionStems: r.correctionStems,
      soldStems: r.soldStems,
      // Kan negatief zijn (meer correcties dan het gat) — het scherm toont het
      // teken, de conditie in issueBody() filtert al op |gap| > STEM_GAP_MARGIN.
      gapStems: r.deliveredStems + r.correctionStems - r.soldStems,
      costCount: r.costCount,
      hasPdf: r.hasPdf,
      pdfAmount: r.pdfAmount,
      computedAmount: r.computedAmount,
      // Alleen te berekenen als beide kanten een bedrag hebben; anders is er
      // niets om te vergelijken en moet het scherm dat als leeg tonen.
      difference:
        r.pdfAmount !== null && r.computedAmount !== null
          ? r.pdfAmount - r.computedAmount
          : null,
    })),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    counts: Object.fromEntries(counts) as Record<IssueType, number>,
  });
}
