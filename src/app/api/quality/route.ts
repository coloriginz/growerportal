import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveGrowerId } from "@/lib/api-helpers";
import { startOfYear } from "date-fns";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const requestedGrowerId = request.nextUrl.searchParams.get("growerId");
  const growerId = resolveGrowerId(session!, requestedGrowerId);

  if (!growerId) {
    return NextResponse.json({
      summary: { totalIssues: 0, totalAffectedStems: 0, qualityRate: 100, mostCommonIssue: null },
      issues: [],
    });
  }

  const issues = await prisma.qualityIssue.findMany({
    where: { growerId },
    include: {
      lot: { select: { id: true, lotNumber: true, productName: true } },
    },
    orderBy: { date: "desc" },
  });

  // Summary stats (YTD)
  const ytdStart = startOfYear(new Date());
  const ytdIssues = issues.filter((i) => i.date >= ytdStart);
  const totalAffectedStems = ytdIssues.reduce((sum, i) => sum + i.stems, 0);

  // Total stems YTD for quality rate
  const totalStemsAgg = await prisma.transaction.aggregate({
    where: {
      lot: { growerId },
      isCorrection: false,
      date: { gte: ytdStart },
    },
    _sum: { stems: true },
  });
  const totalStems = totalStemsAgg._sum.stems || 0;
  const qualityRate = totalStems > 0 ? ((totalStems - totalAffectedStems) / totalStems) * 100 : 100;

  // Most common issue code
  const codeCounts = new Map<string, { count: number; description: string }>();
  for (const issue of ytdIssues) {
    const existing = codeCounts.get(issue.code);
    if (existing) {
      existing.count++;
    } else {
      codeCounts.set(issue.code, { count: 1, description: issue.description });
    }
  }
  let mostCommonIssue: { code: string; description: string; count: number } | null = null;
  for (const [code, { count, description }] of codeCounts) {
    if (!mostCommonIssue || count > mostCommonIssue.count) {
      mostCommonIssue = { code, description, count };
    }
  }

  return NextResponse.json({
    summary: {
      totalIssues: ytdIssues.length,
      totalAffectedStems,
      qualityRate,
      mostCommonIssue,
    },
    issues: issues.map((issue) => ({
      id: issue.id,
      code: issue.code,
      description: issue.description,
      stems: issue.stems,
      date: issue.date.toISOString(),
      lot: issue.lot,
    })),
  });
}
