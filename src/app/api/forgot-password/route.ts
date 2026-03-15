import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { sendEmail } from "@/lib/email";
import { resetPasswordEmailHtml } from "@/lib/email-templates";
import { logoBase64 } from "@/lib/logo-base64";

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

  // Send reset email
  const resetUrl = `${process.env.APP_URL}/reset-password?token=${resetToken}`;

  const html = resetPasswordEmailHtml({
    name: user.name,
    resetUrl,
  });

  const { previewUrl } = await sendEmail({
    to: email,
    subject: "Reset your Coloriginz Grower Portal password",
    html,
    attachments: [
      {
        filename: "logo.png",
        content: Buffer.from(logoBase64, "base64"),
        cid: "logo",
      },
    ],
  });

  return NextResponse.json({
    success: true,
    ...(previewUrl && { previewUrl }),
  });
}
