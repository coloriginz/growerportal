import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { enqueueRunNow } from "@/lib/sync/runner";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const { name } = await params;
  try {
    const enqueued = await enqueueRunNow(name);
    return NextResponse.json({ enqueued });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
