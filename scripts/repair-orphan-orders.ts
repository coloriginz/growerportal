/*
 * Verwijdert orderregels die de portal nog toont maar die Fabric heeft ingetrokken.
 *
 * De inhaalronde bij de opruiming die `/api/import/orders` sinds vandaag zelf
 * doet (zie `src/lib/sync/withdrawal.ts`). De import kon lang wel toevoegen en
 * wijzigen maar nooit verwijderen: de opruiming vóór het herinvoeren was
 * gescoped op de (partij, ordreg)-paren uit de binnenkomende batch, en een
 * orderregel die het warehouse laat vallen komt in geen enkele latere batch meer
 * voor. Zo'n regel bleef dus staan, met omzet en al.
 *
 * Gemeten op 29-08-2026: 176 weesregels, 150.735 stelen, EUR 49.419,35 aan omzet
 * die niet bestaat, verspreid over 105 leveringen bij 25 leveranciers. Twee
 * leveringen bestonden voor 100% uit ingetrokken regels — daar zag de kweker
 * omzet die er nooit is geweest. Alles vanaf april 2026: oudere data is in één
 * backfill geladen ná de intrekking, dus alleen wat "live" is opgehaald kan nog
 * ingetrokken worden.
 *
 * De nieuwe regel in de importroute lost dit niet met terugwerkende kracht op:
 * die werkt alleen op vensters die nog een keer langskomen, en juni 2026 komt
 * niet meer terug. Vandaar dit script. Ná een schone herstart vanuit een lege
 * database is het niet meer nodig — dan doet de route het meteen goed.
 *
 * Werkwijze: per kwartaal alle orderregels van de portalleveranciers uit
 * `marts.fct_orders` halen, en elke portaltransactie waarvan het
 * (part_id, ordreg_id)-paar daar niet in voorkomt aanmerken als wees. Daarna de
 * partij- en leveringstotalen herrekenen, met exact dezelfde SQL als de
 * importroute gebruikt, zodat de uitkomst niet kan afwijken.
 *
 * Verwijderen alléén is niet genoeg, en dat kostte een ronde om te leren: van de
 * 146 partijen waar op 29-08-2026 een weesregel op stond, hadden er 145 in Fabric
 * nog wél orderregels — onder een ánder ordreg_id. Het warehouse hernummert, en
 * dat ziet er van hier af precies zo uit als intrekken. De portal had die nieuwe
 * ids nooit opgehaald omdat het venster van juni 2026 niet meer terugkomt. Wie
 * dan enkel opruimt, ruilt EUR 49.419 te veel in voor EUR 47.653 te weinig.
 * Vandaar de volgorde: eerst opnieuw ophalen via /api/import/orders, dan pas de
 * regels weggooien die dan nog steeds een dood ordreg_id dragen.
 *
 * Twee grenzen, allebei met opzet:
 *   - Een kwartaal dat leeg terugkomt terwijl de portal er transacties heeft,
 *     wordt overgeslagen en gemeld. Fabric geeft een gefilterde query soms
 *     zonder fout een lege recordset terug; op zo'n antwoord verwijderen is de
 *     fout die je pas maanden later vindt.
 *   - Er wordt nooit meer dan `--max-share` van de transacties van een kwartaal
 *     verwijderd (standaard 5%). Een echte intrekking is een handvol regels;
 *     raakt het meer, dan klopt de aanname niet en niet de data.
 *
 * De dev-server moet aanstaan: het opnieuw ophalen loopt langs de importroute,
 * zodat de schrijflogica niet wordt nagebouwd.
 *
 * Draaien:
 *   npx tsx scripts/repair-orphan-orders.ts                    # dry run (standaard)
 *   npx tsx scripts/repair-orphan-orders.ts --apply
 *   npx tsx scripts/repair-orphan-orders.ts --supplier=PCFUP
 *   npx tsx scripts/repair-orphan-orders.ts --from=2026-04-01 --apply
 *
 * Opties:
 *   --apply            verwijder echt. Zonder deze vlag wordt er niets gewijzigd.
 *   --supplier=CODE    beperk tot één leverancier (code, hoofdletterongevoelig).
 *   --from=YYYY-MM-DD  vroegste transactiedatum. Standaard de oudste in de portal.
 *   --to=YYYY-MM-DD    laatste transactiedatum (exclusief). Standaard de dag na de nieuwste.
 *   --max-share=N      afkapgrens per kwartaal in procenten. Standaard 5.
 *   --report=PAD       schrijf het rapport hierheen.
 *   --from-report=PAD  neem de werklijst voor het opnieuw ophalen uit een eerder
 *                      rapport. Voor een ronde waarin al is opgeruimd maar nog
 *                      niet opgehaald.
 *   --no-refetch       sla het opnieuw ophalen over. Alleen zinnig als je zeker
 *                      weet dat er niet hernummerd is; dat weet je vrijwel nooit.
 *   --api-base=URL     doelportal. Standaard $API_BASE, anders http://localhost:3000.
 */
