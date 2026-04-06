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

  // Check fustEnabled for grower users
  let fustEnabled = false;
  if (session.user.role === "grower" && session.user.growerId) {
    const grower = await prisma.grower.findUnique({
      where: { id: session.user.growerId },
      select: { fustEnabled: true },
    });
    fustEnabled = grower?.fustEnabled ?? false;
  }

  return (
    <Suspense>
      <AppShell user={{ ...session.user, fustEnabled }}>{children}</AppShell>
    </Suspense>
  );
}
