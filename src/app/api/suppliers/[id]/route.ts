import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { z } from "zod";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth(["admin", "commercie", "finance"]);
  if (error) return error;

  const { id } = await params;

  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      certificates: {
        orderBy: { createdAt: "desc" },
      },
      users: {
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
        },
        orderBy: { createdAt: "asc" },
      },
      commercie: {
        select: { id: true, name: true, email: true },
      },
      companyEntity: {
        select: { id: true, name: true, slug: true },
      },
    },
  });

  if (!supplier) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
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
    preferredLanguage: supplier.preferredLanguage,
    commercie: supplier.commercie,
    commercieId: supplier.commercieId,
    companyId: supplier.companyId,
    companyEntity: supplier.companyEntity,
    seasonStartMonth: supplier.seasonStartMonth,
    certificates: supplier.certificates.map((c) => ({
      id: c.id,
      type: c.type,
      number: c.number,
      validFrom: c.validFrom,
      validUntil: c.validUntil,
    })),
    users: supplier.users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      isActive: u.isActive,
    })),
  });
}

const updateSupplierSchema = z.object({
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
  companyId: z.string().nullable().optional(),
  seasonStartMonth: z.number().int().min(1).max(12).optional(),
  preferredLanguage: z.enum(["en", "nl"]).optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth(["admin", "commercie"]);
  if (error) return error;

  const { id } = await params;
  const body = await request.json();
  const parsed = updateSupplierSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  const supplier = await prisma.supplier.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json(supplier);
}
