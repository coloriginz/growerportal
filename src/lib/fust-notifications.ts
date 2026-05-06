import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { fustOrderApprovedEmailHtml, fustDeliveryConfirmedEmailHtml } from "@/lib/email-templates";
import { getSupplierEmailBranding } from "@/lib/company-helpers";

export async function sendOrderApprovedNotification(orderId: string): Promise<string | false> {
  const order = await prisma.fustOrder.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { fustType: { select: { name: true } } } },
      supplier: {
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

  const transporterEmail = order.supplier.defaultTransporter?.email;
  if (!transporterEmail) {
    console.warn(
      `[FustNotification] No transporter email for order ${order.orderNumber}, skipping email`
    );
    return false;
  }

  const branding = await getSupplierEmailBranding(order.supplierId);
  const portalUrl = process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  const language = (order.supplier.defaultTransporter?.preferredLanguage === "nl" ? "nl" : "en") as "en" | "nl";
  const dateLocale = language === "nl" ? "nl-NL" : "en-GB";

  const html = fustOrderApprovedEmailHtml({
    orderNumber: order.orderNumber,
    supplierName: order.supplier.company || order.supplier.name,
    supplierCode: order.supplier.code,
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
    ? `Fust Bestelling Goedgekeurd: ${order.orderNumber} - ${order.supplier.company || order.supplier.name}`
    : `Fust Order Approved: ${order.orderNumber} - ${order.supplier.company || order.supplier.name}`;

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
          supplier: {
            select: {
              id: true,
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
      },
    },
  });

  if (!delivery || !delivery.order) {
    console.warn(`[FustNotification] Delivery ${deliveryId} not found, skipping email`);
    return false;
  }

  const supplierUsers = delivery.order.supplier.users;
  if (supplierUsers.length === 0) {
    console.warn(
      `[FustNotification] No active supplier users for order ${delivery.order.orderNumber}, skipping email`
    );
    return false;
  }

  const branding = await getSupplierEmailBranding(delivery.order.supplier.id);
  const portalUrl = process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  const supplierName = delivery.order.supplier.company || delivery.order.supplier.name;
  const language = (delivery.order.supplier.preferredLanguage === "nl" ? "nl" : "en") as "en" | "nl";
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
    supplierName,
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

  const toAddresses = supplierUsers.map((u) => u.email);

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
 * Send delivery confirmation email to supplier when an order is marked as delivered
 * (via the orders endpoint, without a FustDelivery record).
 */
export async function sendOrderDeliveredNotification(
  orderId: string
): Promise<string | false> {
  const order = await prisma.fustOrder.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { fustType: { select: { name: true } } } },
      supplier: {
        select: {
          id: true,
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

  if (!order) {
    console.warn(`[FustNotification] Order ${orderId} not found, skipping delivery email`);
    return false;
  }

  const supplierUsers = order.supplier.users;
  if (supplierUsers.length === 0) {
    console.warn(
      `[FustNotification] No active supplier users for order ${order.orderNumber}, skipping delivery email`
    );
    return false;
  }

  const branding = await getSupplierEmailBranding(order.supplier.id);
  const portalUrl = process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  const supplierName = order.supplier.company || order.supplier.name;
  const language = (order.supplier.preferredLanguage === "nl" ? "nl" : "en") as "en" | "nl";
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
    supplierName,
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

  const toAddresses = supplierUsers.map((u) => u.email);

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
