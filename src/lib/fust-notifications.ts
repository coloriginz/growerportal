import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { fustOrderApprovedEmailHtml } from "@/lib/email-templates";
import { getGrowerEmailBranding } from "@/lib/company-helpers";

export async function sendOrderApprovedNotification(orderId: string): Promise<string | false> {
  const order = await prisma.fustOrder.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { fustType: { select: { name: true } } } },
      grower: {
        select: {
          code: true,
          name: true,
          company: true,
          defaultTransporter: { select: { email: true, name: true } },
        },
      },
    },
  });

  if (!order) {
    console.warn(`[FustNotification] Order ${orderId} not found, skipping email`);
    return false;
  }

  const transporterEmail = order.grower.defaultTransporter?.email;
  if (!transporterEmail) {
    console.warn(
      `[FustNotification] No transporter email for order ${order.orderNumber}, skipping email`
    );
    return false;
  }

  const branding = await getGrowerEmailBranding(order.growerId);
  const portalUrl = process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";

  const html = fustOrderApprovedEmailHtml({
    orderNumber: order.orderNumber,
    growerName: order.grower.company || order.grower.name,
    growerCode: order.grower.code,
    items: order.items.map((item) => ({
      fustTypeName: item.fustType.name,
      quantity: item.quantity,
    })),
    requestedDate: order.requestedDate
      ? new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(order.requestedDate)
      : null,
    notes: order.notes,
    portalUrl,
    branding: {
      companyName: branding.companyName,
      portalName: branding.portalName,
      footerText: branding.footerText,
    },
  });

  const fromAddress = branding.emailFrom && branding.emailName
    ? `"${branding.emailName}" <${branding.emailFrom}>`
    : undefined;

  const result = await sendEmail({
    to: transporterEmail,
    subject: `Fust Order Approved: ${order.orderNumber} - ${order.grower.company || order.grower.name}`,
    html,
    from: fromAddress,
    attachments: [
      {
        filename: "logo.png",
        content: Buffer.from(branding.logoBase64, "base64"),
        cid: "logo",
      },
    ],
  });

  console.log(
    `[FustNotification] Email sent for order ${order.orderNumber} to ${transporterEmail}`,
    result.previewUrl ? `Preview: ${result.previewUrl}` : ""
  );

  return result.previewUrl;
}
