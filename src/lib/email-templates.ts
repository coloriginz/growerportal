interface ActivationEmailOptions {
  name: string;
  activationUrl: string;
}

export function activationEmailHtml({
  name,
  activationUrl,
}: ActivationEmailOptions): string {
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
              <img src="cid:logo" alt="Coloriginz" width="200" style="display: block; width: 200px; height: auto; border: 0;" />
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
                You've been invited to the <strong>Coloriginz Grower Portal</strong>. This portal gives you access to your sales data, lot tracking, documents, and more.
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
                Coloriginz &mdash; OZ Import BV, Aalsmeer
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
}

export function resetPasswordEmailHtml({
  name,
  resetUrl,
}: ResetPasswordEmailOptions): string {
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
              <img src="cid:logo" alt="Coloriginz" width="200" style="display: block; width: 200px; height: auto; border: 0;" />
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
                Coloriginz &mdash; OZ Import BV, Aalsmeer
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
