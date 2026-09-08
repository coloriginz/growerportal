import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveSupplierId, buildSupplierScope } from "@/lib/api-helpers";
import {
  resolveShipmentStatus,
  SHIPMENT_STATUSES,
  type ShipmentStatus,
} from "@/lib/shipment-status";
import { Prisma } from "@/generated/prisma";

/**
 * Standaard paginagrootte. Het maximum ligt hoger dan wat het scherm ooit vraagt,
 * zodat de CSV-export in een paar rondes de hele gefilterde verzameling kan
 * ophalen in plaats van alleen de zichtbare pagina.
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

interface AggregateRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date;
  deliveryDate: Date;
  totalTurnover: Prisma.Decimal;
  totalCosts: Prisma.Decimal;
  netResult: Prisma.Decimal;
  lotCount: number;
  deliveredStems: number;
  soldStems: number;
  costCount: number;
}

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const requestedSupplierId = searchParams.get("supplierId");
  const supplierId = resolveSupplierId(session!, requestedSupplierId);
  const scope = buildSupplierScope(session!);

  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );
  const search = searchParams.get("search")?.trim().toLowerCase() || "";
  const statusParam = searchParams.get("status") || "all";
  const statusFilter = (SHIPMENT_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as ShipmentStatus)
    : null;

  const leeg = { items: [], page: 1, totalPages: 0, total: 0 };
  if (!supplierId && !scope) {
    return NextResponse.json(leeg);
  }

  // De scope naar losse leverancier-ids oplossen in plaats van hem in SQL na te
  // bouwen: `buildSupplierScope` levert een Prisma-filter op Supplier (per
  // bedrijf, per accountmanager) en dat tweemaal uitschrijven is precies hoe de
  // twee versies uit elkaar gaan lopen.
  const supplierIds = supplierId
    ? [supplierId]
    : (await prisma.supplier.findMany({ where: scope, select: { id: true } })).map((s) => s.id);

  if (supplierIds.length === 0) {
    return NextResponse.json(leeg);
  }

  // Alle afrekeningen van de scope met hun drie statussignalen, niet alleen de
  // gevraagde pagina. Dat moet: de status is afgeleid (zie resolveShipmentStatus)
  // en er is geen kolom om in SQL op te filteren of te tellen. Een LIMIT in SQL
  // zou hier ook niets schelen — voor het totaal en het statusfilter moet
  // Postgres de aggregaten toch over de hele scope berekenen. Gemeten op test:
  // 100-150 ms warm voor de grootste leveranciers (COLXLNFW, 514 afrekeningen
  // over 22.785 transacties), tegen 214 ms voor de vorige take-200-query met
  // includes.
  //
  // text[] en niet uuid[]: Prisma legt UUID-sleutels als text in Postgres aan.
  const sql = Prisma.sql`
    SELECT ss.id,
           ss."invoiceNumber",
           ss."invoiceDate",
           ss."deliveryDate",
           ss."totalTurnover",
           ss."totalCosts",
           ss."netResult",
           COALESCE(l.lot_count, 0)  AS "lotCount",
           COALESCE(l.delivered, 0)  AS "deliveredStems",
           COALESCE(t.sold, 0)       AS "soldStems",
           COALESCE(c.cost_count, 0) AS "costCount"
    FROM "SalesSheet" ss
    LEFT JOIN (
      SELECT lo."salesSheetId" AS sid,
             CAST(COUNT(*) AS INT) AS lot_count,
             CAST(SUM(COALESCE(lo."invoicedVolume", 0)) AS INT) AS delivered
      FROM "Lot" lo
      WHERE lo."supplierId" = ANY(${supplierIds}::text[])
      GROUP BY lo."salesSheetId"
    ) l ON l.sid = ss.id
    LEFT JOIN (
      SELECT lo."salesSheetId" AS sid, CAST(SUM(tx.stems) AS INT) AS sold
      FROM "Transaction" tx
      JOIN "Lot" lo ON lo.id = tx."lotId"
      WHERE lo."supplierId" = ANY(${supplierIds}::text[])
        AND NOT tx."afterSettlement"
      GROUP BY lo."salesSheetId"
    ) t ON t.sid = ss.id
    LEFT JOIN (
      SELECT sc."salesSheetId" AS sid, CAST(COUNT(*) AS INT) AS cost_count
      FROM "SalesSheetCost" sc
      JOIN "SalesSheet" s2 ON s2.id = sc."salesSheetId"
      WHERE s2."supplierId" = ANY(${supplierIds}::text[])
      GROUP BY sc."salesSheetId"
    ) c ON c.sid = ss.id
    WHERE ss."supplierId" = ANY(${supplierIds}::text[])
  `;
  // Als argument meegeven en niet als tagged template: een genest Prisma.Sql-
  // fragment in een tagged template overleeft de SWC-compilatie van Next niet
  // (zie CLAUDE.md). Deze query heeft er geen, maar de vorm is hier de veilige.
  const rows = await prisma.$queryRaw<AggregateRow[]>(sql);

  const alle = rows
    .map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate.toISOString(),
      deliveryDate: r.deliveryDate.toISOString(),
      totalTurnover: Number(r.totalTurnover),
      totalCosts: Number(r.totalCosts),
      netResult: Number(r.netResult),
      lotCount: r.lotCount,
      costCount: r.costCount,
      // invoicedVolume, niet totalStems: de orders-import overschrijft
      // Lot.totalStems met de som van de verkochte stelen (zie
      // src/app/api/import/orders/route.ts en shipment-status.ts). De kolom
      // "Stems" in het overzicht is juist het aangevoerde aantal, los van
      // "Sold Stems".
      totalStems: r.deliveredStems,
      soldStems: r.soldStems,
      status: resolveShipmentStatus({
        deliveredStems: r.deliveredStems,
        soldStems: r.soldStems,
        costCount: r.costCount,
      }),
    }))
    .filter((s) => {
      if (statusFilter && s.status !== statusFilter) return false;
      if (search && !s.invoiceNumber.toLowerCase().includes(search)) return false;
      return true;
    })
    // Op id na de datum: leverdatums zijn niet uniek, en zonder tweede sleutel
    // kan dezelfde rij op twee pagina's staan of op geen (CLAUDE.md).
    .sort((a, b) => {
      if (a.deliveryDate !== b.deliveryDate) return a.deliveryDate < b.deliveryDate ? 1 : -1;
      return a.id < b.id ? -1 : 1;
    });

  const total = alle.length;
  const totalPages = Math.ceil(total / limit);
  const huidige = Math.min(page, Math.max(1, totalPages));

  return NextResponse.json({
    items: alle.slice((huidige - 1) * limit, huidige * limit),
    page: huidige,
    totalPages,
    total,
  });
}
