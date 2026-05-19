import { Suspense } from "react";
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
      qualityIssues: true,
      corrections: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          facttypeSub: true,
          correctionReasonId: true,
          correctionVolume: true,
          correctionColli: true,
        },
      },
      salesSheet: { select: { id: true, invoiceNumber: true, pdfDocumentId: true } },
      supplier: { select: { id: true, code: true, name: true } },
    },
  });

  if (!lot) return notFound();

  // Access control: suppliers can only see their own lots
  if (
    session.user.role === "supplier" &&
    session.user.supplierId !== lot.supplierId
  ) {
    return notFound();
  }

  return <Suspense><LotDetail lot={JSON.parse(JSON.stringify(lot))} /></Suspense>;
}
