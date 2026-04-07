import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { put } from "@vercel/blob";
import {
  parseIssuanceVoucherPdf,
  parseRfhDate,
} from "@/features/fust/lib/voucher-parser";
import { logFustEvent } from "@/lib/fust-audit";
import { z } from "zod";

const importEmailSchema = z.object({
  subject: z.string(),
  bodyHtml: z.string(),
  from: z.string().optional(),
  receivedDateTime: z.string().optional(),
  body: z.string().optional(),
});

export async function POST(request: NextRequest) {
  // API key auth
  const apiKey = request.headers.get("x-api-key");
  const expectedKey = process.env.FUST_EMAIL_IMPORT_KEY;
  if (!expectedKey || apiKey !== expectedKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await request.json();
  const result = importEmailSchema.safeParse(rawBody);
  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const { subject, bodyHtml, from, receivedDateTime, body } = result.data;

  // Create ingestion record immediately
  const ingestion = await prisma.fustEmailIngestion.create({
    data: {
      subject,
      fromAddress: from ?? null,
      receivedAt: receivedDateTime ? new Date(receivedDateTime) : null,
      emailBody: body ?? null,
      emailBodyHtml: bodyHtml,
      status: "PROCESSING",
    },
  });

  // Helper to mark ingestion as ERROR and return response
  async function failIngestion(error: string, status: number, extra?: Record<string, unknown>) {
    await prisma.fustEmailIngestion.update({
      where: { id: ingestion.id },
      data: { status: "ERROR", errors: error },
    });
    return NextResponse.json({ error, ingestionId: ingestion.id, ...extra }, { status });
  }

  // Extract transaction number from subject
  // "Bevestiging Royal FloraHolland fusttransactie 0205366"
  const txMatch = subject.match(/fusttransactie\s+(\d{5,10})/i);
  if (!txMatch) {
    return failIngestion("Could not extract transaction number from subject", 422);
  }
  const transactionNumber = txMatch[1];

  // Update ingestion with extracted transaction number
  await prisma.fustEmailIngestion.update({
    where: { id: ingestion.id },
    data: { transactionNumber },
  });

  // Duplicate check
  const existing = await prisma.fustIssuanceVoucher.findUnique({
    where: { transactionNumber },
  });
  if (existing) {
    return failIngestion(
      `Voucher already exists for transaction ${transactionNumber}`,
      409,
      { transactionNumber, voucherId: existing.id }
    );
  }

  // Extract report UUID from email body
  const reportId = await extractReportId(bodyHtml);
  if (!reportId) {
    return failIngestion("Could not extract TrackOnline report ID from email body", 422);
  }

  // Update ingestion with report ID
  await prisma.fustEmailIngestion.update({
    where: { id: ingestion.id },
    data: { reportId },
  });

  // Fetch PDF from TrackOnline
  let pdfBuffer: Buffer;
  try {
    const pdfResponse = await fetch(
      `https://app-rpt.trackonline.com/api/v1/external/report?id=${reportId}`
    );
    if (!pdfResponse.ok) {
      return failIngestion(
        `Failed to fetch PDF from TrackOnline (HTTP ${pdfResponse.status})`,
        502,
        { reportId }
      );
    }
    pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
  } catch (err) {
    return failIngestion(
      `TrackOnline request failed: ${String(err)}`,
      502,
      { reportId }
    );
  }

  // Parse the PDF
  const parsed = await parseIssuanceVoucherPdf(pdfBuffer);

  // Use transaction number from email subject as fallback
  if (!parsed.transactionNumber) {
    parsed.transactionNumber = transactionNumber;
  }

  // Store in Vercel Blob
  const blob = await put(
    `fust-vouchers/${Date.now()}-voucher-${transactionNumber}.pdf`,
    pdfBuffer,
    { access: "public", contentType: "application/pdf" }
  );

  // Parse dates
  const transactionDate = parsed.transactionDate
    ? parseRfhDate(parsed.transactionDate)
    : null;
  const creationDate = parsed.creationDate
    ? parseRfhDate(parsed.creationDate)
    : null;

  // Match fust codes against FustType table
  const fustTypes = await prisma.fustType.findMany();
  const fustTypeByCode = new Map(
    fustTypes.map((ft) => [ft.code.toLowerCase(), ft])
  );

  const itemsToCreate = parsed.items.map((item) => {
    const fustType = fustTypeByCode.get(item.fustCode.toLowerCase());
    return {
      fustCode: item.fustCode,
      description: item.description,
      quantity: item.quantity,
      fustTypeId: fustType?.id ?? null,
    };
  });

  const voucher = await prisma.fustIssuanceVoucher.create({
    data: {
      transactionNumber: parsed.transactionNumber!,
      type: parsed.type,
      transactionDate: transactionDate || new Date(),
      creationDate,
      location: parsed.location,
      customerNumber: parsed.customerNumber,
      customerName: parsed.customerName,
      transporterName: parsed.transporterName,
      cardNumber: parsed.cardNumber,
      pdfUrl: blob.url,
      items: {
        create: itemsToCreate,
      },
    },
    include: {
      items: {
        include: {
          fustType: { select: { id: true, code: true, name: true } },
        },
      },
      orderLinks: true,
    },
  });

  // Update ingestion: mark as PROCESSED, link voucher
  await prisma.fustEmailIngestion.update({
    where: { id: ingestion.id },
    data: {
      status: "PROCESSED",
      voucherId: voucher.id,
      pdfUrl: blob.url,
    },
  });

  // Audit log (no actor — system import)
  await logFustEvent({
    entityType: "voucher",
    entityId: voucher.id,
    action: "voucher_uploaded",
    metadata: {
      transactionNumber: parsed.transactionNumber,
      type: parsed.type,
      itemCount: itemsToCreate.length,
      source: "email_import",
      reportId,
      ingestionId: ingestion.id,
    },
  });

  return NextResponse.json({ ...voucher, ingestionId: ingestion.id }, { status: 201 });
}

// ─── Link extraction ────────────────────────────────────

/**
 * Extract TrackOnline report UUID from the email HTML.
 *
 * Link chain: Barracuda (linkprotect.cudasvc.com) → SendGrid → app.trackonline.com/report?id=UUID
 */
async function extractReportId(html: string): Promise<string | null> {
  // Strategy 1: Direct TrackOnline URL in HTML
  const directMatch = html.match(
    /app\.trackonline\.com\/report\?id=([0-9a-f-]{36})/i
  );
  if (directMatch) return directMatch[1];

  // Strategy 2: Find "Open rapport" link
  const hrefMatch =
    html.match(
      /title=["']Open rapport["'][^>]*href=["']([^"']+)["']/i
    ) ||
    html.match(
      /href=["']([^"']+)["'][^>]*title=["']Open rapport["']/i
    );

  if (!hrefMatch) return null;

  const href = hrefMatch[1].replace(/&amp;/g, "&");
  return resolveToReportId(href);
}

/**
 * Follow redirects from a Barracuda/SendGrid URL until we reach
 * the TrackOnline report URL and can extract the UUID.
 */
async function resolveToReportId(
  startUrl: string,
  maxRedirects = 5
): Promise<string | null> {
  let url = startUrl;

  // If Barracuda URL, extract destination from `a` parameter
  if (url.includes("linkprotect.cudasvc.com")) {
    try {
      const urlObj = new URL(url);
      const destination = urlObj.searchParams.get("a");
      if (destination) url = destination;
    } catch {
      /* continue with original URL */
    }
  }

  // Follow redirects until we find TrackOnline report URL
  for (let i = 0; i < maxRedirects; i++) {
    const idMatch = url.match(/app\.trackonline\.com\/report\?id=([0-9a-f-]{36})/i);
    if (idMatch) return idMatch[1];

    try {
      const response = await fetch(url, { redirect: "manual" });
      const location = response.headers.get("location");
      if (!location) break;
      url = location;
    } catch {
      break;
    }
  }

  // Final check on last URL
  const idMatch = url.match(/[?&]id=([0-9a-f-]{36})/i);
  return idMatch ? idMatch[1] : null;
}

/**
 * Core processing logic, reused by both import-email and reprocess.
 * Exported for use by the reprocess route.
 */
export async function processEmailIngestion(ingestionId: string) {
  const ingestion = await prisma.fustEmailIngestion.findUnique({
    where: { id: ingestionId },
  });
  if (!ingestion) throw new Error("Ingestion not found");
  if (!ingestion.subject || !ingestion.emailBodyHtml) {
    throw new Error("Missing subject or email body");
  }

  // Extract transaction number
  const txMatch = ingestion.subject.match(/fusttransactie\s+(\d{5,10})/i);
  if (!txMatch) throw new Error("Could not extract transaction number from subject");
  const transactionNumber = txMatch[1];

  await prisma.fustEmailIngestion.update({
    where: { id: ingestionId },
    data: { transactionNumber },
  });

  // Duplicate check
  const existing = await prisma.fustIssuanceVoucher.findUnique({
    where: { transactionNumber },
  });
  if (existing) {
    throw new Error(`Voucher already exists for transaction ${transactionNumber}`);
  }

  // Extract report ID
  const reportId = await extractReportId(ingestion.emailBodyHtml);
  if (!reportId) throw new Error("Could not extract TrackOnline report ID from email body");

  await prisma.fustEmailIngestion.update({
    where: { id: ingestionId },
    data: { reportId },
  });

  // Fetch PDF
  const pdfResponse = await fetch(
    `https://app-rpt.trackonline.com/api/v1/external/report?id=${reportId}`
  );
  if (!pdfResponse.ok) {
    throw new Error(`Failed to fetch PDF from TrackOnline (HTTP ${pdfResponse.status})`);
  }
  const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());

  // Parse PDF
  const parsed = await parseIssuanceVoucherPdf(pdfBuffer);
  if (!parsed.transactionNumber) parsed.transactionNumber = transactionNumber;

  // Store in Vercel Blob
  const blob = await put(
    `fust-vouchers/${Date.now()}-voucher-${transactionNumber}.pdf`,
    pdfBuffer,
    { access: "public", contentType: "application/pdf" }
  );

  // Parse dates
  const transactionDate = parsed.transactionDate ? parseRfhDate(parsed.transactionDate) : null;
  const creationDate = parsed.creationDate ? parseRfhDate(parsed.creationDate) : null;

  // Match fust codes
  const fustTypes = await prisma.fustType.findMany();
  const fustTypeByCode = new Map(fustTypes.map((ft) => [ft.code.toLowerCase(), ft]));
  const itemsToCreate = parsed.items.map((item) => {
    const fustType = fustTypeByCode.get(item.fustCode.toLowerCase());
    return {
      fustCode: item.fustCode,
      description: item.description,
      quantity: item.quantity,
      fustTypeId: fustType?.id ?? null,
    };
  });

  // Create voucher
  const voucher = await prisma.fustIssuanceVoucher.create({
    data: {
      transactionNumber: parsed.transactionNumber!,
      type: parsed.type,
      transactionDate: transactionDate || new Date(),
      creationDate,
      location: parsed.location,
      customerNumber: parsed.customerNumber,
      customerName: parsed.customerName,
      transporterName: parsed.transporterName,
      cardNumber: parsed.cardNumber,
      pdfUrl: blob.url,
      items: { create: itemsToCreate },
    },
    include: {
      items: { include: { fustType: { select: { id: true, code: true, name: true } } } },
      orderLinks: true,
    },
  });

  // Update ingestion
  await prisma.fustEmailIngestion.update({
    where: { id: ingestionId },
    data: { status: "PROCESSED", voucherId: voucher.id, pdfUrl: blob.url },
  });

  // Audit log
  await logFustEvent({
    entityType: "voucher",
    entityId: voucher.id,
    action: "voucher_uploaded",
    metadata: {
      transactionNumber: parsed.transactionNumber,
      type: parsed.type,
      itemCount: itemsToCreate.length,
      source: "email_reprocess",
      reportId,
      ingestionId,
    },
  });

  return voucher;
}
