import { NextRequest, NextResponse } from "next/server";
import { tick } from "@/lib/sync/runner";
import { resolveSyncEnv } from "@/lib/env";

export const maxDuration = 60;

/**
 * De cron-ingang. Vercel stuurt CRON_SECRET mee als Bearer-token; dezelfde
 * header werkt voor een handmatige aanroep tijdens het testen.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is niet gezet" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Lokaal niets versturen: Power Automate kan localhost niet bereiken.
  if (!resolveSyncEnv()) {
    return NextResponse.json({ dryRun: true, reason: "development" });
  }

  // tick() geeft { reaped, enqueued, dispatched, failed } terug. Die laatste is
  // er zodat een cron-run zichtbaar maakt dat er zojuist iets hard misging, in
  // plaats van dat "niets verstuurd" en "verzending mislukt" er hetzelfde uitzien.
  const result = await tick();
  return NextResponse.json(result);
}

// Vercel Cron roept met GET aan.
export const GET = POST;
