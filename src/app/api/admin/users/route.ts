import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

export async function GET() {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const users = await prisma.user.findMany({
    include: {
      grower: { select: { code: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    users.map((u: { id: string; name: string; email: string; role: string; isActive: boolean; grower: { code: string; name: string } | null }) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      grower: u.grower,
    }))
  );
}
