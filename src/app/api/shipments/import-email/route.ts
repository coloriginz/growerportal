import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { put, del } from "@vercel/blob";
import { requireImportAuth } from "@/lib/import-auth";
import { parseSalesSheetFilename } from "@/lib/salessheet-filename-parser";
import { parseSalesSheetPdf } from "@/lib/salessheet-pdf-parser";
import { z } from "zod";

const attachmentSchema = z.object({
  name: z.string(),
  contentType: z.string(),
  contentBytes: z.string(),
  size: z.number().optional(),
  isInline: z.boolean().optional(),
});

const importEmailSchema = z.object({
  subject: z.string(),
  from: z.string(),
  receivedDateTime: z.string(),
  body: z.string().optional(),
  bodyHtml: z.string().optional(),
  attachments: z.array(attachmentSchema),
});

interface ProcessedItem {
  fileName: string;
  salesSheetId: string;
  invoiceNumber: string;
  ourInvoiceNumber: string;
  supplierCode: string;
  documentId: string;
}

interface SkippedItem {
  fileName: string;
  reason: string;
}

export async function POST(request: NextRequest) {
  // Auth
  const authError = requireImportAuth(request);
  if (authError) return authError;

  // Parse body
  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = importEmailSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parseResult.error.flatten() },
      { status: 400 }
    );
  }

  const { subject, from, receivedDateTime, attachments } = parseResult.data;

  // Create ingestion record
  const ingestion = await prisma.salesSheetIngestion.create({
    data: {
      subject,
      fromAddress: from,
      receivedAt: receivedDateTime ? new Date(receivedDateTime) : null,
      status: "PROCESSING",
      attachmentCount: attachments.length,
    },
  });

  // Filter PDF attachments (skip inline, skip non-PDF)
  const pdfAttachments = attachments.filter(
    (a) => a.contentType.toLowerCase().includes("pdf") && a.isInline !== true
  );

  if (pdfAttachments.length === 0) {
    await prisma.salesSheetIngestion.update({
      where: { id: ingestion.id },
      data: {
        status: "ERROR",
        errors: "No PDF attachments found",
        skippedCount: attachments.length,
      },
    });
    return NextResponse.json(
      { error: "No PDF attachments found", ingestionId: ingestion.id },
      { status: 422 }
    );
  }

  const processed: ProcessedItem[] = [];
  const skipped: SkippedItem[] = [];

  for (const attachment of pdfAttachments) {
    const result = await processAttachment(attachment);
    if (result.ok) {
      processed.push(result.data);
    } else {
      skipped.push({ fileName: attachment.name, reason: result.reason });
    }
  }

  // Also count non-PDF attachments as skipped
  for (const a of attachments) {
    if (!a.contentType.toLowerCase().includes("pdf") || a.isInline === true) {
      skipped.push({ fileName: a.name, reason: "not_pdf" });
    }
  }

  // Determine final status
  const status =
    processed.length === 0
      ? "ERROR"
      : skipped.filter((s) => s.reason !== "not_pdf").length > 0
        ? "PARTIAL"
        : "PROCESSED";

  await prisma.salesSheetIngestion.update({
    where: { id: ingestion.id },
    data: {
      status,
      processedCount: processed.length,
      skippedCount: skipped.length,
      details: JSON.stringify({ processed, skipped }),
    },
  });

  return NextResponse.json(
    { ingestionId: ingestion.id, processed, skipped },
    { status: 201 }
  );
}

async function processAttachment(
  attachment: z.infer<typeof attachmentSchema>
): Promise<{ ok: true; data: ProcessedItem } | { ok: false; reason: string }> {
  const pdfBuffer = Buffer.from(attachment.contentBytes, "base64");

  // Step 1: Try filename parsing
  let reference: string | null = null;
  let ourInvoiceNumber: string | null = null;

  const parsed = parseSalesSheetFilename(attachment.name);
  if (parsed) {
    reference = parsed.reference;
    ourInvoiceNumber = parsed.ourInvoiceNumber;
  }

  // Step 2: Try matching by filename reference
  let salesSheet = reference
    ? await prisma.salesSheet.findUnique({
        where: { invoiceNumber: reference },
        include: { supplier: { select: { id: true, code: true } } },
      })
    : null;

  // Step 3: Fallback — parse PDF content
  if (!salesSheet) {
    try {
      const pdfParsed = await parseSalesSheetPdf(pdfBuffer);
      if (pdfParsed.reference) {
        reference = pdfParsed.reference;
        ourInvoiceNumber = ourInvoiceNumber || pdfParsed.ourInvoiceNumber;
        salesSheet = await prisma.salesSheet.findUnique({
          where: { invoiceNumber: pdfParsed.reference },
          include: { supplier: { select: { id: true, code: true } } },
        });
      }
    } catch {
      // PDF parsing failed — continue with no match
    }
  }

  if (!salesSheet) {
    return { ok: false, reason: reference ? `no_match:${reference}` : "no_reference" };
  }

  // Step 4: Handle duplicate — delete old document if exists
  if (salesSheet.pdfDocumentId) {
    const oldDoc = await prisma.document.findUnique({
      where: { id: salesSheet.pdfDocumentId },
    });
    if (oldDoc) {
      try {
        await del(oldDoc.fileUrl);
      } catch {
        // Blob deletion failed — not critical
      }
      await prisma.document.delete({ where: { id: oldDoc.id } });
    }
  }

  // Step 5: Upload to Vercel Blob
  const blob = await put(
    `salessheets/${Date.now()}-${attachment.name}`,
    pdfBuffer,
    { access: "public", contentType: "application/pdf" }
  );

  // Step 6: Create Document record
  const document = await prisma.document.create({
    data: {
      supplierId: salesSheet.supplierId,
      type: "salessheet",
      name: `Sales Sheet ${salesSheet.invoiceNumber}`,
      fileName: attachment.name,
      fileUrl: blob.url,
      fileSize: pdfBuffer.length,
      mimeType: "application/pdf",
    },
  });

  // Step 7: Update SalesSheet — link document + store invoice number
  await prisma.salesSheet.update({
    where: { id: salesSheet.id },
    data: {
      pdfDocumentId: document.id,
      ourInvoiceNumber: ourInvoiceNumber || undefined,
    },
  });

  return {
    ok: true,
    data: {
      fileName: attachment.name,
      salesSheetId: salesSheet.id,
      invoiceNumber: salesSheet.invoiceNumber,
      ourInvoiceNumber: ourInvoiceNumber || "",
      supplierCode: salesSheet.supplier.code,
      documentId: document.id,
    },
  };
}
