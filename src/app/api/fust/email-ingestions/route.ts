import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  const { error } = await requireAuth(["admin", "finance"]);
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};

  if (status) {
    where.status = status;
  }

  if (search) {
    where.OR = [
      { subject: { contains: search, mode: "insensitive" } },
      { fromAddress: { contains: search, mode: "insensitive" } },
      { transactionNumber: { contains: search, mode: "insensitive" } },
    ];
  }

  const [ingestions, total] = await Promise.all([
    prisma.fustEmailIngestion.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        subject: true,
        fromAddress: true,
        receivedAt: true,
        processedAt: true,
        status: true,
        errors: true,
        transactionNumber: true,
        reportId: true,
        pdfUrl: true,
        voucherId: true,
        createdAt: true,
        updatedAt: true,
        voucher: {
          select: {
            id: true,
            transactionNumber: true,
            type: true,
          },
        },
      },
    }),
    prisma.fustEmailIngestion.count({ where }),
  ]);

  return NextResponse.json({
    ingestions,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
