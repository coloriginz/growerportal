import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { Role } from "@/types";

export async function requireAuth(allowedRoles?: Role[]) {
  const session = await auth();

  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null };
  }

  if (allowedRoles && !allowedRoles.includes(session.user.role as Role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), session: null };
  }

  return { error: null, session };
}

/**
 * Returns the growerId to use for queries based on user role.
 * Growers always see their own data. Admin/commercie can specify a growerId.
 */
export function resolveGrowerId(
  session: { user: { role: string; growerId: string | null } },
  requestedGrowerId: string | null
): string | null {
  if (session.user.role === "grower") {
    return session.user.growerId;
  }
  return requestedGrowerId;
}
