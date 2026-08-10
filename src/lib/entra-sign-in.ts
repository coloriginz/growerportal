/**
 * Decides whether a Microsoft Entra login may proceed.
 *
 * Kept as a pure function on purpose: the rules are the interesting part and
 * they should be readable and testable without a database or a request. The
 * caller does the lookup and hands the result in.
 *
 * Background: docs/sso-entra.md, and the design system guide
 * https://design-system.apps.coloriginz.com/gidsen/entra-sso
 */

/**
 * Auth.js provider id. Also the last segment of the callback URL that has to be
 * registered in Azure, so it must match on both sides exactly. Lives here
 * rather than in lib/auth.ts because client components need it too and that
 * module pulls in Prisma.
 */
export const ENTRA_PROVIDER_ID = "microsoft-entra-id";

/** Roles that exist in the Coloriginz Entra tenant. */
export const SSO_ROLES = ["admin", "commercie", "finance"] as const;

/**
 * Error codes handed to the login page as `?error=`. English on both sides of
 * the contract; translation happens in the UI. Keep in sync with the allowlist
 * the login page checks against.
 */
export type EntraSignInError =
  | "NoEmailClaim"
  | "AccountNotFound"
  | "AccountNotActivated"
  | "AccountNotAllowed";

export type EntraSignInDecision =
  | { allowed: true; userId: string }
  | { allowed: false; error: EntraSignInError };

/** The subset of a User row the decision needs. */
export interface EntraAccount {
  id: string;
  role: string;
  isActive: boolean;
}

/** Claims we accept as the identity, in order of preference. */
export interface EntraClaims {
  email?: string | null;
  preferred_username?: string | null;
  upn?: string | null;
}

/**
 * Pick the address that identifies the person, normalised to lowercase.
 *
 * Azure only fills `email` when the account's mail attribute is set, and there
 * are accounts where it is not. A login that leans on `email` alone fails for
 * those with an error that points nowhere, hence the fallback to UPN.
 */
export function resolveEntraEmail(claims: EntraClaims): string | null {
  const raw = claims.email || claims.preferred_username || claims.upn;
  const trimmed = raw?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/**
 * SSO never creates accounts and never activates them.
 *
 * Refusing an inactive account is the fail-closed reading of `isActive`, which
 * in this schema means both "invited, never activated" and "switched off by an
 * admin". Auto-activating would let a deactivated colleague back in through the
 * side door, because nothing distinguishes the two states. Splitting them with
 * a `deactivatedAt` column is what the guide describes in §3.3; until that
 * exists, the invitation flow stays the only way in.
 */
export function decideEntraSignIn(input: {
  email: string | null;
  account: EntraAccount | null;
}): EntraSignInDecision {
  if (!input.email) return { allowed: false, error: "NoEmailClaim" };
  if (!input.account) return { allowed: false, error: "AccountNotFound" };

  // Suppliers and transporters are not in the tenant and never will be. An
  // account of that kind matching a tenant identity means something is wrong,
  // so refuse rather than guess.
  if (!(SSO_ROLES as readonly string[]).includes(input.account.role)) {
    return { allowed: false, error: "AccountNotAllowed" };
  }

  if (!input.account.isActive) {
    return { allowed: false, error: "AccountNotActivated" };
  }

  return { allowed: true, userId: input.account.id };
}
