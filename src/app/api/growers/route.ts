import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await requireAuth(["admin", "commercie"]);
  if (error) return error;

  const growers = await prisma.grower.findMany({
    select: { id: true, code: true, name: true, company: true },
    orderBy: { code: "asc" },
  });

  return NextResponse.json(growers);
}
