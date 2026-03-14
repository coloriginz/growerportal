import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { LotDetail } from "./lot-detail";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function LotDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return notFound();

  const lot = await prisma.lot.findUnique({
    where: { id },
    include: {
      transactions: { orderBy: { date: "asc" } },
      costs: true,
      qualityIssues: true,
      salesSheet: { select: { id: true, invoiceNumber: true, pdfDocumentId: true } },
      grower: { select: { id: true, code: true, name: true } },
    },
  });

  if (!lot) return notFound();

  // Access control: growers can only see their own lots
  if (
    session.user.role === "grower" &&
    session.user.growerId !== lot.growerId
  ) {
    return notFound();
  }

  return <LotDetail lot={JSON.parse(JSON.stringify(lot))} />;
}
