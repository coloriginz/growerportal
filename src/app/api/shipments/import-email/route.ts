import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import { put, del } from "@vercel/blob";
import { requireImportAuth } from "@/lib/import-auth";
import {
  parseSalesSheetFilename,
  parseSalesSheetFilenameSimple,
  parseSalesSheetFilenameLoose,
} from "@/lib/salessheet-filename-parser";
import { parseSalesSheetPdf } from "@/lib/salessheet-pdf-parser";
import { z } from "zod";

// Elke bijlage kost een PDF-parse plus een blob-upload; een mail met een handvol
// salessheets erin haalt de standaardlimiet niet. De bulk-koppeling in
// scripts/link-salessheet-pdfs.ts stuurt er bewust meerdere per verzoek.
export const maxDuration = 300;

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
  // Also check filename extension — Power Automate may send PDFs as "application/octet-stream"
  const isPdf = (a: { name: string; contentType: string }) =>
    a.contentType.toLowerCase().includes("pdf") || a.name.toLowerCase().endsWith(".pdf");
  const pdfAttachments = attachments.filter(
    (a) => isPdf(a) && a.isInline !== true
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
    if (!isPdf(a) || a.isInline === true) {
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

type SalesSheetCandidate = Prisma.SalesSheetGetPayload<{
  include: { supplier: { select: { id: true; code: true } } };
}>;

/**
 * Collect every sales sheet a reference could point at.
 *
 * Sales sheet numbers recycle per year while SalesSheet.invoiceNumber is
 * globally unique, so the lots import stores a colliding number with a
 * "-<parthdrId>" suffix (see src/app/api/import/lots/route.ts). Reference "95"
 * must therefore also consider "95-2254938".
 *
 * ourInvoiceNumber is included as a candidate source but never trusted on its
 * own: wrongly linked PDFs wrote their own number onto the sales sheet, so the
 * field can carry the very error this matching is meant to catch.
 */
async function findCandidates(
  references: (string | null)[],
  ourInvoiceNumber: string | null
) {
  const refs = [...new Set(references.filter((r): r is string => !!r))];
  const include = { supplier: { select: { id: true, code: true } } } as const;
  const byId = new Map<string, SalesSheetCandidate>();

  for (const ref of refs) {
    const rows = await prisma.salesSheet.findMany({
      where: { OR: [{ invoiceNumber: ref }, { invoiceNumber: { startsWith: `${ref}-` } }] },
      include,
    });
    // startsWith also catches genuine numbers like "212-28"; keep only the
    // exact reference and the numeric parthdrId suffix the import appends.
    const suffixed = new RegExp(`^${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d{5,}$`);
    for (const row of rows) {
      if (row.invoiceNumber === ref || suffixed.test(row.invoiceNumber)) byId.set(row.id, row);
    }
  }

  if (ourInvoiceNumber) {
    const rows = await prisma.salesSheet.findMany({ where: { ourInvoiceNumber }, include });
    for (const row of rows) byId.set(row.id, row);
  }

  return [...byId.values()];
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
  } else {
    // Fallback: simple filename like "135-23-380914.pdf", then the loose form
    // that also allows letters and spaces in the reference ("C002 Blom-371364").
    const simple =
      parseSalesSheetFilenameSimple(attachment.name) ?? parseSalesSheetFilenameLoose(attachment.name);
    if (simple) {
      reference = simple.reference;
      ourInvoiceNumber = simple.ourInvoiceNumber;
    }
  }

  // Step 2: Read the PDF. The delivery date printed on it is what tells two
  // sales sheets with the same recycled number apart.
  let pdfReference: string | null = null;
  let deliveryDate: string | null = null;
  try {
    const pdfParsed = await parseSalesSheetPdf(pdfBuffer);
    pdfReference = pdfParsed.reference;
    deliveryDate = pdfParsed.deliveryDate;
    ourInvoiceNumber = ourInvoiceNumber || pdfParsed.ourInvoiceNumber;
  } catch {
    // PDF unreadable — fall back to filename data only
  }

  // The filename carries the delivery date too. Without this fallback an
  // unreadable PDF drops the date check entirely, and a single candidate then
  // gets linked on its number alone — which is how sales sheets ended up with
  // another supplier's PDF in the first place.
  if (!deliveryDate) deliveryDate = parsed?.deliveryDate ?? null;

  let candidates = await findCandidates([reference, pdfReference], ourInvoiceNumber);
  reference = reference || pdfReference;

  if (candidates.length === 0) {
    return { ok: false, reason: reference ? `no_match:${reference}` : "no_reference" };
  }

  // The "-<parthdrId>" variants can belong to another supplier, so narrow down
  // by supplier when the filename tells us who it is. Only when that leaves
  // something — supplier codes in filenames are not guaranteed to match, and
  // the delivery date check below is the real guard.
  if (parsed?.supplierCode) {
    const ofSupplier = candidates.filter((c) => c.supplier.code === parsed.supplierCode);
    if (ofSupplier.length > 0) candidates = ofSupplier;
  }

  // Step 3: Verify against the delivery date. Only an exact match may link.
  let salesSheet: SalesSheetCandidate;
  if (deliveryDate) {
    let onDate = candidates.filter(
      (c) => c.deliveryDate.toISOString().slice(0, 10) === deliveryDate
    );
    // Two sales sheets can share a delivery date. Our own sales sheet number
    // breaks the tie: one that already carries a different number is holding
    // another PDF and is not the owner of this one.
    if (onDate.length > 1 && ourInvoiceNumber) {
      const exact = onDate.filter((c) => c.ourInvoiceNumber === ourInvoiceNumber);
      const free = onDate.filter((c) => !c.ourInvoiceNumber || c.ourInvoiceNumber === ourInvoiceNumber);
      if (exact.length === 1) onDate = exact;
      else if (free.length === 1) onDate = free;
    }
    if (onDate.length !== 1) {
      return {
        ok: false,
        reason:
          onDate.length === 0
            ? `date_mismatch:${reference}:${deliveryDate}`
            : `ambiguous:${reference}:${deliveryDate}`,
      };
    }
    salesSheet = onDate[0];
  } else {
    // No readable date: link only when there is nothing to confuse it with.
    if (candidates.length > 1) {
      return { ok: false, reason: `ambiguous_no_date:${reference}` };
    }
    salesSheet = candidates[0];
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
