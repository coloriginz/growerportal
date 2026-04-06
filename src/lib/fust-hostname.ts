/**
 * Fust portal hostname detection.
 *
 * When the fust portal is served on its own domain (e.g. fust.apps.coloriginz.com),
 * Next.js middleware rewrites clean URLs (e.g. /orders) to the internal
 * /fust-portal/* routes. This helper lets client components know whether
 * they are running on the standalone fust domain so they can generate
 * clean links (without the /fust-portal prefix).
 */

/** Hostname prefixes that indicate the fust standalone domain */
const FUST_HOST_PREFIXES = ["fust.", "fust-"];

/** Check (server-side) whether we are on the fust domain via a header set by middleware */
export function isFustDomain(headers: Headers): boolean {
  return headers.get("x-fust-domain") === "1";
}

/** Check (client-side) whether we are on the fust domain */
export function isFustDomainClient(): boolean {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname;
  return FUST_HOST_PREFIXES.some((prefix) => hostname.startsWith(prefix));
}

/**
 * Convert an internal /fust-portal/* path to the clean URL used on
 * the standalone fust domain, or return it as-is on the main domain.
 */
export function fustHref(internalPath: string, isStandalone: boolean): string {
  if (!isStandalone) return internalPath;

  // /fust-portal → /
  if (internalPath === "/fust-portal") return "/";

  // /fust-portal/orders → /orders
  if (internalPath.startsWith("/fust-portal/")) {
    return internalPath.replace("/fust-portal", "");
  }

  // /fust-portal?tab=x → /?tab=x
  if (internalPath.startsWith("/fust-portal?")) {
    return internalPath.replace("/fust-portal", "/");
  }

  // /fust-login → /login
  if (internalPath === "/fust-login") return "/login";

  return internalPath;
}
