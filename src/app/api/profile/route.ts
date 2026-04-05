import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const growerId = request.nextUrl.searchParams.get("growerId");
  if (!growerId) {
    return NextResponse.json({ error: "growerId required" }, { status: 400 });
  }

  // Access check: growers can only view their own profile
  if (
    session!.user.role === "grower" &&
    session!.user.growerId !== growerId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const grower = await prisma.grower.findUnique({
    where: { id: growerId },
    include: {
      certificates: true,
      commercie: { select: { name: true, email: true } },
    },
  });

  if (!grower) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: grower.id,
    code: grower.code,
    name: grower.name,
    company: grower.company,
    street: grower.street,
    city: grower.city,
    postalCode: grower.postalCode,
    country: grower.country,
    phone: grower.phone,
    vatNumber: grower.vatNumber,
    ggn: grower.ggn,
    commercie: grower.commercie,
    certificates: grower.certificates,
    seasonStartMonth: grower.seasonStartMonth,
  });
}
