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
 * Returns the supplierId to use for queries based on user role.
 * Suppliers always see their own data. Admin/commercie can specify a supplierId.
 */
export function resolveSupplierId(
  session: { user: { role: string; supplierId: string | null } },
  requestedSupplierId: string | null
): string | null {
  if (session.user.role === "supplier") {
    return session.user.supplierId;
  }
  return requestedSupplierId;
}