import { createRequire } from "module";
import * as fs from "fs";
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { quarterChunks } from "../src/lib/sync/backfill";
import { ordersQuery } from "../src/lib/sync/queries/orders";
import { isoDate } from "../src/lib/sync/queries/helpers";

const vereis = createRequire(import.meta.url);
const { queryFabric } = vereis("./lib/fabric-connection") as {
  queryFabric: (sql: string) => Promise<Record<string, unknown>[][]>;
};

function optie(vlag: string): string | null {
  const arg = process.argv.slice(2).find((a) => a.startsWith(vlag + "="));
  return arg ? arg.slice(vlag.length + 1) : null;
}

const APPLY = process.argv.includes("--apply");
const SUPPLIER = optie("--supplier")?.toUpperCase() ?? null;
const MAX_SHARE = Number(optie("--max-share") ?? 5);
const REPORT = optie("--report");
const FROM_REPORT = optie("--from-report");
const REFETCH = !process.argv.includes("--no-refetch");
const API_BASE = optie("--api-base") ?? process.env.API_BASE ?? "http://localhost:3000";

type Wees = {
  id: string;
  supplier: string;
  lotNumber: string;
  fabricPartId: number | null;
  fabricOrdregId: number | null;
  date: Date;
  stems: number;
  amount: string;
};

