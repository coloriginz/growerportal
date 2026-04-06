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
        autoApproveOrders: true,
        defaultTransporterId: true,
      },
      orderBy: { code: "asc" },
    }),
  ]);

  return NextResponse.json({ fustTypes, transporters, growers });
}

// PATCH: Update or create grower fust settings, fust types, or transporters
const updateGrowerSchema = z.object({
  type: z.literal("grower"),
  growerId: z.string().uuid(),
  fustEnabled: z.boolean(),
  autoApproveOrders: z.boolean().optional(),
  defaultTransporterId: z.string().uuid().nullable(),
});

const updateFustTypeSchema = z.object({
  type: z.literal("fustType"),
  id: z.string().uuid().optional(), // omit for create
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  pricePerUnit: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
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

    const { growerId, fustEnabled, autoApproveOrders, defaultTransporterId } = parsed.data;

    // Cannot enable fust without a transporter
    if (fustEnabled && !defaultTransporterId) {
      return NextResponse.json({ error: "A default transporter is required when enabling fust" }, { status: 400 });
    }

    await prisma.grower.update({
      where: { id: growerId },
      data: {
        fustEnabled,
        defaultTransporterId,
        // Auto-approve only makes sense when fust is enabled
        autoApproveOrders: fustEnabled ? (autoApproveOrders ?? false) : false,
      },
    });
    return NextResponse.json({ success: true });
  }

  if (body.type === "fustType") {
    const parsed = updateFustTypeSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, type: _t, ...data } = parsed.data;
    if (id) {
      await prisma.fustType.update({ where: { id }, data });
    } else {
      // Create: code, name, category, pricePerUnit are required
      if (!data.code || !data.name || !data.category || data.pricePerUnit === undefined) {
        return NextResponse.json({ error: "code, name, category, and pricePerUnit are required for new fust types" }, { status: 400 });
      }
      await prisma.fustType.create({
        data: {
          code: data.code,
          name: data.name,
          category: data.category,
          pricePerUnit: data.pricePerUnit,
          isActive: data.isActive ?? true,
          sortOrder: data.sortOrder ?? 0,
        },
      });
    }
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

// DELETE: Remove a fust type or transporter
const deleteSchema = z.object({
  type: z.enum(["fustType", "transporter"]),
  id: z.string().uuid(),
});

export async function DELETE(request: NextRequest) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const body = await request.json();
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { type, id } = parsed.data;

  if (type === "fustType") {
    // Check for existing order items referencing this fust type
    const usageCount = await prisma.fustOrderItem.count({ where: { fustTypeId: id } });
    if (usageCount > 0) {
      return NextResponse.json(
        { error: "Cannot delete: this fust type is used in existing orders. Deactivate it instead." },
        { status: 409 }
      );
    }
    await prisma.fustType.delete({ where: { id } });
    return NextResponse.json({ success: true });
  }

  if (type === "transporter") {
    // Check for existing pickups or growers using this transporter
    const [pickupCount, growerCount] = await Promise.all([
      prisma.fustPickup.count({ where: { transporterId: id } }),
      prisma.grower.count({ where: { defaultTransporterId: id } }),
    ]);
    if (pickupCount > 0 || growerCount > 0) {
      return NextResponse.json(
        { error: "Cannot delete: this transporter is linked to pickups or growers. Deactivate it instead." },
        { status: 409 }
      );
    }
    await prisma.transporter.delete({ where: { id } });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown type" }, { status: 400 });
}
