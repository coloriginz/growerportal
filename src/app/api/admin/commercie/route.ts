import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

export async function GET() {
  const { error } = await requireAuth(["admin", "commercie"]);
  if (error) return error;

  const users = await prisma.user.findMany({
    where: { role: { in: ["commercie", "admin"] }, isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(users);
}
