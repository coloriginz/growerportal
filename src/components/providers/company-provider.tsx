"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  getCompanySlugFromHostname,
  getCompanyBranding,
  type CompanyBranding,
} from "@/lib/company-config";

const CompanyContext = createContext<CompanyBranding | null>(null);

export function CompanyBrandingProvider({ children }: { children: ReactNode }) {
  const branding = useMemo(() => {
    const hostname =
      typeof window !== "undefined" ? window.location.hostname : "";
    const slug = getCompanySlugFromHostname(hostname);
    return getCompanyBranding(slug);
  }, []);

  return (
    <CompanyContext.Provider value={branding}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompanyBranding(): CompanyBranding {
  const ctx = useContext(CompanyContext);
  if (!ctx) {
    // Fallback when used outside provider (shouldn't happen in practice)
    return getCompanyBranding("coloriginz");
  }
  return ctx;
}
