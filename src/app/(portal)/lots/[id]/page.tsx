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

  /*
   * De redenen erbij zoeken in een tweede vraag, want `LotCorrection` heeft geen
   * relatie naar `CorrectionReasonCode`: die vreemde sleutel is er weggehaald omdat
   * hij een schone heropbouw laat stuklopen op een code die nog niet geladen is.
   * Zonder deze opzoeking toont het scherm het nummer — "22" waar de tabel
   * "Verwerking: te weinig in doos" draagt, wat voor de kweker niets betekent.
   */
  const redenIds = [
    ...new Set(
      [
        ...lot.corrections.map((c) => c.correctionReasonId),
        ...lot.transactions.map((t) => t.correctionReasonId),
      ].filter((x): x is number => x !== null)
    ),
  ];
  const redenen = redenIds.length
    ? await prisma.correctionReasonCode.findMany({
        where: { id: { in: redenIds } },
        select: { id: true, nameNl: true, nameEn: true },
      })
    : [];
  const reasons = Object.fromEntries(
    redenen.map((r) => [r.id, { nl: r.nameNl, en: r.nameEn }])
  );

  // Access control: suppliers can only see their own lots
  if (
    session.user.role === "supplier" &&
    session.user.supplierId !== lot.supplierId
  ) {
    return notFound();
  }

  return (
    <Suspense>
      <LotDetail lot={JSON.parse(JSON.stringify(lot))} reasons={reasons} />
    </Suspense>
  );
}
