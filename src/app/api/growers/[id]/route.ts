import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { z } from "zod";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth(["admin", "commercie"]);
  if (error) return error;

  const { id } = await params;

  const grower = await prisma.grower.findUnique({
    where: { id },
    include: {
      certificates: {
        orderBy: { createdAt: "desc" },
      },
      user: {
        select: {
          id: true,
          email: true,
          isActive: true,
          activationToken: true,
        },
      },
      commercie: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  if (!grower) {
    return NextResponse.json({ error: "Grower not found" }, { status: 404 });
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
    commercieId: grower.commercieId,
    seasonStartMonth: grower.seasonStartMonth,
    certificates: grower.certificates.map((c) => ({
      id: c.id,
      type: c.type,
      number: c.number,
      validFrom: c.validFrom,
      validUntil: c.validUntil,
    })),
    user: grower.user
      ? {
          id: grower.user.id,
          email: grower.user.email,
          isActive: grower.user.isActive,
        }
      : null,
  });
}

const updateGrowerSchema = z.object({
  name: z.string().min(1).optional(),
  company: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  vatNumber: z.string().nullable().optional(),
  ggn: z.string().nullable().optional(),
  commercieId: z.string().nullable().optional(),
  seasonStartMonth: z.number().int().min(1).max(12).optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth(["admin", "commercie"]);
  if (error) return error;

  const { id } = await params;
  const body = await request.json();
  const parsed = updateGrowerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.grower.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Grower not found" }, { status: 404 });
  }

  const grower = await prisma.grower.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json(grower);
}
