import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { Prisma } from "@/generated/prisma";

export async function GET(request: NextRequest) {
  const { error } = await requireAuth(["admin", "commercie", "finance"]);
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25", 10)));
  const search = searchParams.get("search")?.trim() || "";
  const status = searchParams.get("status") || "";

  const where: Prisma.SalesSheetIngestionWhereInput = {};

  if (status && status !== "all") {
    where.status = status;
  }

  if (search) {
    where.OR = [
      { subject: { contains: search, mode: "insensitive" } },
      { fromAddress: { contains: search, mode: "insensitive" } },
      { details: { contains: search, mode: "insensitive" } },
      { errors: { contains: search, mode: "insensitive" } },
    ];
  }

  const [ingestions, total] = await Promise.all([
    prisma.salesSheetIngestion.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.salesSheetIngestion.count({ where }),
  ]);

  // Parse the details JSON to extract processed items with salesSheetIds
  const items = ingestions.map((ing) => {
    let processed: { fileName: string; salesSheetId: string; invoiceNumber: string; ourInvoiceNumber: string; supplierCode: string }[] = [];
    let skipped: { fileName: string; reason: string }[] = [];
    if (ing.details) {
      try {
        const details = JSON.parse(ing.details);
        processed = details.processed || [];
        skipped = details.skipped || [];
      } catch {
        // ignore parse errors
      }
    }
    return {
      id: ing.id,
      subject: ing.subject,
      fromAddress: ing.fromAddress,
      receivedAt: ing.receivedAt?.toISOString() || null,
      processedAt: ing.processedAt.toISOString(),
      status: ing.status,
      attachmentCount: ing.attachmentCount,
      processedCount: ing.processedCount,
      skippedCount: ing.skippedCount,
      errors: ing.errors,
      createdAt: ing.createdAt.toISOString(),
      processed,
      skipped,
    };
  });

  return NextResponse.json({
    items,
    page,
    totalPages: Math.ceil(total / limit),
    total,
  });
}
