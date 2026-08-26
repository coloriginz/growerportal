import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { resetDispatchedJob } from "@/lib/sync/runner";

// Deze route verstuurt de job meteen opnieuw, dus hij erft dezelfde grens als
// de cron-ingang: ruim boven de 20 seconden timeout van dispatch.ts.
export const maxDuration = 60;

/**
 * Zet een job die op `dispatched` blijft hangen terug in de wachtrij.
 *
 * Onbekende job en "die staat helemaal niet uit" zijn verschillende antwoorden:
 * het eerste is een verouderd scherm, het tweede een job die intussen door de
 * reaper of door zijn eigen terugpost is afgehandeld. Dat verschil hoort in de
 * melding te staan, anders ga je in de wachtrij zoeken naar een schermprobleem.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const { id } = await params;
  const result = await resetDispatchedJob(id);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.reason === "not_found" ? 404 : 409 }
    );
  }

  return NextResponse.json(result);
}
