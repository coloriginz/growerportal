import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { isTest } from "@/lib/env";
import { ROLES } from "@/types";

export async function POST(request: NextRequest) {
  // Only available in test/development
  if (!isTest) {
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }

  const { error, session } = await requireAuth();
  if (error) return error;

  const body = await request.json();
  const { role } = body;

  if (!role || !ROLES.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  // Don't change the DB — role override lives only in the JWT token.
  // On re-login, the token is created fresh from the DB (original role).
  return NextResponse.json({
    role,
    originalRole: session!.user.role,
  });
}
