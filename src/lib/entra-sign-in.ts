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
  | "AccountDeactivated"
  | "AccountNotAllowed";

export type EntraSignInDecision =
  /** `activate` is true for an invited account that has never been activated. */
  | { allowed: true; userId: string; activate: boolean }
  | { allowed: false; error: EntraSignInError };

/** The subset of a User row the decision needs. */
export interface EntraAccount {
  id: string;
  role: string;
  isActive: boolean;
  deactivatedAt: Date | null;
  /** Whether a password was ever set. Used as a safety net, see below. */
  hasPassword: boolean;
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
 * SSO never creates accounts. It may activate one that was invited and never
 * used, and it must refuse one an admin switched off.
 *
 * Those two are only distinguishable because of `deactivatedAt`:
 *
 * | isActive | deactivatedAt | meaning                          | outcome  |
 * |----------|---------------|----------------------------------|----------|
 * | false    | null          | invited, never activated         | activate |
 * | false    | set           | switched off by an admin         | refuse   |
 * | true     | null          | active                           | allow    |
 */
export function decideEntraSignIn(input: {
  email: string | null;
  account: EntraAccount | null;
}): EntraSignInDecision {
  if (!input.email) return { allowed: false, error: "NoEmailClaim" };
  if (!input.account) return { allowed: false, error: "AccountNotFound" };

  const account = input.account;

  // Suppliers and transporters are not in the tenant and never will be. An
  // account of that kind matching a tenant identity means something is wrong,
  // so refuse rather than guess.
  if (!(SSO_ROLES as readonly string[]).includes(account.role)) {
    return { allowed: false, error: "AccountNotAllowed" };
  }

  if (account.deactivatedAt) return { allowed: false, error: "AccountDeactivated" };
  if (account.isActive) return { allowed: true, userId: account.id, activate: false };

  // Safety net for rows the backfill never touched. Having set a password means
  // the account was in use, so an inactive one was switched off rather than
  // never started — the same heuristic the backfill uses, applied at runtime.
  // Once every row has a correct `deactivatedAt` this can never trigger, but
  // until then it keeps a forgotten migration from opening the side door.
  if (account.hasPassword) return { allowed: false, error: "AccountDeactivated" };

  return { allowed: true, userId: account.id, activate: true };
}
