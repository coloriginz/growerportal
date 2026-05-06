import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth, resolveSupplierId } from "@/lib/api-helpers";

const forecastSchema = z.object({
  productName: z.string().min(1),
  articleGroup: z.string().optional().nullable(),
  year: z.number().int().min(2020).max(2100),
  week: z.number().int().min(1).max(53),
  stems: z.number().int().min(0),
  trolleys: z.number().int().min(0).optional().nullable(),
  colli: z.number().int().min(0).optional().nullable(),
});

const batchSchema = z.object({
  supplierId: z.string().optional(),
  forecasts: z.array(forecastSchema),
});

const deleteProductSchema = z.object({
  supplierId: z.string().optional(),
  productName: z.string().min(1),
});

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const params = request.nextUrl.searchParams;
  const requestedSupplierId = params.get("supplierId");
  const supplierId = resolveSupplierId(session!, requestedSupplierId);

  if (!supplierId) {
    return NextResponse.json({ forecasts: [], products: [] });
  }

  const yearFrom = parseInt(params.get("yearFrom") || "0");
  const weekFrom = parseInt(params.get("weekFrom") || "0");
  const yearTo = parseInt(params.get("yearTo") || "0");
  const weekTo = parseInt(params.get("weekTo") || "0");

  if (!yearFrom || !weekFrom || !yearTo || !weekTo) {
    return NextResponse.json(
      { error: "yearFrom, weekFrom, yearTo, weekTo are required" },
      { status: 400 }
    );
  }

  // Fetch forecasts in the given week range
  const forecasts = await prisma.shipmentForecast.findMany({
    where: {
      supplierId,
      OR: [
        // Same year: week between from and to
        {
          year: yearFrom,
          ...(yearFrom === yearTo
            ? { week: { gte: weekFrom, lte: weekTo } }
            : { week: { gte: weekFrom } }),
        },
        // If spanning years: include all weeks in between years
        ...(yearTo > yearFrom + 1
          ? [{ year: { gt: yearFrom, lt: yearTo } }]
          : []),
        // End year (if different from start)
        ...(yearTo > yearFrom
          ? [{ year: yearTo, week: { lte: weekTo } }]
          : []),
      ],
    },
    orderBy: [{ year: "asc" }, { week: "asc" }],
  });

  // Get distinct product names from historical lots for autocomplete
  const lotProducts = await prisma.lot.findMany({
    where: { supplierId },
    select: { productName: true, articleGroup: true },
    distinct: ["productName"],
    orderBy: { productName: "asc" },
  });

  // Also include products from existing forecasts
  const forecastProducts = await prisma.shipmentForecast.findMany({
    where: { supplierId },
    select: { productName: true, articleGroup: true },
    distinct: ["productName"],
    orderBy: { productName: "asc" },
  });

  // Merge and deduplicate
  const productMap = new Map<string, string | null>();
  for (const p of lotProducts) {
    productMap.set(p.productName, p.articleGroup);
  }
  for (const p of forecastProducts) {
    if (!productMap.has(p.productName)) {
      productMap.set(p.productName, p.articleGroup);
    }
  }

  const products = Array.from(productMap.entries())
    .map(([name, articleGroup]) => ({ name, articleGroup }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ forecasts, products });
}

export async function POST(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const body = await request.json();
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { forecasts } = parsed.data;
  const requestedSupplierId = parsed.data.supplierId || null;
  const supplierId = resolveSupplierId(session!, requestedSupplierId);

  if (!supplierId) {
    return NextResponse.json({ error: "No supplier specified" }, { status: 400 });
  }

  const results = [];

  for (const forecast of forecasts) {
    if (forecast.stems === 0 && !forecast.trolleys && !forecast.colli) {
      // Delete the record if all values are zero/empty
      await prisma.shipmentForecast.deleteMany({
        where: {
          supplierId,
          productName: forecast.productName,
          year: forecast.year,
          week: forecast.week,
        },
      });
      results.push({ ...forecast, deleted: true });
    } else {
      // Upsert
      const result = await prisma.shipmentForecast.upsert({
        where: {
          supplierId_productName_year_week: {
            supplierId,
            productName: forecast.productName,
            year: forecast.year,
            week: forecast.week,
          },
        },
        create: {
          supplierId,
          productName: forecast.productName,
          articleGroup: forecast.articleGroup ?? null,
          year: forecast.year,
          week: forecast.week,
          stems: forecast.stems,
          trolleys: forecast.trolleys ?? null,
          colli: forecast.colli ?? null,
          createdById: session!.user.id,
        },
        update: {
          stems: forecast.stems,
          trolleys: forecast.trolleys ?? null,
          colli: forecast.colli ?? null,
          articleGroup: forecast.articleGroup ?? null,
        },
      });
      results.push(result);
    }
  }

  return NextResponse.json({ results });
}

export async function DELETE(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const body = await request.json();
  const parsed = deleteProductSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const requestedSupplierId = parsed.data.supplierId || null;
  const supplierId = resolveSupplierId(session!, requestedSupplierId);

  if (!supplierId) {
    return NextResponse.json({ error: "No supplier specified" }, { status: 400 });
  }

  const deleted = await prisma.shipmentForecast.deleteMany({
    where: {
      supplierId,
      productName: parsed.data.productName,
    },
  });

  return NextResponse.json({ deleted: deleted.count });
}
