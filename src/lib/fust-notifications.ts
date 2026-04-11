import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { fustOrderApprovedEmailHtml, fustDeliveryConfirmedEmailHtml } from "@/lib/email-templates";
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
          defaultTransporter: { select: { email: true, name: true, preferredLanguage: true } },
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
  const language = (order.grower.defaultTransporter?.preferredLanguage === "nl" ? "nl" : "en") as "en" | "nl";
  const dateLocale = language === "nl" ? "nl-NL" : "en-GB";

  const html = fustOrderApprovedEmailHtml({
    orderNumber: order.orderNumber,
    growerName: order.grower.company || order.grower.name,
    growerCode: order.grower.code,
    items: order.items.map((item) => ({
      fustTypeName: item.fustType.name,
      quantity: item.quantity,
    })),
    requestedDate: order.requestedDate
      ? new Intl.DateTimeFormat(dateLocale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(order.requestedDate)
      : null,
    notes: order.notes,
    portalUrl,
    language,
    branding: {
      companyName: branding.companyName,
      portalName: branding.portalName,
      footerText: branding.footerText,
    },
  });

  const fromAddress = branding.emailFrom && branding.emailName
    ? `"${branding.emailName}" <${branding.emailFrom}>`
    : undefined;

  const subject = language === "nl"
    ? `Fust Bestelling Goedgekeurd: ${order.orderNumber} - ${order.grower.company || order.grower.name}`
    : `Fust Order Approved: ${order.orderNumber} - ${order.grower.company || order.grower.name}`;

  const result = await sendEmail({
    to: transporterEmail,
    subject,
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

export async function sendDeliveryConfirmedNotification(
  deliveryId: string
): Promise<string | false> {
  const delivery = await prisma.fustDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      items: { include: { fustType: { select: { name: true } } } },
      order: {
        include: {
          items: { include: { fustType: { select: { name: true } } } },
          grower: {
            select: {
              id: true,
              name: true,
              company: true,
              preferredLanguage: true,
              users: {
                where: { isActive: true, role: "grower" },
                select: { email: true, name: true },
              },
            },
          },
        },
      },
    },
  });

  if (!delivery || !delivery.order) {
    console.warn(`[FustNotification] Delivery ${deliveryId} not found, skipping email`);
    return false;
  }

  const growerUsers = delivery.order.grower.users;
  if (growerUsers.length === 0) {
    console.warn(
      `[FustNotification] No active grower users for order ${delivery.order.orderNumber}, skipping email`
    );
    return false;
  }

  const branding = await getGrowerEmailBranding(delivery.order.grower.id);
  const portalUrl = process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  const growerName = delivery.order.grower.company || delivery.order.grower.name;
  const language = (delivery.order.grower.preferredLanguage === "nl" ? "nl" : "en") as "en" | "nl";
  const dateLocale = language === "nl" ? "nl-NL" : "en-GB";

  // Build items list: match delivery items to order items by fustTypeId
  const orderItemMap = new Map(
    delivery.order.items.map((oi) => [oi.fustType.name, oi.quantity])
  );
  const items = delivery.items.map((di) => ({
    fustTypeName: di.fustType.name,
    ordered: orderItemMap.get(di.fustType.name) ?? 0,
    delivered: di.quantity,
  }));

  const deliveredDate = new Intl.DateTimeFormat(dateLocale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(delivery.deliveredAt || new Date());

  const html = fustDeliveryConfirmedEmailHtml({
    orderNumber: delivery.order.orderNumber,
    growerName,
    items,
    deliveredDate,
    portalUrl,
    language,
    branding: {
      companyName: branding.companyName,
      portalName: branding.portalName,
      footerText: branding.footerText,
    },
  });

  const fromAddress =
    branding.emailFrom && branding.emailName
      ? `"${branding.emailName}" <${branding.emailFrom}>`
      : undefined;

  const toAddresses = growerUsers.map((u) => u.email);

  const subject = language === "nl"
    ? `Fust Levering Bevestigd: ${delivery.order.orderNumber}`
    : `Fust Delivery Confirmed: ${delivery.order.orderNumber}`;

  const result = await sendEmail({
    to: toAddresses.join(", "),
    subject,
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
    `[FustNotification] Delivery email sent for order ${delivery.order.orderNumber} to ${toAddresses.join(", ")}`,
    result.previewUrl ? `Preview: ${result.previewUrl}` : ""
  );

  return result.previewUrl;
}

/**
 * Send delivery confirmation email to grower when an order is marked as delivered
 * (via the orders endpoint, without a FustDelivery record).
 */
export async function sendOrderDeliveredNotification(
  orderId: string
): Promise<string | false> {
  const order = await prisma.fustOrder.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { fustType: { select: { name: true } } } },
      grower: {
        select: {
          id: true,
          name: true,
          company: true,
          preferredLanguage: true,
          users: {
            where: { isActive: true, role: "grower" },
            select: { email: true, name: true },
          },
        },
      },
    },
  });

  if (!order) {
    console.warn(`[FustNotification] Order ${orderId} not found, skipping delivery email`);
    return false;
  }

  const growerUsers = order.grower.users;
  if (growerUsers.length === 0) {
    console.warn(
      `[FustNotification] No active grower users for order ${order.orderNumber}, skipping delivery email`
    );
    return false;
  }

  const branding = await getGrowerEmailBranding(order.grower.id);
  const portalUrl = process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  const growerName = order.grower.company || order.grower.name;
  const language = (order.grower.preferredLanguage === "nl" ? "nl" : "en") as "en" | "nl";
  const dateLocale = language === "nl" ? "nl-NL" : "en-GB";

  const items = order.items.map((item) => ({
    fustTypeName: item.fustType.name,
    ordered: item.quantity,
    delivered: item.deliveredQuantity ?? item.quantity,
  }));

  const deliveredDate = new Intl.DateTimeFormat(dateLocale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(order.deliveredAt || new Date());

  const html = fustDeliveryConfirmedEmailHtml({
    orderNumber: order.orderNumber,
    growerName,
    items,
    deliveredDate,
    portalUrl,
    language,
    branding: {
      companyName: branding.companyName,
      portalName: branding.portalName,
      footerText: branding.footerText,
    },
  });

  const fromAddress =
    branding.emailFrom && branding.emailName
      ? `"${branding.emailName}" <${branding.emailFrom}>`
      : undefined;

  const toAddresses = growerUsers.map((u) => u.email);

  const subject = language === "nl"
    ? `Fust Levering Bevestigd: ${order.orderNumber}`
    : `Fust Delivery Confirmed: ${order.orderNumber}`;

  const result = await sendEmail({
    to: toAddresses.join(", "),
    subject,
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
    `[FustNotification] Delivery email sent for order ${order.orderNumber} to ${toAddresses.join(", ")}`,
    result.previewUrl ? `Preview: ${result.previewUrl}` : ""
  );

  return result.previewUrl;
}
