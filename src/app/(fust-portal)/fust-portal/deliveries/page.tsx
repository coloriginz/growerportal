import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getActiveGrowerId } from "@/lib/grower-context";
import { FustGrowerDeliveries } from "@/features/fust/components";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function FustPortalDeliveriesPage({ searchParams }: Props) {
  const session = await auth();
  if (!session) redirect("/fust-login");

  const params = await searchParams;
  const growerId = await getActiveGrowerId(params);

  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <FustGrowerDeliveries growerId={growerId} />
    </Suspense>
  );
}
