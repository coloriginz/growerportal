import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { z } from "zod";
import { ROLES } from "@/types";
import { composeName } from "@/lib/person-name";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const { id } = await params;
  const body = await request.json();

  const schema = z.object({
    // `name` blijft geaccepteerd voor aanroepers die alleen een hele naam
    // kennen; komen de losse velden mee, dan winnen die en wordt `name` eruit
    // samengesteld.
    name: z.string().min(1).optional(),
    firstName: z.string().trim().min(1).optional(),
    middleName: z.string().trim().optional(),
    lastName: z.string().trim().min(1).optional(),
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

  // Een naam die in delen binnenkomt, wordt hier weer één weergavenaam. De
  // delen die niet meekomen worden van de opgeslagen gebruiker gelezen, zodat
  // een PATCH met alleen een achternaam de voornaam niet uit `name` gooit.
  if (data.firstName !== undefined || data.middleName !== undefined || data.lastName !== undefined) {
    const current = await prisma.user.findUnique({
      where: { id },
      select: { firstName: true, middleName: true, lastName: true },
    });
    const parts = {
      firstName: data.firstName ?? current?.firstName ?? "",
      middleName: data.middleName ?? current?.middleName ?? "",
      lastName: data.lastName ?? current?.lastName ?? "",
    };
    updateData.middleName = parts.middleName || null;
    updateData.name = composeName(parts);
  }
  if (data.role && data.role !== "transporteur") {
    updateData.transporterId = null;
  }

  // Keep deactivatedAt in step with isActive. SSO refuses on the timestamp, so
  // leaving a stale one behind would lock out an account that is switched back
  // on, and leaving it unset would let a switched-off account sign in.
  if (data.isActive === false) {
    updateData.deactivatedAt = new Date();
  } else if (data.isActive === true) {
    updateData.deactivatedAt = null;
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
    firstName: user.firstName,
    middleName: user.middleName,
    lastName: user.lastName,
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
