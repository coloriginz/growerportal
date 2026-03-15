import { auth } from "@/lib/auth";

/**
 * Determines which grower's data to show based on the user's role.
 * - Grower: always sees own data
 * - Admin/Commercie: sees selected grower (from query param) or null (overview)
 */
export async function getActiveGrowerId(
  searchParams: Record<string, string | string[] | undefined>
): Promise<string | null> {
  const session = await auth();
  if (!session?.user) return null;

  const role = session.user.role;

  if (role === "grower") {
    return session.user.growerId;
  }

  // Admin/commercie: use growerId from query params
  const growerId = searchParams.growerId;
  if (typeof growerId === "string" && growerId) {
    return growerId;
  }

  return null;
}
