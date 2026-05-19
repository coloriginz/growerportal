import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { z } from "zod";
import { ROLES } from "@/types";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const { id } = await params;
  const body = await request.json();

  const schema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    role: z.enum(ROLES as unknown as [string, ...string[]]).optional(),
    kbtCode: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
    transporterId: z.string().uuid().nullable().optional(),
    companyIds: z.array(z.string().uuid()).optional(),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;

  // Check email uniqueness if changing email
  if (data.email) {
    const existing = await prisma.user.findFirst({
      where: { email: data.email, id: { not: id } },
    });
    if (existing) {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }
  }

  // Transporteur role requires transporter link
  if (data.role === "transporteur" && data.transporterId === undefined) {
    const current = await prisma.user.findUnique({ where: { id }, select: { transporterId: true } });
    if (!current?.transporterId) {
      return NextResponse.json({ error: "Transporter is required for transporteur role" }, { status: 400 });
    }
  }

  // Clear transporterId if switching away from transporteur
  const { companyIds, ...rest } = data;
  const updateData: Record<string, unknown> = { ...rest };
  if (data.role && data.role !== "transporteur") {
    updateData.transporterId = null;
  }

  // Handle company (label) access
  if (companyIds !== undefined) {
    updateData.companies = { set: companyIds.map((cid) => ({ id: cid })) };
  }

  const user = await prisma.user.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["admin"]);
  if (error) return error;

  const { id } = await params;

  // Prevent self-deletion
  if (id === session!.user.id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  await prisma.user.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
