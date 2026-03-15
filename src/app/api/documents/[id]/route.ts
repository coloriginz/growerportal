import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
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

  // Growers can only access their own documents
  if (
    session!.user.role === "grower" &&
    document.growerId !== session!.user.growerId
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

  try {
    // Delete from Vercel Blob
    await del(document.fileUrl);
  } catch (err) {
    // Log but continue - file may already be deleted
    console.error("Failed to delete blob:", err);
  }

  // Delete from database
  await prisma.document.delete({
    where: { id },
  });

  return NextResponse.json({ success: true });
}
