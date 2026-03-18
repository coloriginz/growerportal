import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FustShell } from "@/features/fust/components/fust-shell";

export default async function FustPortalLayout({
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
      <FustShell user={{ ...session.user, fustEnabled }}>{children}</FustShell>
    </Suspense>
  );
}
