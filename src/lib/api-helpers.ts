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

/**
 * Builds a Prisma where-clause filter to scope queries to the user's allowed suppliers.
 * - Admin/finance with company labels: only suppliers belonging to those companies
 * - Commercie with kbtCode: only suppliers where they are account manager
 * - Supplier role: only their own supplier
 * - Admin/finance without labels: no restriction (returns undefined)
 *
 * Usage examples:
 *   On Supplier model:  { ...buildSupplierScope(session) }
 *   On Lot model:       { supplier: buildSupplierScope(session) }
 *   On Transaction:     { lot: { supplier: buildSupplierScope(session) } }
 *   On FustOrder:       { supplier: buildSupplierScope(session) }
 */
export function buildSupplierScope(
  session: { user: { role: string; supplierId: string | null; kbtCode: string | null; companyIds: string[] } }
): Record<string, unknown> | undefined {
  const { role, supplierId, kbtCode, companyIds } = session.user;

  if (role === "supplier") {
    return supplierId ? { id: supplierId } : undefined;
  }
  if ((role === "admin" || role === "finance") && companyIds.length > 0) {
    return { companyId: { in: companyIds } };
  }
  if (role === "commercie" && kbtCode) {
    return { accountManagerCode: kbtCode };
  }
  return undefined;
}
