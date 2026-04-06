/**
 * Static company branding configuration.
 * Edge Runtime compatible — no database, no async.
 * Used by middleware, client components, and server components.
 */

export interface CompanyBranding {
  slug: string;
  name: string;
  portalName: string;
  logoPath: string; // path relative to public/
  footerText: string;
}

const COMPANIES: Record<string, CompanyBranding> = {
  coloriginz: {
    slug: "coloriginz",
    name: "Coloriginz",
    portalName: "Coloriginz Grower Portal",
    logoPath: "/logos/coloriginz.png",
    footerText: "Coloriginz \u2014 OZ Import BV, Aalsmeer",
  },
  mypeony: {
    slug: "mypeony",
    name: "MyPeony",
    portalName: "MyPeony Grower Portal",
    logoPath: "/logos/mypeony.png",
    footerText: "MyPeony Society",
  },
};

const DEFAULT_SLUG = "coloriginz";

/**
 * Map hostname to company slug.
 * Checks if the hostname contains a known company identifier.
 */
export function getCompanySlugFromHostname(hostname: string): string {
  const h = hostname.toLowerCase();

  if (h.includes("mypeony")) return "mypeony";
  if (h.includes("coloriginz")) return "coloriginz";

  // Default for localhost, test.*, fust.*, and unknown domains
  return DEFAULT_SLUG;
}

/**
 * Get branding config for a company slug.
 * Falls back to default (Coloriginz) for unknown slugs.
 */
export function getCompanyBranding(slug: string): CompanyBranding {
  return COMPANIES[slug] || COMPANIES[DEFAULT_SLUG];
}

/**
 * Get all available companies (for admin dropdowns).
 */
export function getAllCompanies(): CompanyBranding[] {
  return Object.values(COMPANIES);
}

export { DEFAULT_SLUG };
