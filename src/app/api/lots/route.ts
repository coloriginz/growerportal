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

  const lotWhere = supplierId ? { supplierId } : { supplier: scope };

  const lots = await prisma.lot.findMany({
    where: lotWhere,
    include: {
      qualityIssues: { select: { id: true } },
    },
    orderBy: { deliveryDate: "desc" },
    take: 200,
  });

  return NextResponse.json(
    lots.map((lot: { id: string; lotNumber: string; productName: string; articleGroup: string; colli: number; stemLength: number; totalStems: number; avgPrice: unknown; totalAmount: unknown; containerType: string; deliveryDate: Date; status: string; salesSheetId: string | null; qualityIssues: { id: string }[] }) => ({
      id: lot.id,
      lotNumber: lot.lotNumber,
      productName: lot.productName,
      articleGroup: lot.articleGroup,
      colli: lot.colli,
      stemLength: lot.stemLength,
      totalStems: lot.totalStems,
      avgPrice: Number(lot.avgPrice),
      totalAmount: Number(lot.totalAmount),
      containerType: lot.containerType,
      deliveryDate: lot.deliveryDate.toISOString(),
      status: lot.status,
      salesSheetId: lot.salesSheetId,
      hasQualityIssues: lot.qualityIssues.length > 0,
    }))
  );
}
