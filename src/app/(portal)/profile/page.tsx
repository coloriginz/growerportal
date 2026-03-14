import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { getActiveGrowerId } from "@/lib/grower-context";
import { ProfileContent } from "./profile-content";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ProfilePage({ searchParams }: Props) {
  const params = await searchParams;
  const growerId = await getActiveGrowerId(params);

  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ProfileContent growerId={growerId} />
    </Suspense>
  );
}
