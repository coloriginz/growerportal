import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { z } from "zod";

export async function GET() {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const users = await prisma.user.findMany({
    where: {
      role: { in: ["admin", "commercie"] },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    users.map((u: { id: string; name: string; email: string; role: string; isActive: boolean }) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
    }))
  );
}

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["admin", "commercie"]),
});

export async function POST(request: NextRequest) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const body = await request.json();
  const parsed = createUserSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, email, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already exists" }, { status: 409 });
  }

  const { v4: uuidv4 } = await import("uuid");
  const activationToken = uuidv4();

  const user = await prisma.user.create({
    data: {
      name,
      email,
      role,
      activationToken,
      isActive: false,
    },
  });

  return NextResponse.json(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      activationToken,
    },
    { status: 201 }
  );
}
