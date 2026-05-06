import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { z } from "zod";
import { ROLES } from "@/types";

export async function GET(request: NextRequest) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const rolesParam = searchParams.get("roles");

  // Filter by roles if provided, otherwise return all non-supplier users
  const roleFilter = rolesParam
    ? rolesParam.split(",")
    : ["admin", "commercie", "transporteur", "finance"];

  const users = await prisma.user.findMany({
    where: {
      role: { in: roleFilter },
    },
    include: {
      transporter: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      transporterId: u.transporterId,
      transporterName: u.transporter?.name ?? null,
    }))
  );
}

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(ROLES as unknown as [string, ...string[]]),
  transporterId: z.string().uuid().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const body = await request.json();
  const parsed = createUserSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, email, role, transporterId } = parsed.data;

  // Transporteur role requires a transporter link
  if (role === "transporteur" && !transporterId) {
    return NextResponse.json({ error: "Transporter is required for transporteur role" }, { status: 400 });
  }

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
      transporterId: role === "transporteur" ? transporterId : null,
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
      isActive: user.isActive,
      activationToken,
    },
    { status: 201 }
  );
}
