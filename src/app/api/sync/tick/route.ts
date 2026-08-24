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

  // Niets versturen als er geen doelomgeving is. Lokaal klopt dat — Power
  // Automate kan localhost niet bereiken — maar het gebeurt ook als de variabele
  // ontbreekt of verkeerd gespeld is, en dat is een configuratiefout die er niet
  // uit mag zien als een bewuste keuze. Vandaar de aangetroffen waarde erbij:
  // productie tikte na de eerste deploy netjes elke vijf minuten en deed niets,
  // met "development" als reden, terwijl NEXT_PUBLIC_APP_ENV daar simpelweg niet
  // gezet was. De waarde is publiek, dus hem tonen kost niets.
  if (!resolveSyncEnv()) {
    const gevonden = process.env.NEXT_PUBLIC_APP_ENV;
    return NextResponse.json({
      dryRun: true,
      reason: gevonden
        ? `NEXT_PUBLIC_APP_ENV is "${gevonden}"; alleen "test" en "production" versturen`
        : `NEXT_PUBLIC_APP_ENV is niet gezet; alleen "test" en "production" versturen`,
    });
  }

  // tick() geeft { reaped, orphanBatches, enqueued, dispatched, failed } terug. Die laatste is
  // er zodat een cron-run zichtbaar maakt dat er zojuist iets hard misging, in
  // plaats van dat "niets verstuurd" en "verzending mislukt" er hetzelfde uitzien.
  const result = await tick();
  return NextResponse.json(result);
}

// Vercel Cron roept met GET aan.
export const GET = POST;
