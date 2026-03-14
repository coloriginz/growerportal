import { Suspense } from "react";
import { getActiveGrowerId } from "@/lib/grower-context";
import { QualityContent } from "./quality-content";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function QualityPage({ searchParams }: Props) {
  const params = await searchParams;
  const growerId = await getActiveGrowerId(params);

  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <QualityContent growerId={growerId} />
    </Suspense>
  );
}
