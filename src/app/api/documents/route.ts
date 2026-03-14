import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, resolveGrowerId } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const requestedGrowerId = request.nextUrl.searchParams.get("growerId");
  const growerId = resolveGrowerId(session!, requestedGrowerId);

  if (!growerId) {
    return NextResponse.json([]);
  }

  const documents = await prisma.document.findMany({
    where: { growerId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    documents.map((doc: { id: string; type: string; name: string; fileName: string; fileUrl: string; fileSize: number | null; createdAt: Date }) => ({
      id: doc.id,
      type: doc.type,
      name: doc.name,
      fileName: doc.fileName,
      fileUrl: doc.fileUrl,
      fileSize: doc.fileSize,
      createdAt: doc.createdAt.toISOString(),
    }))
  );
}
