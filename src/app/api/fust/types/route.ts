import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const types = await prisma.fustType.findMany({
    where: { isActive: true },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
  });

  return NextResponse.json(types);
}
