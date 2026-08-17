import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import { requireAuth } from "@/lib/api-helpers";
import { windowAdvies } from "@/lib/sync/schedule";
import { SYNC_ENDPOINTS } from "@/lib/sync/types";

/**
 * Controleert types en bereiken, niet of een keuze verstandig is. Een riskante
 * maar geldige waarde wordt opgeslagen met een waarschuwing erbij: een blokkade
 * die je niet kunt omzeilen wordt een reden om weer met SQL te werken.
 *
 * `z.record(z.enum(...), ...)` maakt in deze zod-versie (4) alle keys verplicht
 * in plaats van optioneel zoals in zod 3 — een lege of gedeeltelijke
 * uitzonderingskaart zou dan al weigeren. `z.partialRecord()` is de zod 4-vorm
 * die wel optionele keys toestaat, met dezelfde afwijzing van onbekende keys.
 */
const bodySchema = z.object({
  enabled: z.boolean(),
  intervalMin: z.number().int().positive().nullable(),
  atTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").nullable(),
  endpoints: z.array(z.enum(SYNC_ENDPOINTS)),
  windowDays: z.number().int().positive().max(3650),
  windowOverrides: z.partialRecord(z.enum(SYNC_ENDPOINTS), z.number().int().positive().max(3650)).nullable(),
});

export async function PUT(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const { name } = await params;
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const bestaat = await prisma.syncSchedule.findUnique({ where: { name } });
  if (!bestaat) return NextResponse.json({ error: "Unknown schedule" }, { status: 404 });

  const bijgewerkt = await prisma.syncSchedule.update({
    where: { name },
    // Prisma's Json fields distinguish "no value" (SQL NULL) from a JSON null
    // literal; a plain `null` doesn't type-check, so an explicit `Prisma.JsonNull`
    // is needed to clear windowOverrides.
    data: { ...parsed.data, windowOverrides: parsed.data.windowOverrides ?? Prisma.JsonNull },
  });

  return NextResponse.json({ schedule: bijgewerkt, warnings: windowAdvies(bijgewerkt) });
}
