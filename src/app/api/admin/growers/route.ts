import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { hash } from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  code: z.string().min(1),
  company: z.string().optional(),
  country: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const { error } = await requireAuth(["admin", "commercie"]);
  if (error) return error;

  const body = await request.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, email, code, company, country } = parsed.data;

  // Check uniqueness
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json({ error: "Email already exists" }, { status: 409 });
  }

  const existingGrower = await prisma.grower.findUnique({ where: { code } });
  if (existingGrower) {
    return NextResponse.json({ error: "Grower code already exists" }, { status: 409 });
  }

  const activationToken = uuidv4();

  // Create grower and user in a transaction
  const result = await prisma.$transaction(async (tx: typeof prisma) => {
    const grower = await tx.grower.create({
      data: {
        code,
        name,
        company: company || null,
        country: country || null,
      },
    });

    const user = await tx.user.create({
      data: {
        email,
        name,
        role: "grower",
        growerId: grower.id,
        activationToken,
        isActive: false,
      },
    });

    return { grower, user };
  });

  // TODO: Send activation email with token
  // For now, log the activation link
  console.log(
    `Activation link: ${process.env.APP_URL}/activate?token=${activationToken}`
  );

  return NextResponse.json(
    {
      grower: { id: result.grower.id, code: result.grower.code },
      user: { id: result.user.id, email: result.user.email },
      activationLink: `${process.env.APP_URL}/activate?token=${activationToken}`,
    },
    { status: 201 }
  );
}
