import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveSupplierId } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const requestedSupplierId = request.nextUrl.searchParams.get("supplierId");
  const supplierId = resolveSupplierId(session!, requestedSupplierId);

  if (!supplierId) {
    return NextResponse.json({ products: [], salesTypes: [], stemLengths: [], growers: [] });
  }

  const [products, salesTypes, stemLengths, growers] = await Promise.all([
    prisma.lot.findMany({
      where: { supplierId },
      select: { productName: true },
      distinct: ["productName"],
      orderBy: { productName: "asc" },
    }),
    prisma.transaction.findMany({
      where: { lot: { supplierId } },
      select: { salesType: true },
      distinct: ["salesType"],
      orderBy: { salesType: "asc" },
    }),
    prisma.lot.findMany({
      where: { supplierId },
      select: { stemLength: true },
      distinct: ["stemLength"],
      orderBy: { stemLength: "asc" },
    }),
    prisma.grower.findMany({
      where: { supplierId },
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
