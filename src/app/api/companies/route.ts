import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

export async function GET() {
  const { error } = await requireAuth(["admin", "commercie", "finance"]);
  if (error) return error;

  const companies = await prisma.company.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
    },
  });

  return NextResponse.json(companies);
}
