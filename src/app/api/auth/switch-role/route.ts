import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { isTest } from "@/lib/env";
import { prisma } from "@/lib/db";
import { ROLES } from "@/types";

export async function POST(request: NextRequest) {
  // Only available in test/development
  if (!isTest) {
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }

  const { error, session } = await requireAuth();
  if (error) return error;

  const body = await request.json();
  const { role } = body;

  if (!role || !ROLES.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  // Update user role in DB
  const updated = await prisma.user.update({
    where: { id: session!.user.id },
    data: { role },
    include: { grower: true },
  });

  return NextResponse.json({
    role: updated.role,
    growerId: updated.growerId,
    growerCode: updated.grower?.code ?? null,
    transporterId: updated.transporterId,
  });
}
