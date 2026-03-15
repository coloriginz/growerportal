import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { GrowersContent } from "./growers-content";

export default async function GrowersPage() {
  const session = await auth();

  if (!session?.user || session.user.role === "grower") {
    redirect("/dashboard");
  }

  return <GrowersContent />;
}
