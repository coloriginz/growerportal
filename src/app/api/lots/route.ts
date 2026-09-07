import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveSupplierId, buildSupplierScope } from "@/lib/api-helpers";
import { Prisma } from "@/generated/prisma";
import { LOT_STATUSES } from "@/types";

/** Zie de toelichting bij dezelfde constanten in /api/shipments. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

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
  const search = searchParams.get("search")?.trim() || "";
  const statusParam = searchParams.get("status") || "all";

  if (!supplierId && !scope) {
    return NextResponse.json({ items: [], page: 1, totalPages: 0, total: 0 });
  }

  const where: Prisma.LotWhereInput = supplierId ? { supplierId } : { supplier: scope };

  if ((LOT_STATUSES as readonly string[]).includes(statusParam)) {
    where.status = statusParam;
  }

  // Zoeken hoort bij de query en niet bij het scherm: filterde het scherm, dan
  // zocht het alleen in de opgehaalde pagina en las "niets gevonden" als
  // "bestaat niet".
  if (search) {
    where.OR = [
      { lotNumber: { contains: search, mode: "insensitive" } },
      { productName: { contains: search, mode: "insensitive" } },
      { articleGroup: { contains: search, mode: "insensitive" } },
    ];
  }

  const total = await prisma.lot.count({ where });
  const totalPages = Math.ceil(total / limit);
  const huidige = Math.min(page, Math.max(1, totalPages));

  const lots = await prisma.lot.findMany({
    where,
    include: {
      qualityIssues: { select: { id: true } },
    },
    // Leverdatum is niet uniek, dus id erachter: zonder tweede sleutel kan
    // Postgres bij een OFFSET dezelfde rij op twee pagina's teruggeven of op
    // geen (CLAUDE.md).
    orderBy: [{ deliveryDate: "desc" }, { id: "asc" }],
    skip: (huidige - 1) * limit,
    take: limit,
  });

  return NextResponse.json({
    items: lots.map((lot) => ({
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
    })),
    page: huidige,
    totalPages,
    total,
  });
}
