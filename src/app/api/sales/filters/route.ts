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
    return NextResponse.json({ products: [], salesTypes: [], stemLengths: [], growers: [] });
  }

  const lotWhere = supplierId ? { supplierId } : { supplier: scope };
  const txWhere = supplierId ? { lot: { supplierId } } : { lot: { supplier: scope } };
  const growerWhere = supplierId ? { supplierId } : { supplier: scope };

  const [products, salesTypes, stemLengths, growers] = await Promise.all([
    prisma.lot.findMany({
      where: lotWhere,
      select: { productName: true },
      distinct: ["productName"],
      orderBy: { productName: "asc" },
    }),
    prisma.transaction.findMany({
      where: txWhere,
      select: { salesType: true },
      distinct: ["salesType"],
      orderBy: { salesType: "asc" },
    }),
    prisma.lot.findMany({
      where: lotWhere,
      select: { stemLength: true },
      distinct: ["stemLength"],
      orderBy: { stemLength: "asc" },
    }),
    prisma.grower.findMany({
      where: growerWhere,
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return NextResponse.json({
    products: products.map((p) => p.productName),
    salesTypes: salesTypes.map((s) => s.salesType),
    stemLengths: stemLengths.map((s) => `${s.stemLength} cm`),
    growers: growers.map((g) => ({ id: g.id, label: g.name || g.code || g.id })),
  });
}
