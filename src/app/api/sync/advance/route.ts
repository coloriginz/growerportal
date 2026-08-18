import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { tick } from "@/lib/sync/runner";
import { resolveSyncEnv } from "@/lib/env";

/**
 * Doet precies wat de cron doet: vastlopers opruimen, kijken of er een ronde due
 * is, en de volgende job versturen. Achter een sessie in plaats van CRON_SECRET,
 * want die sleutel hoort niet in een browser.
 *
 * Nodig omdat de cron alleen op productie-deployments vuurt: op test is develop
 * een preview en staat de wachtrij zonder deze knop stil.
 */
export async function POST() {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  if (!resolveSyncEnv()) {
    return NextResponse.json({
      dryRun: true,
      reason: `NEXT_PUBLIC_APP_ENV is ${process.env.NEXT_PUBLIC_APP_ENV ? `"${process.env.NEXT_PUBLIC_APP_ENV}"` : "not set"}; only "test" and "production" dispatch`,
    });
  }

  return NextResponse.json(await tick());
}