async function main() {
  console.log(
    APPLY
      ? "TOEPASSEN — weesregels worden verwijderd"
      : "DRY RUN — er wordt niets gewijzigd (gebruik --apply)"
  );

  const suppliers = await prisma.supplier.findMany({
    where: { fabricId: { not: null }, ...(SUPPLIER ? { code: SUPPLIER } : {}) },
    select: { id: true, code: true, fabricId: true },
  });
  if (suppliers.length === 0) {
    console.log("Geen leveranciers met een fabricId gevonden — niets te doen.");
    return;
  }
  const relIds = suppliers.map((s) => s.fabricId as number);
  console.log(`Leveranciers in scope: ${suppliers.length}`);

  const grenzen = await prisma.transaction.aggregate({
    _min: { date: true },
    _max: { date: true },
  });
  if (!grenzen._min.date || !grenzen._max.date) {
    console.log("Geen transacties in de portal — niets te doen.");
    return;
  }
  const vanaf = new Date(optie("--from") ?? isoDate(grenzen._min.date));
  const naDeLaatste = new Date(grenzen._max.date);
  naDeLaatste.setUTCDate(naDeLaatste.getUTCDate() + 1);
  const tot = new Date(optie("--to") ?? isoDate(naDeLaatste));
  console.log(`Periode: ${isoDate(vanaf)} tot ${isoDate(tot)} (exclusief)\n`);

  const kwartalen = quarterChunks(vanaf, new Date(tot.getTime() - 1));
  const alleWezen: Wees[] = [];
  const overgeslagen: string[] = [];

  for (const kwartaal of kwartalen) {
    const van = kwartaal.from < vanaf ? vanaf : kwartaal.from;
    const naar = kwartaal.to > tot ? tot : kwartaal.to;
    if (!(naar > van)) continue;

    const portal = await prisma.$queryRaw<Wees[]>`
      SELECT t.id, s.code AS supplier, l."lotNumber", l."fabricPartId",
             t."fabricOrdregId", t.date, t.stems, t.amount::text AS amount
      FROM "Transaction" t
      JOIN "Lot" l ON l.id = t."lotId"
      JOIN "Supplier" s ON s.id = l."supplierId"
      WHERE t.date >= ${van} AND t.date < ${naar}
        AND s."fabricId" = ANY(${relIds})
      ORDER BY t.id`;

    if (portal.length === 0) {
      console.log(`${kwartaal.label}: geen portaltransacties, overgeslagen`);
      continue;
    }

    const [fabric] = await queryFabric(
      [
        "SELECT part_id, ordreg_id",
        "FROM marts.fct_orders",
        `WHERE _datum_key_vertrek >= '${isoDate(van)}'`,
        `  AND _datum_key_vertrek <  '${isoDate(naar)}'`,
        "  AND part_id IS NOT NULL",
        "  AND ordreg_id IS NOT NULL",
        `  AND rel_id_leverancier IN (${relIds.join(",")})`,
      ].join("\n")
    );

    // Een leeg antwoord waar de portal wél rijen heeft is geen bewijs van een
    // leeg kwartaal. Gemeten op 26-08-2026: drie keer op rij leeg, minuten later
    // drie keer 1.511 rijen, zonder ook maar één foutmelding ertussen.
    if (fabric.length === 0) {
      const melding = `${kwartaal.label}: Fabric gaf 0 rijen terwijl de portal er ${portal.length} heeft — OVERGESLAGEN`;
      console.log(melding);
      overgeslagen.push(melding);
      continue;
    }

    const bekend = new Set(fabric.map((r) => `${r.part_id}:${r.ordreg_id}`));
    const wezen = portal.filter((t) => !bekend.has(`${t.fabricPartId}:${t.fabricOrdregId}`));
    const aandeel = (wezen.length / portal.length) * 100;

    if (aandeel > MAX_SHARE) {
      const melding =
        `${kwartaal.label}: ${wezen.length} van ${portal.length} regels (${aandeel.toFixed(1)}%) ` +
        `zou verdwijnen, boven de grens van ${MAX_SHARE}% — OVERGESLAGEN`;
      console.log(melding);
      overgeslagen.push(melding);
      continue;
    }

    const bedrag = wezen.reduce((s, w) => s + Number(w.amount), 0);
    const stelen = wezen.reduce((s, w) => s + w.stems, 0);
    console.log(
      `${kwartaal.label}: ${portal.length} portaltransacties, ${fabric.length} in Fabric, ` +
        `${wezen.length} wees (${aandeel.toFixed(2)}%) — ${stelen} stelen, EUR ${bedrag.toFixed(2)}`
    );
    alleWezen.push(...wezen);
  }

  const totaalBedrag = alleWezen.reduce((s, w) => s + Number(w.amount), 0);
  const totaalStelen = alleWezen.reduce((s, w) => s + w.stems, 0);
  console.log(
    `\nTotaal: ${alleWezen.length} weesregels, ${totaalStelen} stelen, EUR ${totaalBedrag.toFixed(2)}`
  );

  const perLeverancier = new Map<string, { regels: number; stelen: number; bedrag: number }>();
  for (const w of alleWezen) {
    const v = perLeverancier.get(w.supplier) ?? { regels: 0, stelen: 0, bedrag: 0 };
    v.regels++;
    v.stelen += w.stems;
    v.bedrag += Number(w.amount);
    perLeverancier.set(w.supplier, v);
  }
  if (perLeverancier.size > 0) {
    console.log("\nPer leverancier:");
    for (const [code, v] of [...perLeverancier].sort((a, b) => b[1].bedrag - a[1].bedrag)) {
      console.log(
        `  ${code.padEnd(10)} ${String(v.regels).padStart(4)} regels | ` +
          `${String(v.stelen).padStart(8)} stelen | EUR ${v.bedrag.toFixed(2).padStart(11)}`
      );
    }
  }

  if (REPORT) {
    fs.writeFileSync(REPORT, JSON.stringify({ overgeslagen, wezen: alleWezen }, null, 2), "utf8");
    console.log(`\nRapport geschreven naar ${REPORT}`);
  }

  if (overgeslagen.length > 0) {
    console.log(`\nLet op: ${overgeslagen.length} kwartaal/kwartalen overgeslagen:`);
    for (const m of overgeslagen) console.log(`  ${m}`);
  }

  // De werklijst voor het opnieuw ophalen: elke leverancier maal elk kwartaal
  // waar een weesregel op stond. Uit een eerder rapport als dat is meegegeven —
  // dan is er al opgeruimd en hoeft alleen het ophalen nog te gebeuren.
  const combos = new Set<string>();
  for (const w of alleWezen) combos.add(`${w.supplier}::${kwartaalVan(w.date)}`);
  if (FROM_REPORT) {
    const eerder = JSON.parse(fs.readFileSync(FROM_REPORT, "utf8")) as { wezen: Wees[] };
    for (const w of eerder.wezen) combos.add(`${w.supplier}::${kwartaalVan(new Date(w.date))}`);
    console.log(`\nWerklijst aangevuld uit ${FROM_REPORT}`);
  }

  if (!APPLY) {
    if (REFETCH && combos.size > 0) {
      console.log(
        `\nZou ${combos.size} leverancier/kwartaal-ronde(s) opnieuw ophalen via ${API_BASE}`
      );
    }
    console.log("\nDRY RUN — er is niets gewijzigd. Draai opnieuw met --apply.");
    return;
  }

  /*
   * Eerst ophalen, dan pas opruimen. Een hernummerde orderregel komt binnen
   * onder zijn nieuwe id; wat daarna nóg een dood id draagt is pas echt weg.
   * Andersom zou de portal tussen de twee stappen in te lage omzet tonen, en
   * bij een mislukte tweede stap blijft dat zo staan.
   */
  if (REFETCH && combos.size > 0) {
    await haalOpnieuwOp([...combos], suppliers);
  }

  if (alleWezen.length === 0) {
    console.log("\nGeen weesregels om te verwijderen.");
    return;
  }

  const ids = alleWezen.map((w) => w.id);
  const geraakt = await prisma.transaction.findMany({
    where: { id: { in: ids } },
    select: { lotId: true },
  });
  const geraakteLots = [...new Set(geraakt.map((l) => l.lotId))];

  const verwijderd = await prisma.transaction.deleteMany({ where: { id: { in: ids } } });
  console.log(`\nVerwijderd: ${verwijderd.count} transacties over ${geraakteLots.length} partijen`);

  await herrekenLots(geraakteLots);
  await herrekenSalesSheets(geraakteLots);
}

