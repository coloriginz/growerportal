import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ShipmentDetail } from "./shipment-detail";

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
              date: true,
              salesType: true,
              stems: true,
              pricePerStem: true,
              amount: true,
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

  return <ShipmentDetail shipment={JSON.parse(JSON.stringify(salesSheet))} />;
}
