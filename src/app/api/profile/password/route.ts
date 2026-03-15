import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { compare, hash } from "bcryptjs";

export async function PUT(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const body = await request.json();
  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Both fields are required" }, { status: 400 });
  }

  if (newPassword.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session!.user.id },
    select: { passwordHash: true },
  });

  if (!user?.passwordHash) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const isValid = await compare(currentPassword, user.passwordHash);
  if (!isValid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });
  }

  const newHash = await hash(newPassword, 12);
  await prisma.user.update({
    where: { id: session!.user.id },
    data: { passwordHash: newHash },
  });

  return NextResponse.json({ success: true });
}
