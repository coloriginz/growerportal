import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { isTest } from "@/lib/env";

// GET /api/admin/settings?keys=test_email_mode,test_email_redirect
export async function GET(request: NextRequest) {
  // Test email settings are accessible to all logged-in users in test env
  const { error } = await requireAuth();
  if (error) return error;

  if (!isTest) {
    return NextResponse.json({ error: "Settings only available in test environment" }, { status: 403 });
  }

  const keys = request.nextUrl.searchParams.get("keys")?.split(",") || [];

  const settings = await prisma.setting.findMany({
    where: { key: { in: keys } },
  });

  const result: Record<string, string> = {};
  for (const s of settings) {
    result[s.key] = s.value;
  }

  return NextResponse.json(result);
}

// PUT /api/admin/settings
export async function PUT(request: NextRequest) {
  // Test email settings are accessible to all logged-in users in test env
  const { error } = await requireAuth();
  if (error) return error;

  if (!isTest) {
    return NextResponse.json({ error: "Settings only available in test environment" }, { status: 403 });
  }

  const body = await request.json() as Record<string, string>;

  for (const [key, value] of Object.entries(body)) {
    await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  return NextResponse.json({ ok: true });
}
