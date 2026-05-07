export interface EmailBrandingOptions {
  companyName: string;
  portalName: string;
  footerText: string;
}

const DEFAULT_BRANDING: EmailBrandingOptions = {
  companyName: "Coloriginz",
  portalName: "Coloriginz Grower Portal",
  footerText: "Coloriginz \u2014 OZ Import BV, Aalsmeer",
};

interface ActivationEmailOptions {
  name: string;
  activationUrl: string;
  branding?: EmailBrandingOptions;
}

export function activationEmailHtml({
  name,
  activationUrl,
  branding = DEFAULT_BRANDING,
}: ActivationEmailOptions): string {
  const { companyName, portalName, footerText } = branding;
  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!--[if mso]>
  <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
  </xml>
  <![endif]-->
  <title>Set Your Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f1eb; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f1eb;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">

          <!-- Logo Header -->
          <tr>
            <td align="center" style="padding: 36px 40px 24px 40px; background-color: #ffffff;">
              <img src="cid:logo" alt="${escapeHtml(companyName)}" width="200" style="display: block; width: 200px; height: auto; border: 0;" />
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;">
              <hr style="border: none; border-top: 1px solid #e8e0d4; margin: 0;" />
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 40px 16px 40px;">
              <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 600; color: #1a1a1a; line-height: 1.3;">
                Welcome to the Grower Portal
              </h1>
              <p style="margin: 0 0 12px 0; font-size: 15px; line-height: 1.6; color: #444444;">
                Dear ${escapeHtml(name)},
              </p>
              <p style="margin: 0 0 12px 0; font-size: 15px; line-height: 1.6; color: #444444;">
                You've been invited to the <strong>${escapeHtml(portalName)}</strong>. This portal gives you access to your sales data, lot tracking, documents, and more.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 15px; line-height: 1.6; color: #444444;">
                To get started, please set your password by clicking the button below:
              </p>
            </td>
          </tr>

          <!-- Button -->
          <tr>
            <td align="center" style="padding: 0 40px 32px 40px;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${activationUrl}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="17%" strokecolor="#c2704e" fillcolor="#c2704e">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;font-size:16px;font-weight:600;">
                  Set Your Password
                </center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <a href="${activationUrl}" target="_blank" style="display: inline-block; background-color: #c2704e; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; padding: 14px 36px; border-radius: 8px; line-height: 1; mso-hide: all;">
                Set Your Password
              </a>
              <!--<![endif]-->
            </td>
          </tr>

          <!-- Fallback Link -->
          <tr>
            <td style="padding: 0 40px 32px 40px;">
              <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #888888;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin: 6px 0 0 0; font-size: 13px; line-height: 1.5; color: #c2704e; word-break: break-all;">
                <a href="${activationUrl}" style="color: #c2704e; text-decoration: underline;">${activationUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;">
              <hr style="border: none; border-top: 1px solid #e8e0d4; margin: 0;" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 24px 40px 32px 40px;">
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #aaaaaa;">
                ${escapeHtml(footerText)}
              </p>
              <p style="margin: 4px 0 0 0; font-size: 12px; line-height: 1.5; color: #aaaaaa;">
                This is an automated message. Please do not reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

interface ResetPasswordEmailOptions {
  name: string;
  resetUrl: string;
  branding?: EmailBrandingOptions;
}

export function resetPasswordEmailHtml({
  name,
  resetUrl,
  branding = DEFAULT_BRANDING,
}: ResetPasswordEmailOptions): string {
  const { companyName, footerText } = branding;
  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!--[if mso]>
  <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
  </xml>
  <![endif]-->
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f1eb; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f1eb;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">

          <!-- Logo Header -->
          <tr>
            <td align="center" style="padding: 36px 40px 24px 40px; background-color: #ffffff;">
              <img src="cid:logo" alt="${escapeHtml(companyName)}" width="200" style="display: block; width: 200px; height: auto; border: 0;" />
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;">
              <hr style="border: none; border-top: 1px solid #e8e0d4; margin: 0;" />
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 40px 16px 40px;">
              <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 600; color: #1a1a1a; line-height: 1.3;">
                Reset Your Password
              </h1>
              <p style="margin: 0 0 12px 0; font-size: 15px; line-height: 1.6; color: #444444;">
                Hi ${escapeHtml(name)},
              </p>
              <p style="margin: 0 0 12px 0; font-size: 15px; line-height: 1.6; color: #444444;">
                You requested a password reset. Click the button below to set a new password. This link expires in 1 hour.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 15px; line-height: 1.6; color: #444444;">
                If you did not request this, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Button -->
          <tr>
            <td align="center" style="padding: 0 40px 32px 40px;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${resetUrl}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="17%" strokecolor="#c2704e" fillcolor="#c2704e">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;font-size:16px;font-weight:600;">
                  Reset Password
                </center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <a href="${resetUrl}" target="_blank" style="display: inline-block; background-color: #c2704e; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; padding: 14px 36px; border-radius: 8px; line-height: 1; mso-hide: all;">
                Reset Password
              </a>
              <!--<![endif]-->
            </td>
          </tr>

          <!-- Fallback Link -->
          <tr>
            <td style="padding: 0 40px 32px 40px;">
              <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #888888;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin: 6px 0 0 0; font-size: 13px; line-height: 1.5; color: #c2704e; word-break: break-all;">
                <a href="${resetUrl}" style="color: #c2704e; text-decoration: underline;">${resetUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;">
              <hr style="border: none; border-top: 1px solid #e8e0d4; margin: 0;" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 24px 40px 32px 40px;">
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #aaaaaa;">
                ${escapeHtml(footerText)}
              </p>
              <p style="margin: 4px 0 0 0; font-size: 12px; line-height: 1.5; color: #aaaaaa;">
                This is an automated message. Please do not reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Fust Order Approved Email ──────────────────────────

interface FustOrderApprovedEmailOptions {
  orderNumber: string;
  supplierName: string;
  supplierCode: string;
  items: Array<{ fustTypeName: string; quantity: number }>;
  requestedDate: string | null;
  notes: string | null;
  portalUrl: string;
  language?: "en" | "nl";
  branding?: EmailBrandingOptions;
}

export function fustOrderApprovedEmailHtml({
  orderNumber,
  supplierName,
  supplierCode,
  items,
  requestedDate,
  notes,
  portalUrl,
  language = "en",
  branding = DEFAULT_BRANDING,
}: FustOrderApprovedEmailOptions): string {
  const { companyName, footerText } = branding;

  const t = {
    en: {
      title: "Fust Order Approved",
      intro: "A fust order has been approved and is ready for pickup.",
      order: "Order",
      supplier: "Supplier",
      requestedDate: "Requested delivery date",
      notes: "Notes",
      item: "Item",
      quantity: "Quantity",
      viewPickups: "View Pickups",
      fallback: "If the button doesn't work, copy and paste this link into your browser:",
      automated: "This is an automated message. Please do not reply to this email.",
    },
    nl: {
      title: "Fust Bestelling Goedgekeurd",
      intro: "Een fust bestelling is goedgekeurd en klaar voor ophalen.",
      order: "Bestelling",
      supplier: "Leverancier",
      requestedDate: "Gewenste leverdatum",
      notes: "Opmerkingen",
      item: "Artikel",
      quantity: "Aantal",
      viewPickups: "Bekijk Ophaalrondes",
      fallback: "Als de knop niet werkt, kopieer en plak deze link in uw browser:",
      automated: "Dit is een automatisch bericht. Gelieve niet te antwoorden op deze email.",
    },
  }[language];

  const itemRows = items
    .map(
      (item) => `
          <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e8e0d4; font-size: 14px; color: #444444;">${escapeHtml(item.fustTypeName)}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e8e0d4; font-size: 14px; color: #444444; text-align: right;">${item.quantity}</td>
          </tr>`
    )
    .join("");

  const dateRow = requestedDate
    ? `<p style="margin: 0 0 8px 0; font-size: 15px; line-height: 1.6; color: #444444;"><strong>${t.requestedDate}:</strong> ${escapeHtml(requestedDate)}</p>`
    : "";

  const notesRow = notes
    ? `<p style="margin: 0 0 8px 0; font-size: 15px; line-height: 1.6; color: #444444;"><strong>${t.notes}:</strong> ${escapeHtml(notes)}</p>`
    : "";

  const pickupsUrl = `${portalUrl}/fust-portal/pickups`;

  return `<!DOCTYPE html>
<html lang="${language}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!--[if mso]>
  <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
  </xml>
  <![endif]-->
  <title>${t.title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f1eb; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f1eb;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">

          <!-- Logo Header -->
          <tr>
            <td align="center" style="padding: 36px 40px 24px 40px; background-color: #ffffff;">
              <img src="cid:logo" alt="${escapeHtml(companyName)}" width="200" style="display: block; width: 200px; height: auto; border: 0;" />
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;">
              <hr style="border: none; border-top: 1px solid #e8e0d4; margin: 0;" />
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 40px 16px 40px;">
              <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 600; color: #1a1a1a; line-height: 1.3;">
                ${t.title}
              </h1>
              <p style="margin: 0 0 12px 0; font-size: 15px; line-height: 1.6; color: #444444;">
                ${t.intro}
              </p>
              <p style="margin: 0 0 8px 0; font-size: 15px; line-height: 1.6; color: #444444;">
                <strong>${t.order}:</strong> ${escapeHtml(orderNumber)}
              </p>
              <p style="margin: 0 0 8px 0; font-size: 15px; line-height: 1.6; color: #444444;">
                <strong>${t.supplier}:</strong> ${escapeHtml(supplierName)} (${escapeHtml(supplierCode)})
              </p>
              ${dateRow}
              ${notesRow}
            </td>
          </tr>

          <!-- Items Table -->
          <tr>
            <td style="padding: 0 40px 24px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border: 1px solid #e8e0d4; border-radius: 8px; overflow: hidden;">
                <tr style="background-color: #f9f6f2;">
                  <th style="padding: 10px 12px; text-align: left; font-size: 13px; font-weight: 600; color: #666666; border-bottom: 1px solid #e8e0d4;">${t.item}</th>
                  <th style="padding: 10px 12px; text-align: right; font-size: 13px; font-weight: 600; color: #666666; border-bottom: 1px solid #e8e0d4;">${t.quantity}</th>
                </tr>
                ${itemRows}
              </table>
            </td>
          </tr>

          <!-- Button -->
          <tr>
            <td align="center" style="padding: 0 40px 32px 40px;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${pickupsUrl}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="17%" strokecolor="#c2704e" fillcolor="#c2704e">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;font-size:16px;font-weight:600;">
                  ${t.viewPickups}
                </center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <a href="${pickupsUrl}" target="_blank" style="display: inline-block; background-color: #c2704e; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; padding: 14px 36px; border-radius: 8px; line-height: 1; mso-hide: all;">
                ${t.viewPickups}
              </a>
              <!--<![endif]-->
            </td>
          </tr>

          <!-- Fallback Link -->
          <tr>
            <td style="padding: 0 40px 32px 40px;">
              <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #888888;">
                ${t.fallback}
              </p>
              <p style="margin: 6px 0 0 0; font-size: 13px; line-height: 1.5; color: #c2704e; word-break: break-all;">
                <a href="${pickupsUrl}" style="color: #c2704e; text-decoration: underline;">${pickupsUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;">
              <hr style="border: none; border-top: 1px solid #e8e0d4; margin: 0;" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 24px 40px 32px 40px;">
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #aaaaaa;">
                ${escapeHtml(footerText)}
              </p>
              <p style="margin: 4px 0 0 0; font-size: 12px; line-height: 1.5; color: #aaaaaa;">
                ${t.automated}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Fust Delivery Confirmed Email (to grower) ──────────

interface FustDeliveryConfirmedEmailOptions {
  orderNumber: string;
  supplierName: string;
  items: Array<{ fustTypeName: string; ordered: number; delivered: number }>;
  deliveredDate: string;
  portalUrl: string;
  language?: "en" | "nl";
  branding?: EmailBrandingOptions;
}

export function fustDeliveryConfirmedEmailHtml({
  orderNumber,
  supplierName,
  items,
  deliveredDate,
  portalUrl,
  language = "en",
  branding = DEFAULT_BRANDING,
}: FustDeliveryConfirmedEmailOptions): string {
  const { companyName, footerText } = branding;

  const t = {
    en: {
      title: "Fust Delivery Confirmed",
      dear: "Dear",
      delivered: (on: string, dn: string) =>
        `Your fust order <strong>${escapeHtml(on)}</strong> has been delivered. The transporter confirmed delivery on <strong>${escapeHtml(dn)}</strong>.`,
      quantities: "Below are the delivered quantities:",
      item: "Item",
      ordered: "Ordered",
      deliveredCol: "Delivered",
      viewOrders: "View My Orders",
      fallback: "If the button doesn't work, copy and paste this link into your browser:",
      automated: "This is an automated message. Please do not reply to this email.",
    },
    nl: {
      title: "Fust Levering Bevestigd",
      dear: "Beste",
      delivered: (on: string, dn: string) =>
        `Uw fust bestelling <strong>${escapeHtml(on)}</strong> is afgeleverd. De transporteur heeft de levering bevestigd op <strong>${escapeHtml(dn)}</strong>.`,
      quantities: "Hieronder vindt u de geleverde aantallen:",
      item: "Artikel",
      ordered: "Besteld",
      deliveredCol: "Geleverd",
      viewOrders: "Bekijk Mijn Bestellingen",
      fallback: "Als de knop niet werkt, kopieer en plak deze link in uw browser:",
      automated: "Dit is een automatisch bericht. Gelieve niet te antwoorden op deze email.",
    },
  }[language];

  const itemRows = items
    .map(
      (item) => `
          <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e8e0d4; font-size: 14px; color: #444444;">${escapeHtml(item.fustTypeName)}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e8e0d4; font-size: 14px; color: #444444; text-align: right;">${item.ordered}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e8e0d4; font-size: 14px; color: #444444; text-align: right; font-weight: 600;">${item.delivered}</td>
          </tr>`
    )
    .join("");

  const ordersUrl = `${portalUrl}/fust`;

  return `<!DOCTYPE html>
<html lang="${language}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!--[if mso]>
  <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
  </xml>
  <![endif]-->
  <title>${t.title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f1eb; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f1eb;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">

          <!-- Logo Header -->
          <tr>
            <td align="center" style="padding: 36px 40px 24px 40px; background-color: #ffffff;">
              <img src="cid:logo" alt="${escapeHtml(companyName)}" width="200" style="display: block; width: 200px; height: auto; border: 0;" />
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;">
              <hr style="border: none; border-top: 1px solid #e8e0d4; margin: 0;" />
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 40px 16px 40px;">
              <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 600; color: #1a1a1a; line-height: 1.3;">
                ${t.title}
              </h1>
              <p style="margin: 0 0 12px 0; font-size: 15px; line-height: 1.6; color: #444444;">
                ${t.dear} ${escapeHtml(supplierName)},
              </p>
              <p style="margin: 0 0 12px 0; font-size: 15px; line-height: 1.6; color: #444444;">
                ${t.delivered(orderNumber, deliveredDate)}
              </p>
              <p style="margin: 0 0 8px 0; font-size: 15px; line-height: 1.6; color: #444444;">
                ${t.quantities}
              </p>
            </td>
          </tr>

          <!-- Items Table -->
          <tr>
            <td style="padding: 0 40px 24px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border: 1px solid #e8e0d4; border-radius: 8px; overflow: hidden;">
                <tr style="background-color: #f9f6f2;">
                  <th style="padding: 10px 12px; text-align: left; font-size: 13px; font-weight: 600; color: #666666; border-bottom: 1px solid #e8e0d4;">${t.item}</th>
                  <th style="padding: 10px 12px; text-align: right; font-size: 13px; font-weight: 600; color: #666666; border-bottom: 1px solid #e8e0d4;">${t.ordered}</th>
                  <th style="padding: 10px 12px; text-align: right; font-size: 13px; font-weight: 600; color: #666666; border-bottom: 1px solid #e8e0d4;">${t.deliveredCol}</th>
                </tr>
                ${itemRows}
              </table>
            </td>
          </tr>

          <!-- Button -->
          <tr>
            <td align="center" style="padding: 0 40px 32px 40px;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${ordersUrl}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="17%" strokecolor="#c2704e" fillcolor="#c2704e">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;font-size:16px;font-weight:600;">
                  ${t.viewOrders}
                </center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <a href="${ordersUrl}" target="_blank" style="display: inline-block; background-color: #c2704e; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; padding: 14px 36px; border-radius: 8px; line-height: 1; mso-hide: all;">
                ${t.viewOrders}
              </a>
              <!--<![endif]-->
            </td>
          </tr>

          <!-- Fallback Link -->
          <tr>
            <td style="padding: 0 40px 32px 40px;">
              <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #888888;">
                ${t.fallback}
              </p>
              <p style="margin: 6px 0 0 0; font-size: 13px; line-height: 1.5; color: #c2704e; word-break: break-all;">
                <a href="${ordersUrl}" style="color: #c2704e; text-decoration: underline;">${ordersUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;">
              <hr style="border: none; border-top: 1px solid #e8e0d4; margin: 0;" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 24px 40px 32px 40px;">
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #aaaaaa;">
                ${escapeHtml(footerText)}
              </p>
              <p style="margin: 4px 0 0 0; font-size: 12px; line-height: 1.5; color: #aaaaaa;">
                ${t.automated}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Fust Invoice Email (to grower) ──────────────────────

interface FustInvoiceEmailOptions {
  invoiceNumber: string;
  supplierName: string;
  invoiceDate: string; // formatted as "dd-mm-yyyy"
  totalAmount: string; // formatted like "€ 199,65"
  portalUrl: string;
  language?: "en" | "nl";
  branding?: EmailBrandingOptions;
}

export function fustInvoiceEmailHtml({
  invoiceNumber,
  supplierName,
  invoiceDate,
  totalAmount,
  portalUrl,
  language = "en",
  branding = DEFAULT_BRANDING,
}: FustInvoiceEmailOptions): string {
  const { companyName, footerText } = branding;
  const invoicesUrl = `${portalUrl}/fust/invoices`;

  const t = {
    en: {
      title: "Fust Invoice",
      intro: (name: string, inv: string) =>
        `Dear ${escapeHtml(name)}, please find attached invoice ${escapeHtml(inv)}.`,
      invoiceNumber: "Invoice number",
      invoiceDate: "Invoice date",
      totalAmount: "Total amount",
      viewInvoices: "View Invoices",
      fallback: "If the button doesn't work, copy and paste this link into your browser:",
      conditions: "Conditions as per VGB terms and conditions.",
      automated: "This is an automated message. Please do not reply to this email.",
    },
    nl: {
      title: "Fust Factuur",
      intro: (name: string, inv: string) =>
        `Beste ${escapeHtml(name)}, hierbij ontvangt u factuur ${escapeHtml(inv)}.`,
      invoiceNumber: "Factuurnummer",
      invoiceDate: "Factuurdatum",
      totalAmount: "Totaalbedrag",
      viewInvoices: "Bekijk Facturen",
      fallback: "Als de knop niet werkt, kopieer en plak deze link in uw browser:",
      conditions: "Voorwaarden conform VGB-voorwaarden.",
      automated: "Dit is een automatisch bericht. Gelieve niet te antwoorden op deze email.",
    },
  }[language];

  return `<!DOCTYPE html>
<html lang="${language}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!--[if mso]>
  <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
  </xml>
  <![endif]-->
  <title>${t.title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f1eb; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f1eb;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">

          <!-- Logo Header -->
          <tr>
            <td align="center" style="padding: 36px 40px 24px 40px; background-color: #ffffff;">
              <img src="cid:logo" alt="${escapeHtml(companyName)}" width="200" style="display: block; width: 200px; height: auto; border: 0;" />
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;">
              <hr style="border: none; border-top: 1px solid #e8e0d4; margin: 0;" />
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 40px 16px 40px;">
              <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 600; color: #1a1a1a; line-height: 1.3;">
                ${t.title}
              </h1>
              <p style="margin: 0 0 12px 0; font-size: 15px; line-height: 1.6; color: #444444;">
                ${t.intro(supplierName, invoiceNumber)}
              </p>
              <p style="margin: 0 0 8px 0; font-size: 15px; line-height: 1.6; color: #444444;">
                <strong>${t.invoiceNumber}:</strong> ${escapeHtml(invoiceNumber)}
              </p>
              <p style="margin: 0 0 8px 0; font-size: 15px; line-height: 1.6; color: #444444;">
                <strong>${t.invoiceDate}:</strong> ${escapeHtml(invoiceDate)}
              </p>
              <p style="margin: 0 0 28px 0; font-size: 15px; line-height: 1.6; color: #444444;">
                <strong>${t.totalAmount}:</strong> ${escapeHtml(totalAmount)}
              </p>
            </td>
          </tr>

          <!-- Button -->
          <tr>
            <td align="center" style="padding: 0 40px 32px 40px;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${invoicesUrl}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="17%" strokecolor="#c2704e" fillcolor="#c2704e">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;font-size:16px;font-weight:600;">
                  ${t.viewInvoices}
                </center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <a href="${invoicesUrl}" target="_blank" style="display: inline-block; background-color: #c2704e; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; padding: 14px 36px; border-radius: 8px; line-height: 1; mso-hide: all;">
                ${t.viewInvoices}
              </a>
              <!--<![endif]-->
            </td>
          </tr>

          <!-- Fallback Link -->
          <tr>
            <td style="padding: 0 40px 32px 40px;">
              <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #888888;">
                ${t.fallback}
              </p>
              <p style="margin: 6px 0 0 0; font-size: 13px; line-height: 1.5; color: #c2704e; word-break: break-all;">
                <a href="${invoicesUrl}" style="color: #c2704e; text-decoration: underline;">${invoicesUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;">
              <hr style="border: none; border-top: 1px solid #e8e0d4; margin: 0;" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 24px 40px 32px 40px;">
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #aaaaaa;">
                ${escapeHtml(footerText)}
              </p>
              <p style="margin: 4px 0 0 0; font-size: 12px; line-height: 1.5; color: #aaaaaa;">
                ${t.conditions}
              </p>
              <p style="margin: 4px 0 0 0; font-size: 12px; line-height: 1.5; color: #aaaaaa;">
                ${t.automated}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
