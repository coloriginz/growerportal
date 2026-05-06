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
 * Get email branding for a supplier based on their company.
 * Falls back to default (Coloriginz) if supplier has no company.
 */
export async function getSupplierEmailBranding(supplierId: string): Promise<EmailBranding> {
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: {
      companyEntity: {
        select: { slug: true, emailFrom: true, emailName: true },
      },
    },
  });

  const slug = supplier?.companyEntity?.slug || DEFAULT_SLUG;
  const branding = getCompanyBranding(slug);

  return {
    companyName: branding.name,
    portalName: branding.portalName,
    footerText: branding.footerText,
    logoBase64: getCompanyLogoBase64(slug),
    emailFrom: supplier?.companyEntity?.emailFrom || undefined,
    emailName: supplier?.companyEntity?.emailName || undefined,
  };
}

/**
 * Get default email branding (Coloriginz).
 * Used for internal users who have no supplier/company link.
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
