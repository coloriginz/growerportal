import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCompanyBranding } from "@/lib/company-config";
import { FustShell } from "@/features/fust/components/fust-shell";

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const companySlug = headersList.get("x-company-slug") || "coloriginz";
  const company = getCompanyBranding(companySlug);

  return {
    title: `Fust Portal | ${company.name}`,
  };
}

export default async function FustPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    const h = await headers();
    const isStandalone = h.get("x-fust-domain") === "1";
    redirect(isStandalone ? "/login" : "/fust-login");
  }

  // Check fustEnabled and company branding for grower users
  let fustEnabled = false;
  let companySlug: string | null = null;
  if (session.user.role === "grower" && session.user.growerId) {
    const grower = await prisma.grower.findUnique({
      where: { id: session.user.growerId },
      select: { fustEnabled: true, companyEntity: { select: { slug: true } } },
    });
    fustEnabled = grower?.fustEnabled ?? false;
    companySlug = grower?.companyEntity?.slug ?? null;
  }

  return (
    <Suspense>
      <FustShell user={{ ...session.user, fustEnabled, companySlug }}>{children}</FustShell>
    </Suspense>
  );
}
