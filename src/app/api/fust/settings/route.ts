import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

// GET: Fust settings overview (fust types, transporters, grower fust status)
export async function GET() {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const [fustTypes, transporters, growers] = await Promise.all([
    prisma.fustType.findMany({ orderBy: [{ category: "asc" }, { sortOrder: "asc" }] }),
    prisma.transporter.findMany({ orderBy: { name: "asc" } }),
    prisma.grower.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        company: true,
        fustEnabled: true,
        defaultTransporterId: true,
      },
      orderBy: { code: "asc" },
    }),
  ]);

  return NextResponse.json({ fustTypes, transporters, growers });
}

// PATCH: Update grower fust settings or fust type
const updateGrowerSchema = z.object({
  type: z.literal("grower"),
  growerId: z.string().uuid(),
  fustEnabled: z.boolean().optional(),
  defaultTransporterId: z.string().uuid().nullable().optional(),
});

const updateFustTypeSchema = z.object({
  type: z.literal("fustType"),
  id: z.string().uuid(),
  pricePerUnit: z.number().optional(),
  isActive: z.boolean().optional(),
  name: z.string().optional(),
});

const updateTransporterSchema = z.object({
  type: z.literal("transporter"),
  id: z.string().uuid().optional(), // omit for create
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: NextRequest) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const body = await request.json();

  if (body.type === "grower") {
    const parsed = updateGrowerSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const { growerId, ...data } = parsed.data;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { type: _, ...updateData } = data;
    await prisma.grower.update({ where: { id: growerId }, data: updateData });
    return NextResponse.json({ success: true });
  }

  if (body.type === "fustType") {
    const parsed = updateFustTypeSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, type: _t, ...updateData } = parsed.data;
    await prisma.fustType.update({ where: { id }, data: updateData });
    return NextResponse.json({ success: true });
  }

  if (body.type === "transporter") {
    const parsed = updateTransporterSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, type: _t, ...data } = parsed.data;
    if (id) {
      await prisma.transporter.update({ where: { id }, data });
    } else {
      await prisma.transporter.create({ data });
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown type" }, { status: 400 });
}
