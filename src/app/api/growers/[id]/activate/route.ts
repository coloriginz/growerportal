import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { sendEmail } from "@/lib/email";
import { activationEmailHtml } from "@/lib/email-templates";
import { logoBase64 } from "@/lib/logo-base64";

const schema = z.object({
  email: z.string().email(),
});

async function sendActivationEmail(
  email: string,
  name: string,
  activationToken: string
) {
  const activationUrl = `${process.env.APP_URL}/activate?token=${activationToken}`;

  const html = activationEmailHtml({
    name,
    activationUrl,
  });

  await sendEmail({
    to: email,
    subject: "Activate your Coloriginz Grower Portal account",
    html,
    attachments: [
      {
        filename: "logo.png",
        content: Buffer.from(logoBase64, "base64"),
        cid: "logo",
      },
    ],
  });
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

  const { email } = parsed.data;

  // Check grower exists
  const grower = await prisma.grower.findUnique({
    where: { id },
    include: { user: true },
  });

  if (!grower) {
    return NextResponse.json({ error: "Grower not found" }, { status: 404 });
  }

  // If grower already has a user, update activation token (resend)
  if (grower.user) {
    const activationToken = uuidv4();
    await prisma.user.update({
      where: { id: grower.user.id },
      data: {
        email,
        activationToken,
        isActive: false,
      },
    });

    // Send activation email
    await sendActivationEmail(email, grower.name, activationToken);

    return NextResponse.json({
      userId: grower.user.id,
      activationToken,
    });
  }

  // Check email uniqueness
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json({ error: "Email already exists" }, { status: 409 });
  }

  // Create new user linked to grower
  const activationToken = uuidv4();
  const user = await prisma.user.create({
    data: {
      email,
      name: grower.name,
      role: "grower",
      growerId: grower.id,
      activationToken,
      isActive: false,
    },
  });

  // Send activation email
  await sendActivationEmail(email, grower.name, activationToken);

  return NextResponse.json({
    userId: user.id,
    activationToken,
  }, { status: 201 });
}
