import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

export async function GET() {
  const { error } = await requireAuth(["admin", "commercie", "finance"]);
  if (error) return error;

  const ingestions = await prisma.salesSheetIngestion.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Parse the details JSON to extract processed items with salesSheetIds
  const result = ingestions.map((ing) => {
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

  return NextResponse.json(result);
}
