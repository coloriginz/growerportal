import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireImportAuth } from "@/lib/import-auth";

const supplierSchema = z.object({
  Code: z.string().min(1),
  Naam: z.string().min(1),
  ID: z.number().int(),              // rel_id_leverancier
  "AM Naam": z.string().nullable().optional(),
  "AM Code": z.string().nullable().optional(),
});

const bodySchema = z.object({
  suppliers: z.array(supplierSchema).min(1),
});

export async function POST(request: NextRequest) {
  const authError = requireImportAuth(request);
  if (authError) return authError;

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { suppliers } = parsed.data;

  // Ensure default company exists
  let company = await prisma.company.findFirst({ where: { slug: "coloriginz" } });
  if (!company) {
    company = await prisma.company.create({
      data: {
        name: "Coloriginz",
        slug: "coloriginz",
        logoUrl: "/logos/coloriginz.png",
        emailFrom: "noreply@coloriginz.com",
        emailName: "Coloriginz Grower Portal",
        footerText: "Coloriginz — OZ Import BV, Aalsmeer",
      },
    });
  }

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const row of suppliers) {
    try {
      const result = await prisma.supplier.upsert({
        where: { fabricId: row.ID },
        update: {
          code: row.Code,
          name: row.Naam,
          accountManagerName: row["AM Naam"] || null,
          accountManagerCode: row["AM Code"] || null,
        },
        create: {
          code: row.Code,
          name: row.Naam,
          fabricId: row.ID,
          accountManagerName: row["AM Naam"] || null,
          accountManagerCode: row["AM Code"] || null,
          companyId: company.id,
        },
      });
      // Check if it was created or updated by comparing createdAt timestamps
      const isNew = result.createdAt.getTime() > Date.now() - 5000;
      if (isNew) created++;
      else updated++;
    } catch {
      errors++;
    }
  }

  return NextResponse.json({
    received: suppliers.length,
    created,
    updated,
    errors,
  });
}
