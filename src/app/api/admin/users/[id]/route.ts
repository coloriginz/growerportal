import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const { id } = await params;
  const body = await request.json();

  const user = await prisma.user.update({
    where: { id },
    data: { isActive: body.isActive },
  });

  return NextResponse.json({ id: user.id, isActive: user.isActive });
}
