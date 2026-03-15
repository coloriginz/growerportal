import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { requireAuth, resolveGrowerId } from "@/lib/api-helpers";
import { DOCUMENT_TYPES } from "@/types";

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

export async function POST(request: NextRequest) {
  const { error, session } = await requireAuth(["admin", "commercie"]);
  if (error) return error;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const growerId = formData.get("growerId") as string | null;
    const type = formData.get("type") as string | null;
    const name = formData.get("name") as string | null;

    if (!file || !growerId || !type || !name) {
      return NextResponse.json(
        { error: "Missing required fields: file, growerId, type, name" },
        { status: 400 }
      );
    }

    if (!DOCUMENT_TYPES.includes(type as (typeof DOCUMENT_TYPES)[number])) {
      return NextResponse.json(
        { error: "Invalid document type" },
        { status: 400 }
      );
    }

    // Verify grower exists
    const grower = await prisma.grower.findUnique({ where: { id: growerId } });
    if (!grower) {
      return NextResponse.json(
        { error: "Grower not found" },
        { status: 404 }
      );
    }

    // Upload to Vercel Blob
    const blob = await put(`documents/${growerId}/${file.name}`, file, {
      access: "public",
      addRandomSuffix: true,
    });

    // Create document record
    const document = await prisma.document.create({
      data: {
        growerId,
        type,
        name,
        fileName: file.name,
        fileUrl: blob.url,
        fileSize: file.size,
        mimeType: file.type || null,
        uploadedBy: session!.user.id,
      },
    });

    return NextResponse.json({
      id: document.id,
      type: document.type,
      name: document.name,
      fileName: document.fileName,
      fileUrl: document.fileUrl,
      fileSize: document.fileSize,
      createdAt: document.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("Document upload error:", err);
    return NextResponse.json(
      { error: "Failed to upload document" },
      { status: 500 }
    );
  }
}
