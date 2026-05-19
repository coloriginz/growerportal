import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveSupplierId, buildSupplierScope } from "@/lib/api-helpers";

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
          totalStems: true,
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

  return NextResponse.json(
    salesSheets.map((ss) => ({
      id: ss.id,
      invoiceNumber: ss.invoiceNumber,
      invoiceDate: ss.invoiceDate.toISOString(),
      deliveryDate: ss.deliveryDate.toISOString(),
      totalTurnover: Number(ss.totalTurnover),
      totalCosts: Number(ss.totalCosts),
      netResult: Number(ss.netResult),
      lotCount: ss.lots.length,
      costCount: ss.costs.length,
      totalStems: ss.lots.reduce((sum, l) => sum + l.totalStems, 0),
    }))
  );
}
