import { Suspense } from "react";
import { getActiveGrowerId } from "@/lib/grower-context";
import { SalesContent } from "./sales-content";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SalesPage({ searchParams }: Props) {
  const params = await searchParams;
  const growerId = await getActiveGrowerId(params);

  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <SalesContent growerId={growerId} />
    </Suspense>
  );
}
