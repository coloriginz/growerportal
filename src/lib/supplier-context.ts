import { auth } from "@/lib/auth";

/**
 * Determines which supplier's data to show based on the user's role.
 * - Supplier: always sees own data
 * - Admin/Commercie: sees selected supplier (from query param) or null (overview)
 */
export async function getActiveSupplierId(
  searchParams: Record<string, string | string[] | undefined>
): Promise<string | null> {
  const session = await auth();
  if (!session?.user) return null;

  const role = session.user.role;

  if (role === "supplier") {
    return session.user.supplierId;
  }

  // Admin/commercie: use supplierId from query params
  const supplierId = searchParams.supplierId;
  if (typeof supplierId === "string" && supplierId) {
    return supplierId;
  }

  return null;
}
