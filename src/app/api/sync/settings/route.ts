import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-helpers";
import { parseIsoDay, readBackfillStart, toIsoDay, writeBackfillStart } from "@/lib/sync/settings";
import { quarterChunks } from "@/lib/sync/backfill";

/**
 * De basisdatum voor backfills, naast de schedules omdat hij op het scherm ook
 * daar hoort. Bewust niet in `/api/admin/settings`: die route geeft 403 zodra
 * `isTest` onwaar is en controleert geen rol. Deze instelling moet juist op
 * productie werken en admin-only zijn — niet samenvoegen dus.
 */

export async function GET() {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const start = await readBackfillStart();
  return NextResponse.json({
    backfillStartDate: start ? toIsoDay(start) : null,
    // Het scherm waarschuwt met dit getal; laat de server rekenen zodat de
    // definitie van "een kwartaal" op één plek staat.
    quarters: start ? quarterChunks(start, new Date()).length : 0,
  });
}

const bodySchema = z.object({
  backfillStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
});

export async function PUT(request: NextRequest) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // De regex laat 2024-02-30 en 2024-13-45 door; pas het parsen scheidt een
  // bestaande dag van een die er alleen uitziet als één.
  const date = parseIsoDay(parsed.data.backfillStartDate);
  if (!date) {
    return NextResponse.json({ error: "Not a valid date" }, { status: 400 });
  }

  // De datum wordt als UTC-middernacht bewaard, maar het scherm stuurt de
  // kalenderdag van de gebruiker. Tussen 22:00 UTC en middernacht is die dag
  // hier al morgen, en een vergelijking met `Date.now()` zou "vandaag" dan als
  // toekomst weigeren. De grens ligt daarom een dag verderop: ruim genoeg voor
  // elke tijdzone, streng genoeg voor de typefout waar dit tegen beschermt.
  const grens = toIsoDay(new Date(Date.now() + 24 * 60 * 60 * 1000));
  if (toIsoDay(date) > grens) {
    return NextResponse.json(
      { error: "A start date in the future would backfill nothing" },
      { status: 400 }
    );
  }

  await writeBackfillStart(date);
  return NextResponse.json({
    // De opgeslagen vorm terug, niet de invoer: dat is wat een volgende GET geeft.
    backfillStartDate: toIsoDay(date),
    quarters: quarterChunks(date, new Date()).length,
  });
}
