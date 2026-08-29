import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ShipmentDetail } from "./shipment-detail";
import { resolveShipmentStatus } from "@/lib/shipment-status";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ShipmentDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return notFound();

  const salesSheet = await prisma.salesSheet.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      pdfDocument: { select: { id: true, fileUrl: true, fileName: true } },
      lots: {
        orderBy: { lotNumber: "asc" },
        include: {
          transactions: {
            orderBy: { date: "asc" },
            select: {
              id: true,
              fabricOrdregId: true,
              date: true,
              salesType: true,
              stems: true,
              pricePerStem: true,
              amount: true,
              bronFeitExtra: true,
              correctionReasonId: true,
            },
          },
          qualityIssues: {
            select: { id: true, code: true, description: true, stems: true, date: true },
          },
          corrections: {
            select: {
              id: true,
              facttypeSub: true,
              correctionReasonId: true,
              correctionVolume: true,
              correctionColli: true,
              correctionReason: {
                select: {
                  code: true,
                  nameNl: true,
                  nameEn: true,
                  typeCode: true,
                },
              },
            },
          },
        },
      },
      costs: {
        orderBy: { description: "asc" },
      },
    },
  });

  if (!salesSheet) return notFound();

  // Access control: suppliers can only see their own shipments
  if (
    session.user.role === "supplier" &&
    session.user.supplierId !== salesSheet.supplierId
  ) {
    return notFound();
  }

  // Fetch correction reason codes for transaction correctionReasonIds (no FK relation)
  const reasonIds = [...new Set(
    salesSheet.lots.flatMap(l =>
      l.transactions.map(tx => tx.correctionReasonId).filter((id): id is number => id != null)
    )
  )];
  const reasons = reasonIds.length > 0
    ? await prisma.correctionReasonCode.findMany({
        where: { id: { in: reasonIds } },
        select: { id: true, code: true, nameNl: true, nameEn: true },
      })
    : [];
  const correctionReasons = Object.fromEntries(reasons.map(r => [r.id, r]));

  const deliveredStems = salesSheet.lots.reduce((sum, l) => sum + l.totalStems, 0);
  const soldStems = salesSheet.lots.reduce(
    (sum, l) => sum + l.transactions.reduce((s, tx) => s + tx.stems, 0),
    0
  );
  const status = resolveShipmentStatus({
    deliveredStems,
    soldStems,
    costCount: salesSheet.costs.length,
  });

  return (
    <ShipmentDetail
      shipment={JSON.parse(JSON.stringify(salesSheet))}
      correctionReasons={correctionReasons}
      status={status}
    />
  );
}
