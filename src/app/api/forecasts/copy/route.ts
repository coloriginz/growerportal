import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth, resolveGrowerId } from "@/lib/api-helpers";

const copySchema = z.object({
  growerId: z.string().optional(),
  sourceYear: z.number().int(),
  sourceWeek: z.number().int().min(1).max(53),
  numberOfWeeks: z.number().int().min(1).max(12),
});

function getNextWeek(year: number, week: number): { year: number; week: number } {
  // ISO weeks: most years have 52, some have 53
  const maxWeek = getISOWeeksInYear(year);
  if (week >= maxWeek) {
    return { year: year + 1, week: 1 };
  }
  return { year, week: week + 1 };
}

function getISOWeeksInYear(year: number): number {
  // A year has 53 ISO weeks if January 1 is a Thursday,
  // or December 31 is a Thursday
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  return jan1.getDay() === 4 || dec31.getDay() === 4 ? 53 : 52;
}

export async function POST(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const body = await request.json();
  const parsed = copySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { sourceYear, sourceWeek, numberOfWeeks } = parsed.data;
  const requestedGrowerId = parsed.data.growerId || null;
  const growerId = resolveGrowerId(session!, requestedGrowerId);

  if (!growerId) {
    return NextResponse.json({ error: "No grower specified" }, { status: 400 });
  }

  // Fetch source week data
  const sourceForecasts = await prisma.shipmentForecast.findMany({
    where: { growerId, year: sourceYear, week: sourceWeek },
  });

  if (sourceForecasts.length === 0) {
    return NextResponse.json(
      { error: "No forecasts found in source week" },
      { status: 404 }
    );
  }

  // Generate target weeks
  const targetWeeks: { year: number; week: number }[] = [];
  let current = { year: sourceYear, week: sourceWeek };
  for (let i = 0; i < numberOfWeeks; i++) {
    current = getNextWeek(current.year, current.week);
    targetWeeks.push(current);
  }

  // Copy data to each target week
  let copiedCount = 0;
  for (const target of targetWeeks) {
    for (const forecast of sourceForecasts) {
      await prisma.shipmentForecast.upsert({
        where: {
          growerId_productName_year_week: {
            growerId,
            productName: forecast.productName,
            year: target.year,
            week: target.week,
          },
        },
        create: {
          growerId,
          productName: forecast.productName,
          articleGroup: forecast.articleGroup,
          year: target.year,
          week: target.week,
          stems: forecast.stems,
          trolleys: forecast.trolleys,
          colli: forecast.colli,
          createdById: session!.user.id,
        },
        update: {
          stems: forecast.stems,
          trolleys: forecast.trolleys,
          colli: forecast.colli,
          articleGroup: forecast.articleGroup,
        },
      });
      copiedCount++;
    }
  }

  return NextResponse.json({
    copied: copiedCount,
    targetWeeks,
  });
}
