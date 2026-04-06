import { prisma } from "@/lib/db";
import { getCompanyBranding, DEFAULT_SLUG, type CompanyBranding } from "@/lib/company-config";
import { getCompanyLogoBase64 } from "@/lib/company-logos";

export interface EmailBranding {
  companyName: string;
  portalName: string;
  footerText: string;
  logoBase64: string;
  emailFrom: string | undefined;
  emailName: string | undefined;
}

/**
 * Get email branding for a grower based on their company.
 * Falls back to default (Coloriginz) if grower has no company.
 */
export async function getGrowerEmailBranding(growerId: string): Promise<EmailBranding> {
  const grower = await prisma.grower.findUnique({
    where: { id: growerId },
    select: {
      companyEntity: {
        select: { slug: true, emailFrom: true, emailName: true },
      },
    },
  });

  const slug = grower?.companyEntity?.slug || DEFAULT_SLUG;
  const branding = getCompanyBranding(slug);

  return {
    companyName: branding.name,
    portalName: branding.portalName,
    footerText: branding.footerText,
    logoBase64: getCompanyLogoBase64(slug),
    emailFrom: grower?.companyEntity?.emailFrom || undefined,
    emailName: grower?.companyEntity?.emailName || undefined,
  };
}

/**
 * Get default email branding (Coloriginz).
 * Used for internal users who have no grower/company link.
 */
export function getDefaultEmailBranding(): EmailBranding {
  const branding = getCompanyBranding(DEFAULT_SLUG);
  return {
    companyName: branding.name,
    portalName: branding.portalName,
    footerText: branding.footerText,
    logoBase64: getCompanyLogoBase64(DEFAULT_SLUG),
    emailFrom: undefined,
    emailName: undefined,
  };
}
