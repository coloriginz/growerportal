import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { logFustEvent } from "@/lib/fust-audit";
import { sendEmail } from "@/lib/email";
import { fustInvoiceEmailHtml } from "@/lib/email-templates";
import { getSupplierEmailBranding } from "@/lib/company-helpers";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["finance", "admin"]);
  if (error) return error;

  const { id } = await params;

  // 1. Load invoice with supplier and supplier users
  const invoice = await prisma.fustGrowerInvoice.findUnique({
    where: { id },
    include: {
      supplier: {
        select: {
          id: true,
          code: true,
          name: true,
          company: true,
          preferredLanguage: true,
          users: {
            where: { isActive: true, role: "supplier" },
            select: { email: true, name: true },
          },
        },
      },
    },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // 2. Validate status is draft
  if (invoice.status !== "draft") {
    return NextResponse.json(
      { error: "Invoice has already been sent" },
      { status: 400 }
    );
  }

  // 3. Check supplier has active users with email
  const supplierUsers = invoice.supplier.users;
  if (supplierUsers.length === 0) {
    return NextResponse.json(
      { error: "No active supplier users found to send the invoice to" },
      { status: 400 }
    );
  }

  // 4. Check PDF exists
  if (!invoice.pdfUrl) {
    return NextResponse.json(
      { error: "Invoice PDF has not been generated" },
      { status: 400 }
    );
  }

  // 5. Get branding + language
  const branding = await getSupplierEmailBranding(invoice.supplierId);
  const portalUrl = process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  const supplierName = invoice.supplier.company || invoice.supplier.name;
  const language = (invoice.supplier.preferredLanguage === "nl" ? "nl" : "en") as "en" | "nl";
  const dateLocale = language === "nl" ? "nl-NL" : "en-GB";

  // 6. Format invoice date and total for email
  const formattedDate = new Intl.DateTimeFormat(dateLocale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(invoice.invoiceDate);

  const formattedTotal = new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(Number(invoice.totalInclVat));

  // 7. Build email HTML
  const html = fustInvoiceEmailHtml({
    invoiceNumber: invoice.invoiceNumber,
    supplierName: supplierName,
    invoiceDate: formattedDate,
    totalAmount: formattedTotal,
    portalUrl,
    language,
    branding: {
      companyName: branding.companyName,
      portalName: branding.portalName,
      footerText: branding.footerText,
    },
  });

  // 8. Download PDF from blob URL to attach
  const pdfResponse = await fetch(invoice.pdfUrl);
  const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());

  // 9. Build from address
  const fromAddress = branding.emailFrom && branding.emailName
    ? `"${branding.emailName}" <${branding.emailFrom}>`
    : undefined;

  const toAddresses = supplierUsers.map((u) => u.email);

  // 10. Send email
  const result = await sendEmail({
    to: toAddresses.join(", "),
    subject: language === "nl"
      ? `Fust Factuur ${invoice.invoiceNumber} - ${branding.companyName}`
      : `Fust Invoice ${invoice.invoiceNumber} - ${branding.companyName}`,
    html,
    from: fromAddress,
    attachments: [
      {
        filename: "logo.png",
        content: Buffer.from(branding.logoBase64, "base64"),
        cid: "logo",
      },
      {
        filename: `${invoice.invoiceNumber}.pdf`,
        content: pdfBuffer,
      },
    ],
  });

  // 11. Update invoice: status = sent, sentAt, sentTo
  await prisma.fustGrowerInvoice.update({
    where: { id },
    data: {
      status: "sent",
      sentAt: new Date(),
      sentTo: toAddresses.join(", "),
    },
  });

  // 12. Audit log
  await logFustEvent({
    entityType: "grower_invoice",
    entityId: id,
    action: "grower_invoice_sent",
    actorId: session!.user.id,
    actorName: session!.user.name,
    metadata: {
      invoiceNumber: invoice.invoiceNumber,
      sentTo: toAddresses,
      supplierId: invoice.supplierId,
    },
  });

  console.log(
    `[GrowerInvoice] Invoice ${invoice.invoiceNumber} sent to ${toAddresses.join(", ")}`,
    result.previewUrl ? `Preview: ${result.previewUrl}` : ""
  );

  return NextResponse.json({
    success: true,
    previewUrl: result.previewUrl,
  });
}
