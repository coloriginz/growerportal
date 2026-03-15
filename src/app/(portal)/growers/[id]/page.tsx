import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { GrowerDetail } from "./grower-detail";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function GrowerDetailPage({ params }: Props) {
  const session = await auth();

  if (!session?.user || session.user.role === "grower") {
    redirect("/dashboard");
  }

  const { id } = await params;

  return <GrowerDetail growerId={id} />;
}
