import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const supplierId = request.nextUrl.searchParams.get("supplierId");
  if (!supplierId) {
    return NextResponse.json({ error: "supplierId required" }, { status: 400 });
  }

  // Access check: suppliers can only view their own profile
  if (
    session!.user.role === "supplier" &&
    session!.user.supplierId !== supplierId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    include: {
      certificates: true,
      commercie: { select: { name: true, email: true } },
    },
  });

  if (!supplier) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    company: supplier.company,
    street: supplier.street,
    city: supplier.city,
    postalCode: supplier.postalCode,
    country: supplier.country,
    phone: supplier.phone,
    vatNumber: supplier.vatNumber,
    ggn: supplier.ggn,
    commercie: supplier.commercie,
    certificates: supplier.certificates,
    seasonStartMonth: supplier.seasonStartMonth,
  });
}
