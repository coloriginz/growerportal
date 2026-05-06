import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { sendEmail } from "@/lib/email";
import { resetPasswordEmailHtml } from "@/lib/email-templates";
import { getSupplierEmailBranding, getDefaultEmailBranding } from "@/lib/company-helpers";

const schema = z.object({
  email: z.string().email(),
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { email } = parsed.data;

  // Find user by email - only active users can reset their password
  const user = await prisma.user.findUnique({
    where: { email },
  });

  // Always return 200 to not leak user existence
  if (!user || !user.isActive) {
    return NextResponse.json({ success: true });
  }

  // Generate reset token with 1 hour expiry
  const resetToken = uuidv4();
  const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetToken,
      resetTokenExpiry,
    },
  });

  // Get company branding based on user's supplier link (or default for internal users)
  const branding = user.supplierId
    ? await getSupplierEmailBranding(user.supplierId)
    : getDefaultEmailBranding();

  // Send reset email
  const resetUrl = `${process.env.APP_URL}/reset-password?token=${resetToken}`;

  const html = resetPasswordEmailHtml({
    name: user.name,
    resetUrl,
    branding: {
      companyName: branding.companyName,
      portalName: branding.portalName,
      footerText: branding.footerText,
    },
  });

  const fromAddress = branding.emailFrom && branding.emailName
    ? `"${branding.emailName}" <${branding.emailFrom}>`
    : undefined;

  const { previewUrl } = await sendEmail({
    to: email,
    subject: `Reset your ${branding.portalName} password`,
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

  return NextResponse.json({
    success: true,
    ...(previewUrl && { previewUrl }),
  });
}
