import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveGrowerId } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const requestedGrowerId = request.nextUrl.searchParams.get("growerId");
  const growerId = resolveGrowerId(session!, requestedGrowerId);

  if (!growerId) {
    return NextResponse.json([]);
  }

  const issues = await prisma.qualityIssue.findMany({
    where: { growerId },
    include: {
      lot: { select: { id: true, lotNumber: true, productName: true } },
    },
    orderBy: { date: "desc" },
  });

  return NextResponse.json(
    issues.map((issue: { id: string; code: string; description: string; stems: number; date: Date; lot: { id: string; lotNumber: string; productName: string } }) => ({
      id: issue.id,
      code: issue.code,
      description: issue.description,
      stems: issue.stems,
      date: issue.date.toISOString(),
      lot: issue.lot,
    }))
  );
}
