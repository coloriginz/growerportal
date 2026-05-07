import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SupplierDetail } from "./supplier-detail";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SupplierDetailPage({ params }: Props) {
  const session = await auth();

  if (!session?.user || session.user.role === "supplier") {
    redirect("/dashboard");
  }

  const { id } = await params;

  return <SupplierDetail supplierId={id} />;
}
