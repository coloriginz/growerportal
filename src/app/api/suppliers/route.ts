import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { z } from "zod";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth(["admin", "commercie", "finance"]);
  if (error) return error;

  const url = new URL(request.url);
  const full = url.searchParams.get("full");
  const fustOnly = url.searchParams.get("fustOnly") === "true";

  // Build scope filter based on user role and assignments
  const scopeFilter: Record<string, unknown>[] = [];
  if (fustOnly) scopeFilter.push({ fustEnabled: true });

  const role = session!.user.role;
  const companyIds = session!.user.companyIds;
  const kbtCode = session!.user.kbtCode;

  // Admin/finance with company labels: only see those companies' suppliers
  if ((role === "admin" || role === "finance") && companyIds.length > 0) {
    scopeFilter.push({ companyId: { in: companyIds } });
  }
  // Commercie: only see suppliers where they are account manager
  if (role === "commercie" && kbtCode) {
    scopeFilter.push({ accountManagerCode: kbtCode });
  }

  const where = scopeFilter.length > 0 ? { AND: scopeFilter } : undefined;

  // Simple mode: return minimal data for dropdowns
  if (!full) {
    const suppliers = await prisma.supplier.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        company: true,
        fustEnabled: true,
        companyEntity: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { code: "asc" },
    });
    return NextResponse.json(suppliers.map((g) => ({
      id: g.id,
      code: g.code,
      name: g.name,
      company: g.company,
      fustEnabled: g.fustEnabled,
      companyEntity: g.companyEntity,
    })));
  }

  // Full mode: return complete supplier list with commercie and login status
  const suppliers = await prisma.supplier.findMany({
    where,
    include: {
      commercie: { select: { id: true, name: true } },
      companyEntity: { select: { id: true, name: true, slug: true } },
      users: { select: { id: true, isActive: true } },
      _count: { select: { growers: true } },
    },
    orderBy: { code: "asc" },
  });

  // Look up linked users for account managers
  const amCodes = [...new Set(suppliers.map((g) => g.accountManagerCode).filter(Boolean))] as string[];
  const amUsers = amCodes.length > 0
    ? await prisma.user.findMany({ where: { kbtCode: { in: amCodes } }, select: { kbtCode: true } })
    : [];
  const linkedAmCodes = new Set(amUsers.map((u) => u.kbtCode));

  const result = suppliers.map((g) => ({
    id: g.id,
    code: g.code,
    name: g.name,
    company: g.company,
    country: g.country,
    companyEntity: g.companyEntity,
    accountManagerName: g.accountManagerName || null,
    accountManagerLinked: g.accountManagerCode ? linkedAmCodes.has(g.accountManagerCode) : false,
    featureSales: g.featureSales,
    featureQuality: g.featureQuality,
    featureForecasts: g.featureForecasts,
    fustEnabled: g.fustEnabled,
    loginStatus: g.users.length === 0
      ? "none"
      : g.users.some((u) => u.isActive)
        ? "active"
        : "pending",
    userCount: g.users.length,
    growerCount: g._count.growers,
  }));

  return NextResponse.json(result);
}

const createSupplierSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  company: z.string().optional(),
  country: z.string().optional(),
  companyId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const { error } = await requireAuth(["admin", "commercie"]);
  if (error) return error;

  const body = await request.json();
  const parsed = createSupplierSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { code, name, company, country, companyId } = parsed.data;

  const existing = await prisma.supplier.findUnique({ where: { code } });
  if (existing) {
    return NextResponse.json({ error: "Supplier code already exists" }, { status: 409 });
  }

  const supplier = await prisma.supplier.create({
    data: {
      code,
      name,
      company: company || null,
      country: country || null,
      companyId: companyId || null,
    },
  });

  return NextResponse.json(supplier, { status: 201 });
}
