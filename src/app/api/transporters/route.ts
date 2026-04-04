import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

// GET: All active transporters (for test banner entity selector)
export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  const transporters = await prisma.transporter.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(transporters);
}