/** Het kwartaal van een datum als "2026-Q2", de sleutel van de werklijst. */
function kwartaalVan(datum: Date): string {
  const d = new Date(datum);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/** Van "2026-Q2" terug naar de vensterranden. */
function vensterVan(label: string): { from: Date; to: Date } {
  const [jaar, kw] = label.split("-Q");
  const maand = (Number(kw) - 1) * 3;
  return {
    from: new Date(Date.UTC(Number(jaar), maand, 1)),
    to: new Date(Date.UTC(Number(jaar), maand + 3, 1)),
  };
}

/*
 * Haalt per leverancier per kwartaal alle orderregels opnieuw op en laat ze door
 * /api/import/orders wegschrijven. Bewust langs de route en niet rechtstreeks naar
 * de database: de schrijflogica hoort op één plek te staan, anders loopt een
 * reparatie uit de pas met de import die er daarna overheen komt.
 *
 * De route doet een paar-gescopede delete+insert, dus dit is optellend: bestaande
 * regels worden herschreven, hernummerde regels komen erbij, en er verdwijnt niets.
 * Het verwijderen is een aparte stap die hierna komt.
 */
async function haalOpnieuwOp(
  combos: string[],
  suppliers: { id: string; code: string; fabricId: number | null }[]
) {
  console.log(`\nOpnieuw ophalen: ${combos.length} ronde(s) via ${API_BASE}`);
  const perCode = new Map(suppliers.map((s) => [s.code, s]));
  let gelukt = 0;
  const mislukt: string[] = [];

  for (const combo of combos.sort()) {
    const [code, label] = combo.split("::");
    const supplier = perCode.get(code);
    if (!supplier?.fabricId) {
      mislukt.push(`${combo}: leverancier niet gevonden`);
      continue;
    }
    const { from, to } = vensterVan(label);

    try {
      const rijen =
        (await queryFabric(ordersQuery({ from, to, supplierFabricId: supplier.fabricId })))[0] ?? [];

      if (rijen.length === 0) {
        // Dezelfde tegenspraak als bij de detectie: Fabric kan hier onmogelijk
        // nul hebben, want de portal heeft er regels uit gehaald.
        mislukt.push(`${combo}: Fabric gaf 0 rijen terug`);
        continue;
      }

      // De mssql-driver geeft DECIMAL/NUMERIC als string terug waar Power
      // Automate een getal stuurt; de route valideert op number en zou de hele
      // payload afwijzen.
      for (const r of rijen) {
        for (const veld of ["Verkoopvolume", "Verkoop_colli", "Afrekenomzet", "Gem afrekenprijs"]) {
          if (typeof r[veld] === "string") r[veld] = Number(r[veld]);
        }
      }

      const res = await fetch(API_BASE + "/api/import/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + process.env.IMPORT_API_KEY,
        },
        body: JSON.stringify({ orders: rijen }),
      });
      if (!res.ok) {
        mislukt.push(`${combo}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        continue;
      }
      const uitkomst = (await res.json()) as { created?: number; updated?: number };
      console.log(
        `  ${code.padEnd(10)} ${label}: ${rijen.length} rijen -> ` +
          `${uitkomst.created ?? 0} nieuw, ${uitkomst.updated ?? 0} herschreven`
      );
      gelukt++;
    } catch (e) {
      mislukt.push(`${combo}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`Opnieuw opgehaald: ${gelukt} van ${combos.length} ronde(s)`);
  if (mislukt.length > 0) {
    console.log(`MISLUKT (${mislukt.length}):`);
    for (const m of mislukt) console.log(`  ${m}`);
  }
}

/*
 * Dezelfde berekening als fase 5 van /api/import/orders. Bewust gelijkgehouden en
 * niet "ongeveer hetzelfde" opnieuw geschreven: een partij die hier anders wordt
 * uitgerekend dan de import doet, klapt bij de volgende ronde terug en dan lijkt
 * de reparatie niets te hebben gedaan.
 *
 * Eén verschil met de import, en dat is nodig: daar is de LEFT JOIN niet nodig
 * omdat elke geraakte partij per definitie transacties in de batch heeft. Hier
 * kan een partij er nul overhouden — dat is juist het geval waar het om gaat —
 * en een INNER JOIN zou die partij op zijn oude totaal laten staan.
 */
async function herrekenLots(lotIds: string[]) {
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "Lot" AS l
     SET
       "totalStems" = COALESCE(agg.total_stems, 0),
       "totalAmount" = ROUND(COALESCE(agg.total_amount, 0)::numeric, 2),
       "avgPrice" = CASE WHEN COALESCE(agg.total_stems, 0) > 0
         THEN ROUND((COALESCE(agg.total_amount, 0) / agg.total_stems)::numeric, 4)
         ELSE 0 END,
       "updatedAt" = NOW()
     FROM (
       SELECT
         lot.id AS "lotId",
         SUM(t.stems)::int as total_stems,
         SUM(t.amount) as total_amount
       FROM "Lot" lot
       LEFT JOIN "Transaction" t ON t."lotId" = lot.id
       WHERE lot.id IN (SELECT jsonb_array_elements_text($1::jsonb))
       GROUP BY lot.id
     ) AS agg
     WHERE l.id = agg."lotId"`,
    JSON.stringify(lotIds)
  );
  console.log(`Partijtotalen herrekend: ${n}`);
}

/** Letterlijk fase 6 van /api/import/orders, om dezelfde reden. */
async function herrekenSalesSheets(lotIds: string[]) {
  const lots = await prisma.lot.findMany({
    where: { id: { in: lotIds } },
    select: { salesSheetId: true },
  });
  const ssIds = [...new Set(lots.map((l) => l.salesSheetId).filter(Boolean))] as string[];
  if (ssIds.length === 0) return;

  const n = await prisma.$executeRawUnsafe(
    `WITH ss_ids AS (
       SELECT jsonb_array_elements_text($1::jsonb) AS id
     ),
     lot_totals AS (
       SELECT "salesSheetId", SUM("totalAmount") as total
       FROM "Lot"
       WHERE "salesSheetId" IN (SELECT id FROM ss_ids)
       GROUP BY "salesSheetId"
     ),
     cost_totals AS (
       SELECT "salesSheetId", SUM(amount) as total
       FROM "SalesSheetCost"
       WHERE "salesSheetId" IN (SELECT id FROM ss_ids)
       GROUP BY "salesSheetId"
     )
     UPDATE "SalesSheet" AS ss
     SET
       "totalTurnover" = ROUND(COALESCE(lt.total, 0)::numeric, 2),
       "totalCosts" = ROUND(COALESCE(ct.total, 0)::numeric, 2),
       "netResult" = ROUND((COALESCE(lt.total, 0) - COALESCE(ct.total, 0))::numeric, 2),
       "updatedAt" = NOW()
     FROM ss_ids
     LEFT JOIN lot_totals lt ON lt."salesSheetId" = ss_ids.id
     LEFT JOIN cost_totals ct ON ct."salesSheetId" = ss_ids.id
     WHERE ss.id = ss_ids.id`,
    JSON.stringify(ssIds)
  );
  console.log(`Leveringstotalen herrekend: ${n}`);
}

main()
  .catch((e) => {
    console.error("FOUT:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
