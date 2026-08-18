import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { tick } from "@/lib/sync/runner";
import { resolveSyncEnv } from "@/lib/env";

// Dezelfde grens als de cron-ingang. Zonder deze regel geldt de Vercel-default,
// die ruim onder de 20 seconden timeout van dispatch.ts ligt: de functie sneuvelt
// dan ná het claimen van de job en het openen van de batch maar vóór de catch,
// en dan staat er een kwartier lang een job op dispatched zonder spoor.
export const maxDuration = 60;

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
