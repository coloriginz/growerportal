/*
 * Haalt de creditfactuur op bij correcties die al in de portal staan.
 *
 * De orders-import draagt sinds deze wijziging `creditInvoiceNumber` en
 * `creditInvoiceDate` mee (zie `src/lib/sync/queries/orders.ts`), maar alleen
 * voor wat er ná die wijziging binnenkomt. De 2.454 correctierijen die er al
 * stonden blijven leeg tot ze opnieuw zijn opgehaald, en het schuivende venster
 * van de sync komt daar nooit meer langs. Dit is die inhaalronde.
 *
 * Waarom per orderregel en niet per correctie: de importroute verwijdert per
 * `(lotId, fabricOrdregId)`-paar wat de payload noemt en schrijft dat opnieuw.
 * Een payload met alleen de correctierijen zou dus de originele verkoop van
 * datzelfde paar wissen. Elke ronde haalt daarom alle regels op van elke
 * orderregel die in dat venster een correctie draagt — origineel en correcties
 * samen — en laat de rest van het kwartaal met rust.
 *
 * De route loopt langs POST /api/import/orders en niet langs de backfill-
 * wachtrij, om dezelfde reden als `repair-zero-orders.ts`: die wachtrij gaat via
 * Power Automate, dat 202 antwoordt zodra de flow start, en dan bereikt een
 * SQL-fout de portal nooit.
 *
 * Draaien (de dev-server moet aanstaan, die bedient de importroute):
 *   npx tsx scripts/backfill-credit-invoices.ts                    # dry run
 *   npx tsx scripts/backfill-credit-invoices.ts --apply
 *   npx tsx scripts/backfill-credit-invoices.ts --supplier=COLXLNFW --apply
 *   npx tsx scripts/backfill-credit-invoices.ts --limit=3 --apply  # eerst een proefje
 *
 * Herhaalbaar en afbreekbaar: de werklijst wordt elke run opnieuw afgeleid uit
 * de correcties die op dat moment nog geen creditfactuur hebben, en elke
 * kwartaalronde staat op zichzelf.
 */
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";
process.env.NEXT_PUBLIC_APP_ENV = process.env.NEXT_PUBLIC_APP_ENV || "test";
import { prisma } from "../src/lib/db";
import { ordersQuery } from "../src/lib/sync/queries/orders";
import { ask } from "../src/lib/sync/dispatch";

function optie(vlag: string): string | undefined {
  const a = process.argv.slice(2).find((x) => x.startsWith(vlag + "="));
  return a ? a.slice(vlag.length + 1) : undefined;
}
const APPLY = process.argv.includes("--apply");
const SUPPLIER = optie("--supplier")?.toUpperCase();
const LIMIT = Number(optie("--limit") ?? 0);
const API_BASE = optie("--api-base") ?? process.env.API_BASE ?? "http://localhost:3000";
const REPORT = optie("--report");

interface Ronde {
  code: string;
  fabricId: number;
  jaar: number;
  kwartaal: number;
  correcties: number;
  ordregs: number;
}

/** Alleen orderregels die in dit venster een correctie dragen, met al hun regels. */
function rondeQuery(fabricId: number, from: Date, to: Date): string {
  return `WITH q AS (
${ordersQuery({ from, to, supplierFabricId: fabricId })}
)
SELECT * FROM q
WHERE ordreg_id IN (SELECT ordreg_id FROM q WHERE bron_feit_extra = 'correcties')`;
}

async function werklijst(): Promise<Ronde[]> {
  const rijen = await prisma.$queryRaw<
    { code: string; fabricId: number; jaar: number; kwartaal: number; correcties: bigint; ordregs: bigint }[]
  >`
    SELECT s.code, s."fabricId",
           EXTRACT(YEAR FROM tx.date)::int AS jaar,
           EXTRACT(QUARTER FROM tx.date)::int AS kwartaal,
           COUNT(*) AS correcties,
           COUNT(DISTINCT tx."fabricOrdregId") AS ordregs
    FROM "Transaction" tx
    JOIN "Lot" lo ON lo.id = tx."lotId"
    JOIN "Supplier" s ON s.id = lo."supplierId"
    WHERE tx."bronFeitExtra" = 'correcties'
      AND tx."creditInvoiceDate" IS NULL
      AND s."fabricId" IS NOT NULL
    GROUP BY 1, 2, 3, 4
    ORDER BY 3, 4, 1`;
  return rijen.map((r) => ({
    code: r.code,
    fabricId: r.fabricId,
    jaar: r.jaar,
    kwartaal: r.kwartaal,
    correcties: Number(r.correcties),
    ordregs: Number(r.ordregs),
  }));
}

