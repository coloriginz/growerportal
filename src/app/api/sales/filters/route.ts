import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveGrowerId } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const requestedGrowerId = request.nextUrl.searchParams.get("growerId");
  const growerId = resolveGrowerId(session!, requestedGrowerId);

  if (!growerId) {
    return NextResponse.json({ products: [], salesTypes: [], stemLengths: [] });
  }

  const [products, salesTypes, stemLengths] = await Promise.all([
    prisma.lot.findMany({
      where: { growerId },
      select: { productName: true },
      distinct: ["productName"],
      orderBy: { productName: "asc" },
    }),
    prisma.transaction.findMany({
      where: { lot: { growerId }, isCorrection: false },
      select: { salesType: true },
      distinct: ["salesType"],
      orderBy: { salesType: "asc" },
    }),
    prisma.lot.findMany({
      where: { growerId },
      select: { stemLength: true },
      distinct: ["stemLength"],
      orderBy: { stemLength: "asc" },
    }),
  ]);

  return NextResponse.json({
    products: products.map((p) => p.productName),
    salesTypes: salesTypes.map((s) => s.salesType),
    stemLengths: stemLengths.map((s) => `${s.stemLength} cm`),
  });
}
