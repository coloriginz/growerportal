import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getActiveSupplierId } from "@/lib/supplier-context";
import { DashboardContent } from "./dashboard-content";
import { DashboardWelcome } from "./dashboard-welcome";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardPage({ searchParams }: Props) {
  const params = await searchParams;
  const supplierId = await getActiveSupplierId(params);
  const session = await auth();

  // Alleen voor een supplier-account: dat is de leverancier namens wie deze
  // gebruiker inlogt. Een medewerker die in de selector een leverancier kiest
  // logt niet namens die partij in, en ziet hem al in de sidebar staan.
  const ownSupplier =
    session?.user.role === "supplier" && session.user.supplierId
      ? await prisma.supplier.findUnique({
          where: { id: session.user.supplierId },
          select: { name: true },
        })
      : null;

  return (
    <>
      {/*
        Buiten de Suspense: de begroeting hangt niet aan de dashboarddata, dus
        hij hoort er meteen te staan en niet mee te knipperen met de cijfers.
      */}
      {session?.user.name && (
        <DashboardWelcome
          userName={session.user.name}
          supplierName={ownSupplier?.name}
        />
      )}
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent supplierId={supplierId} />
      </Suspense>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
