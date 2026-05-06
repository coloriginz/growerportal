import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { z } from "zod";

const schema = z.object({
  supplierId: z.string().uuid(),
  message: z.string().min(1).max(2000),
});

export async function POST(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const body = await request.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Access check
  if (
    session!.user.role === "supplier" &&
    session!.user.supplierId !== parsed.data.supplierId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const changeRequest = await prisma.changeRequest.create({
    data: {
      supplierId: parsed.data.supplierId,
      message: parsed.data.message,
    },
  });

  return NextResponse.json(changeRequest, { status: 201 });
}
