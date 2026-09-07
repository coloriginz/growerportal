import { NextRequest, NextResponse } from "next/server";
import { deleteOwnBlob } from "@/lib/blob-paths";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth();
  if (error) return error;

  const { id } = await params;

  const document = await prisma.document.findUnique({
    where: { id },
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // Suppliers can only access their own documents
  if (
    session!.user.role === "supplier" &&
    document.supplierId !== session!.user.supplierId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.redirect(document.fileUrl);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth(["admin", "commercie"]);
  if (error) return error;

  const { id } = await params;

  const document = await prisma.document.findUnique({
    where: { id },
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  /*
   * Het bestand gaat alleen weg als deze omgeving het zelf heeft geüpload.
   * Test en productie delen één blobopslag: een bestand van vóór die scheiding
   * kan door de andere omgeving in gebruik zijn, en dat is hier niet te zien.
   * De databaserij verdwijnt hoe dan ook — die is wel van ons.
   */
  await deleteOwnBlob(document.fileUrl);

  // Delete from database
  await prisma.document.delete({
    where: { id },
  });

  return NextResponse.json({ success: true });
}
