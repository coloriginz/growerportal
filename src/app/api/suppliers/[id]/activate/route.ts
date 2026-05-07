import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { sendEmail } from "@/lib/email";
import { activationEmailHtml } from "@/lib/email-templates";
import { getSupplierEmailBranding } from "@/lib/company-helpers";

const schema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  userId: z.string().uuid().optional(),
});

async function sendActivationEmail(
  email: string,
  name: string,
  activationToken: string,
  supplierId: string,
): Promise<string | false> {
  const branding = await getSupplierEmailBranding(supplierId);
  const activationUrl = `${process.env.APP_URL}/activate?token=${activationToken}`;

  const html = activationEmailHtml({
    name,
    activationUrl,
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
    subject: `Activate your ${branding.portalName} account`,
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

  return previewUrl;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth(["admin", "commercie"]);
  if (error) return error;

  const { id } = await params;
  const body = await request.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { email, name, userId } = parsed.data;

  // Check supplier exists
  const supplier = await prisma.supplier.findUnique({
    where: { id },
  });

  if (!supplier) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  // Resend activation for existing user
  if (userId) {
    const existingUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!existingUser || existingUser.supplierId !== id) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const activationToken = uuidv4();
    await prisma.user.update({
      where: { id: userId },
      data: {
        activationToken,
        isActive: false,
      },
    });

    const previewUrl = await sendActivationEmail(email, existingUser.name, activationToken, id);

    return NextResponse.json({
      userId,
      activationToken,
      ...(previewUrl && { previewUrl }),
    });
  }

  // New user: check email uniqueness
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json({ error: "Email already exists" }, { status: 409 });
  }

  // Create new user linked to supplier
  const activationToken = uuidv4();
  const user = await prisma.user.create({
    data: {
      email,
      name,
      role: "supplier",
      supplierId: supplier.id,
      activationToken,
      isActive: false,
    },
  });

  // Send activation email
  const previewUrl = await sendActivationEmail(email, name, activationToken, supplier.id);

  return NextResponse.json({
    userId: user.id,
    activationToken,
    ...(previewUrl && { previewUrl }),
  }, { status: 201 });
}
