import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth(["admin", "finance"]);
  if (error) return error;

  const { id } = await params;

  const ingestion = await prisma.fustEmailIngestion.findUnique({
    where: { id },
    include: {
      voucher: {
        select: {
          id: true,
          transactionNumber: true,
          type: true,
          transactionDate: true,
          customerName: true,
          items: {
            select: {
              id: true,
              fustCode: true,
              description: true,
              quantity: true,
            },
          },
        },
      },
    },
  });

  if (!ingestion) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(ingestion);
}