async function main() {
  let rondes = await werklijst();
  if (SUPPLIER) rondes = rondes.filter((r) => r.code.toUpperCase() === SUPPLIER);
  if (LIMIT > 0) rondes = rondes.slice(0, LIMIT);

  const totaalCorrecties = rondes.reduce((a, r) => a + r.correcties, 0);
  console.log(
    `${rondes.length} kwartaalrondes, ${totaalCorrecties} correcties zonder creditfactuur, ` +
      `${new Set(rondes.map((r) => r.code)).size} leveranciers`
  );
  console.log(APPLY ? `schrijven naar ${API_BASE}\n` : "dry run — er wordt niets weggeschreven\n");

  const regels: string[] = [];
  let opgehaald = 0, geschreven = 0, leeg = 0, mislukt = 0;

  for (const [i, r] of rondes.entries()) {
    const from = new Date(Date.UTC(r.jaar, (r.kwartaal - 1) * 3, 1));
    const to = new Date(Date.UTC(r.jaar, r.kwartaal * 3, 1));
    const label = `${r.code} ${r.jaar}Q${r.kwartaal}`;

    let rijen: Record<string, unknown>[];
    try {
      rijen = await ask<Record<string, unknown>>(rondeQuery(r.fabricId, from, to));
    } catch (e) {
      mislukt++;
      const melding = `${label}: vraag mislukt — ${(e as Error).message.slice(0, 120)}`;
      console.log(`  ${melding}`);
      regels.push(melding);
      continue;
    }

    // Een lege uitkomst waar de portal correcties heeft is geen "niets gevonden".
    // De directe verbinding levert aantoonbaar lege recordsets zonder fout (zie
    // CLAUDE.md), en op zo'n antwoord iets wegschrijven is precies hoe je data
    // kwijtraakt. Overslaan en melden.
    if (rijen.length === 0) {
      leeg++;
      const melding = `${label}: Fabric gaf niets terug terwijl de portal ${r.correcties} correcties heeft — overgeslagen`;
      console.log(`  ${melding}`);
      regels.push(melding);
      continue;
    }
    opgehaald += rijen.length;

    const metCredit = rijen.filter((x) => x["Creditfactuurdatum"] != null).length;
    const melding = `${label}: ${rijen.length} regels, ${metCredit} met creditfactuur (portal: ${r.correcties} correcties over ${r.ordregs} orderregels)`;
    console.log(`  [${i + 1}/${rondes.length}] ${melding}`);
    regels.push(melding);

    if (!APPLY) continue;

    const res = await fetch(`${API_BASE}/api/import/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.IMPORT_API_KEY}`,
      },
      body: JSON.stringify({ orders: rijen }),
    });
    if (!res.ok) {
      mislukt++;
      const fout = `${label}: import gaf ${res.status} — ${(await res.text()).slice(0, 160)}`;
      console.log(`    ${fout}`);
      regels.push(fout);
      continue;
    }
    geschreven += rijen.length;
  }

  const na = await prisma.$queryRaw<{ totaal: bigint; metCredit: bigint }[]>`
    SELECT COUNT(*) AS totaal, COUNT("creditInvoiceDate") AS "metCredit"
    FROM "Transaction" WHERE "bronFeitExtra" = 'correcties'`;

  console.log(`\nrondes: ${rondes.length} | opgehaald: ${opgehaald} regels | ` +
    `${APPLY ? `weggeschreven: ${geschreven}` : "niets weggeschreven (dry run)"} | ` +
    `leeg: ${leeg} | mislukt: ${mislukt}`);
  console.log(`correcties in de portal: ${na[0].totaal}, waarvan met creditfactuur: ${na[0].metCredit}`);

  if (REPORT) {
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, regels.join("\n") + "\n", "utf8");
    console.log(`rapport: ${REPORT}`);
  }
  if (mislukt > 0 || leeg > 0) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
