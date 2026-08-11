import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import bcrypt from "bcryptjs";

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { token, password } = parsed.data;

  // Find user by activation token
  const user = await prisma.user.findUnique({
    where: { activationToken: token },
  });

  if (!user) {
    return NextResponse.json(
      { error: "Invalid or expired activation token" },
      { status: 404 }
    );
  }

  // Hash password and activate user
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      isActive: true,
      // The account is in use again; a stale timestamp here would make SSO
      // refuse someone who just activated through the normal route.
      deactivatedAt: null,
      activationToken: null,
    },
  });

  return NextResponse.json({ success: true });
}
