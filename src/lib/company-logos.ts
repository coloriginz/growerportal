/**
 * Map company slug to base64 logo for email CID attachments.
 * Each company's logo is imported from its own file.
 */

import { logoBase64 } from "@/lib/logo-base64";
import { mypeonyLogoBase64 } from "@/lib/mypeony-logo-base64";

const logos: Record<string, string> = {
  coloriginz: logoBase64,
  mypeony: mypeonyLogoBase64,
};

const DEFAULT_SLUG = "coloriginz";

/**
 * Get the base64 logo string for a company slug.
 */
export function getCompanyLogoBase64(slug: string): string {
  return logos[slug] || logos[DEFAULT_SLUG];
}
