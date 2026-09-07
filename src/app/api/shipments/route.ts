import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveSupplierId, buildSupplierScope } from "@/lib/api-helpers";
import { resolveShipmentStatus } from "@/lib/shipment-status";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const requestedSupplierId = request.nextUrl.searchParams.get("supplierId");
  const supplierId = resolveSupplierId(session!, requestedSupplierId);
  const scope = buildSupplierScope(session!);

  if (!supplierId && !scope) {
    return NextResponse.json([]);
  }

  const sheetWhere = supplierId ? { supplierId } : { supplier: scope };

  const salesSheets = await prisma.salesSheet.findMany({
    where: sheetWhere,
    include: {
      lots: {
        select: {
          id: true,
          lotNumber: true,
          productName: true,
          articleGroup: true,
          invoicedVolume: true,
          avgPrice: true,
          totalAmount: true,
          s1: true,
          s2: true,
          s3: true,
        },
      },
      costs: {
        select: { id: true },
      },
    },
    orderBy: { deliveryDate: "desc" },
    take: 200,
  });

  // Verkochte stelen apart optellen in plaats van via de include: de transacties
  // van 200 leveringen zijn tienduizenden rijen, en er is hier alleen een som nodig.
  const sheetIds = salesSheets.map((ss) => ss.id);
  const soldRows = sheetIds.length
    ? await prisma.$queryRaw<{ salesSheetId: string; sold: number }[]>`
        SELECT lo."salesSheetId" as "salesSheetId", CAST(SUM(tx.stems) AS INT) as sold
        FROM "Transaction" tx
        JOIN "Lot" lo ON lo.id = tx."lotId"
        -- text[], niet uuid[]: Prisma legt UUID-sleutels als text in Postgres aan.
        WHERE lo."salesSheetId" = ANY(${sheetIds}::text[])
        GROUP BY lo."salesSheetId"
      `
    : [];
  const soldBySheet = new Map(soldRows.map((r) => [r.salesSheetId, r.sold]));

  return NextResponse.json(
    salesSheets.map((ss) => {
      // invoicedVolume, niet totalStems: de orders-import overschrijft Lot.totalStems
      // met de som van de verkochte stelen, dus die kolom draagt hier "verkocht" en
      // niet "aangevoerd" (zie src/app/api/import/orders/route.ts en shipment-status.ts).
      // De "Stems" kolom in het overzicht is juist bedoeld als het aangevoerde aantal,
      // los van "Sold Stems".
      const totalStems = ss.lots.reduce((sum, l) => sum + (l.invoicedVolume ?? 0), 0);
      const soldStems = soldBySheet.get(ss.id) ?? 0;
      return {
        id: ss.id,
        invoiceNumber: ss.invoiceNumber,
        invoiceDate: ss.invoiceDate.toISOString(),
        deliveryDate: ss.deliveryDate.toISOString(),
        totalTurnover: Number(ss.totalTurnover),
        totalCosts: Number(ss.totalCosts),
        netResult: Number(ss.netResult),
        lotCount: ss.lots.length,
        costCount: ss.costs.length,
        totalStems,
        soldStems,
        status: resolveShipmentStatus({
          deliveredStems: totalStems,
          soldStems,
          costCount: ss.costs.length,
        }),
      };
    })
  );
}
