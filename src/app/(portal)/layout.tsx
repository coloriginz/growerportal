import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/layout/app-shell";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Check feature flags and company branding for supplier users
  let fustEnabled = false;
  let featureSales = true;
  let featureQuality = true;
  let featureForecasts = true;
  let companySlug: string | null = null;
  if (session.user.role === "supplier" && session.user.supplierId) {
    const supplier = await prisma.supplier.findUnique({
      where: { id: session.user.supplierId },
      select: {
        fustEnabled: true,
        featureSales: true,
        featureQuality: true,
        featureForecasts: true,
        companyEntity: { select: { slug: true } },
      },
    });
    fustEnabled = supplier?.fustEnabled ?? false;
    featureSales = supplier?.featureSales ?? true;
    featureQuality = supplier?.featureQuality ?? true;
    featureForecasts = supplier?.featureForecasts ?? true;
    companySlug = supplier?.companyEntity?.slug ?? null;
  }

  return (
    <Suspense>
      <AppShell user={{ ...session.user, fustEnabled, featureSales, featureQuality, featureForecasts, companySlug }}>{children}</AppShell>
    </Suspense>
  );
}
