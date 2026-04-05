import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { z } from "zod";

export async function GET(request: NextRequest) {
  const { error } = await requireAuth(["admin", "commercie"]);
  if (error) return error;

  const url = new URL(request.url);
  const full = url.searchParams.get("full");

  // Simple mode: return minimal data for dropdowns
  if (!full) {
    const growers = await prisma.grower.findMany({
      select: { id: true, code: true, name: true, company: true },
      orderBy: { code: "asc" },
    });
    return NextResponse.json(growers);
  }

  // Full mode: return complete grower list with commercie and login status
  const growers = await prisma.grower.findMany({
    include: {
      commercie: { select: { id: true, name: true } },
      users: { select: { id: true, isActive: true } },
    },
    orderBy: { code: "asc" },
  });

  const result = growers.map((g) => ({
    id: g.id,
    code: g.code,
    name: g.name,
    company: g.company,
    country: g.country,
    commercie: g.commercie ? { id: g.commercie.id, name: g.commercie.name } : null,
    loginStatus: g.users.length === 0
      ? "none"
      : g.users.some((u) => u.isActive)
        ? "active"
        : "pending",
    userCount: g.users.length,
  }));

  return NextResponse.json(result);
}

const createGrowerSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  company: z.string().optional(),
  country: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const { error } = await requireAuth(["admin", "commercie"]);
  if (error) return error;

  const body = await request.json();
  const parsed = createGrowerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { code, name, company, country } = parsed.data;

  const existing = await prisma.grower.findUnique({ where: { code } });
  if (existing) {
    return NextResponse.json({ error: "Grower code already exists" }, { status: 409 });
  }

  const grower = await prisma.grower.create({
    data: {
      code,
      name,
      company: company || null,
      country: country || null,
    },
  });

  return NextResponse.json(grower, { status: 201 });
}
