import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { processEmailIngestion } from "@/app/api/fust/vouchers/import-email/route";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth(["admin", "finance"]);
  if (error) return error;

  const { id } = await params;

  const ingestion = await prisma.fustEmailIngestion.findUnique({
    where: { id },
  });

  if (!ingestion) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Delete previously created voucher (if any) so reprocessing can recreate it.
  // Cascade deletes items + order links automatically.
  if (ingestion.voucherId) {
    await prisma.fustIssuanceVoucher.delete({
      where: { id: ingestion.voucherId },
    }).catch(() => {
      // Voucher may have been deleted manually — ignore
    });
  }

  // Reset status to PROCESSING
  await prisma.fustEmailIngestion.update({
    where: { id },
    data: {
      status: "PROCESSING",
      errors: null,
      voucherId: null,
      pdfUrl: null,
      reportId: null,
      transactionNumber: null,
    },
  });

  try {
    await processEmailIngestion(id);
    const updated = await prisma.fustEmailIngestion.findUnique({
      where: { id },
      include: {
        voucher: {
          select: { id: true, transactionNumber: true, type: true },
        },
      },
    });
    return NextResponse.json(updated);
  } catch (err) {
    await prisma.fustEmailIngestion.update({
      where: { id },
      data: {
        status: "ERROR",
        errors: err instanceof Error ? err.message : String(err),
      },
    });
    const updated = await prisma.fustEmailIngestion.findUnique({
      where: { id },
      include: {
        voucher: {
          select: { id: true, transactionNumber: true, type: true },
        },
      },
    });
    return NextResponse.json(updated);
  }
}
