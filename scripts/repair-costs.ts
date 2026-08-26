/*
 * Haalt de kostenregels van afgeronde leveringen opnieuw op uit Fabric.
 *
 * De tegenhanger van `scripts/repair-zero-orders.ts`, om dezelfde reden: het
 * warehouse herziet historie en het schuivende syncvenster komt er niet op
 * terug. Bij de kosten ziet dat er alleen anders uit dan bij de orders.
 *
 * Bij orders ontbrak een aantal (0 stelen) en was dat in de portal te zien.
 * Bij kosten ontbreekt niets: gemeten op 25-08-2026 heeft elke levering in de
 * portal precies evenveel kostenregels als in Fabric. Alleen de bedragen lopen
 * uiteen, met centen tot ruim een euro per levering — 71 van de 74 leveringen
 * van COLXGREE in 2025 Q2. Dat is niet aan de portal te zien zonder Fabric
 * ernaast te leggen, dus dit script kan geen werklijst afleiden uit een
 * verdachte waarde zoals de ordersreparatie dat doet. De werklijst is daarom
 * simpelweg: elk kwartaal waarin een leverancier leveringen heeft.
 *
 * Een deel van de drift heeft dezelfde oorzaak als de nulregels: elke
 * kostenregel draagt zijn eigen grondslag mee (`totaal_omzet`,
 * `totaal_verkoop_aantal`) en die is berekend over de omzet van dat moment.
 * Werd de omzet later hersteld, dan herstelden de kosten mee.
 *
 * Deze ronde vult meteen `costCode`, `salesSheetType` en `isInclusief` — de drie
 * velden die de kostenmart in augustus 2026 kreeg en die portalbreed nog op
 * null staan (55.760 van 55.760 regels).
 *
 * Veiliger dan de ordersreparatie: `/api/import/costs` doet een echte upsert op
 * `shkost_id` en verwijdert niets. Twee keer draaien verandert niets.
 *
 * Draaien (de dev-server moet aanstaan, die bedient de importroute):
 *   npx tsx scripts/repair-costs.ts                       # dry run (standaard)
 *   npx tsx scripts/repair-costs.ts --apply
 *   npx tsx scripts/repair-costs.ts --supplier=COLXGREE --apply
 *   npx tsx scripts/repair-costs.ts --limit=3 --apply      # eerst een proefje
 *
 * Opties:
 *   --apply          schrijf echt weg. Zonder deze vlag wordt er niets gewijzigd.
 *   --supplier=CODE  beperk tot een leverancier (code, hoofdletterongevoelig).
 *   --limit=N        behandel hooguit N kwartaalrondes.
 *   --api-base=URL   doelportal. Standaard $API_BASE, anders http://localhost:3000.
 *   --report=PAD     schrijf het rapport hierheen.
 */
import { createRequire } from "module";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { costsQuery } from "../src/lib/sync/queries/costs";
import { quarterChunks } from "../src/lib/sync/backfill";

const vereis = createRequire(import.meta.url);
const { queryFabric } = vereis("./lib/fabric-connection") as {
  queryFabric: (sql: string) => Promise<Record<string, unknown>[][]>;
};

/** Een leverancier maal een kwartaal: de eenheid waarin dit script werkt. */
type Ronde = {
  fabricId: number;
  supplierId: string;
  code: string;
  label: string;
  from: Date;
  to: Date;
  /** Aantal leveringen in dit kwartaal; de aanleiding en de leegte-controle. */
  leveringen: number;
};

type Meting = {
  /** Kostenregels op de leveringen van dit kwartaal. */
  regels: number;
  /** Som van de bedragen, de maat waar de drift in zichtbaar wordt. */
  bedrag: number;
  /** Regels zonder costCode: wat de kostenmart in augustus 2026 erbij kreeg. */
  zonderCode: number;
};

type Uitkomst = { ronde: Ronde; opgehaald: number; voor: Meting; na: Meting; fout?: string };

function argWaarde(vlag: string): string | undefined {
  const arg = process.argv.slice(2).find((a) => a.startsWith(vlag + "="));
  return arg ? arg.slice(vlag.length + 1) : undefined;
}

const APPLY = process.argv.includes("--apply");
const SUPPLIER = argWaarde("--supplier")?.toUpperCase();
const LIMIT = Number(argWaarde("--limit") ?? 0) || Infinity;
const API_BASE = argWaarde("--api-base") ?? process.env.API_BASE ?? "http://localhost:3000";
const REPORT = argWaarde("--report") ?? path.join("tasks", "repair-costs.md");

/** Het kwartaal waar deze datum in valt, met dezelfde grenzen als de backfill. */
function kwartaalVan(datum: Date) {
  return quarterChunks(datum, datum)[0];
}

/**
 * De stand van de kosten in een kwartaal.
 *
 * Gemeten over de leveringen van dit venster en niet over `SalesSheet.totalCosts`:
 * dat veld wordt door de import herberekend uit dezelfde regels, dus het zou de
 * uitkomst bevestigen in plaats van controleren.
 */
async function meet(supplierId: string, from: Date, to: Date): Promise<Meting> {
  const waar = { salesSheet: { supplierId, deliveryDate: { gte: from, lt: to } } };
  const [agg, zonderCode] = await Promise.all([
    prisma.salesSheetCost.aggregate({ where: waar, _count: { _all: true }, _sum: { amount: true } }),
    prisma.salesSheetCost.count({ where: { ...waar, costCode: null } }),
  ]);
  return {
    regels: agg._count._all,
    bedrag: Number(agg._sum.amount ?? 0),
    zonderCode,
  };
}

/**
 * De kwartalen waarin een leverancier leveringen heeft.
 *
 * `deliveryDate` en niet `invoiceDate`: de kostenquery filtert op
 * `_datum_key_levering`, en een afrekening wordt weken na de levering opgemaakt.
 * Op factuurdatum indelen zou het kwartaal net naast dat van de query leggen.
 */
async function bouwWerklijst(): Promise<Ronde[]> {
  const leveringen = await prisma.salesSheet.findMany({
    where: {
      supplier: SUPPLIER
        ? { fabricId: { not: null }, code: { equals: SUPPLIER, mode: "insensitive" } }
        : { fabricId: { not: null } },
    },
    select: {
      deliveryDate: true,
      supplierId: true,
      supplier: { select: { fabricId: true, code: true } },
    },
  });

  const perRonde = new Map<string, Ronde>();
  for (const levering of leveringen) {
    const kwartaal = kwartaalVan(levering.deliveryDate);
    const sleutel = levering.supplier.fabricId + "::" + kwartaal.label;
    const bestaand = perRonde.get(sleutel);
    if (bestaand) {
      bestaand.leveringen++;
      continue;
    }
    perRonde.set(sleutel, {
      fabricId: levering.supplier.fabricId!,
      supplierId: levering.supplierId,
      code: levering.supplier.code,
      label: kwartaal.label,
      from: kwartaal.from,
      to: kwartaal.to,
      leveringen: 1,
    });
  }

  return [...perRonde.values()].sort(
    (a, b) => a.code.localeCompare(b.code) || a.from.getTime() - b.from.getTime()
  );
}

/**
 * Haalt de kostenregels van een ronde op, met een controle op stille leegte.
 *
 * Het Fabric-endpoint kan een lege recordset teruggeven zonder een fout te
 * gooien; zie de gelijknamige functie in `repair-zero-orders.ts`.
 *
 * De controle draait op de kostenregels die de portal al heeft, niet op zijn
 * leveringen. Dat onderscheid is duur geleerd: een levering hoeft geen
 * kostenregels te hebben. PCRUICON heeft 718 partijen in Fabric en welgeteld
 * één kostenregel, dus vier van zijn vijf kwartalen kwamen terecht leeg terug
 * en werden door de vorige versie van deze controle als storing weggezet.
 * Kostenregels in de portal kwamen daarentegen per definitie uit Fabric, dus
 * dáár is nul wél een tegenspraak.
 */
async function haalRijen(ronde: Ronde, voor: Meting): Promise<Record<string, unknown>[]> {
  const sql = costsQuery({ from: ronde.from, to: ronde.to, supplierFabricId: ronde.fabricId });

  for (let poging = 1; poging <= 2; poging++) {
    const rijen = (await queryFabric(sql))[0] ?? [];
    if (rijen.length > 0 || voor.regels === 0) return rijen;
    if (poging === 1) {
      console.error(
        "    leeg terwijl de portal " + voor.regels + " kostenregels heeft — opnieuw proberen"
      );
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  throw new Error(
    "Fabric gaf 0 kostenregels terug terwijl de portal er " + voor.regels +
      " in dit venster heeft — overgeslagen"
  );
}

/** Stuurt de rijen naar de importroute. Gooit bij een fout; 401/403 apart herkenbaar. */
async function importeer(rijen: Record<string, unknown>[]): Promise<void> {
  const res = await fetch(API_BASE + "/api/import/costs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + process.env.IMPORT_API_KEY,
    },
    body: JSON.stringify({ costs: rijen }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("AUTH " + res.status + ": " + (await res.text()).slice(0, 200));
  }
  if (!res.ok) {
    throw new Error("HTTP " + res.status + ": " + (await res.text()).slice(0, 300));
  }
}

function euro(n: number): string {
  return n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function schrijfRapport(uitkomsten: Uitkomst[]): void {
  const perLeverancier = new Map<string, Uitkomst[]>();
  for (const u of uitkomsten) {
    const lijst = perLeverancier.get(u.ronde.code) ?? [];
    lijst.push(u);
    perLeverancier.set(u.ronde.code, lijst);
  }

  const regels: string[] = [
    "# Reparatie kostenregels",
    "",
    "Uitgevoerd: " + new Date().toISOString().slice(0, 16).replace("T", " "),
    "Modus: " + (APPLY ? "toegepast" : "dry run — niets gewijzigd"),
    "Doelportal: " + API_BASE,
    "",
    "| leverancier | kwartalen | kostenregels | bijgesteld | zonder costCode voor | na |",
    "|---|---|---|---|---|---|",
  ];

  let totRegels = 0;
  let totBedrag = 0;
  let totCodeVoor = 0;
  let totCodeNa = 0;

  for (const [code, lijst] of [...perLeverancier].sort()) {
    const gelukt = lijst.filter((u) => !u.fout);
    const regelsN = gelukt.reduce((a, u) => a + u.na.regels, 0);
    const bedrag = gelukt.reduce((a, u) => a + (u.na.bedrag - u.voor.bedrag), 0);
    const codeVoor = gelukt.reduce((a, u) => a + u.voor.zonderCode, 0);
    const codeNa = gelukt.reduce((a, u) => a + u.na.zonderCode, 0);
    totRegels += regelsN;
    totBedrag += bedrag;
    totCodeVoor += codeVoor;
    totCodeNa += codeNa;
    const fouten = lijst.filter((u) => u.fout).length;
    regels.push(
      "| " + code + " | " + gelukt.length + (fouten ? " (" + fouten + " mislukt)" : "") +
        " | " + regelsN + " | " + euro(bedrag) + " | " + codeVoor + " | " + codeNa + " |"
    );
  }

  regels.push(
    "| **totaal** | " + uitkomsten.filter((u) => !u.fout).length + " | " + totRegels +
      " | **" + euro(totBedrag) + "** | " + totCodeVoor + " | " + totCodeNa + " |",
    ""
  );

  const mislukt = uitkomsten.filter((u) => u.fout);
  if (mislukt.length > 0) {
    regels.push("## Mislukte rondes", "");
    for (const u of mislukt) regels.push("- " + u.ronde.code + " " + u.ronde.label + ": " + u.fout);
    regels.push("");
  }

  regels.push(
    "## Lezen",
    "",
    "\"Bijgesteld\" is het verschil in de som van de kostenbedragen, niet een fout die is",
    "hersteld: het warehouse herziet zowel omhoog als omlaag. `SalesSheet.totalCosts` en",
    "`netResult` zijn door de import meegerekend.",
    ""
  );

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, regels.join("\n"), "utf8");
}

async function main() {
  if (APPLY && !process.env.IMPORT_API_KEY) {
    console.error("IMPORT_API_KEY ontbreekt in de omgeving.");
    process.exit(1);
  }

  const werklijst = await bouwWerklijst();
  const teDoen = LIMIT === Infinity ? werklijst : werklijst.slice(0, LIMIT);

  console.log(
    werklijst.length + " kwartaalrondes over " +
      new Set(werklijst.map((r) => r.code)).size + " leveranciers" +
      (teDoen.length < werklijst.length ? " — beperkt tot " + teDoen.length : "")
  );
  console.log(APPLY ? "Schrijft naar " + API_BASE : "DRY RUN — er wordt niets gewijzigd");
  console.log("");

  const uitkomsten: Uitkomst[] = [];

  for (const [i, ronde] of teDoen.entries()) {
    const kop = "[" + (i + 1) + "/" + teDoen.length + "] " + ronde.code + " " + ronde.label;
    try {
      const voor = await meet(ronde.supplierId, ronde.from, ronde.to);
      const rijen = await haalRijen(ronde, voor);

      if (!APPLY) {
        console.log(
          kop + ": " + rijen.length + " kostenregels in Fabric, " + voor.regels +
            " in de portal (" + ronde.leveringen + " leveringen)"
        );
        uitkomsten.push({ ronde, opgehaald: rijen.length, voor, na: voor });
        continue;
      }

      await importeer(rijen);
      const na = await meet(ronde.supplierId, ronde.from, ronde.to);
      uitkomsten.push({ ronde, opgehaald: rijen.length, voor, na });

      console.log(
        kop + ": " + rijen.length + " regels | bedrag " + euro(na.bedrag - voor.bedrag) +
          " | zonder costCode " + voor.zonderCode + " -> " + na.zonderCode
      );
    } catch (e) {
      const bericht = e instanceof Error ? e.message : String(e);
      console.error(kop + ": MISLUKT — " + bericht);
      const leeg = { regels: 0, bedrag: 0, zonderCode: 0 };
      uitkomsten.push({ ronde, opgehaald: 0, voor: leeg, na: leeg, fout: bericht });
      if (bericht.startsWith("AUTH")) {
        console.error("Authenticatie faalt — gestopt.");
        break;
      }
    }
  }

  schrijfRapport(uitkomsten);

  const gelukt = uitkomsten.filter((u) => !u.fout);
  const bedrag = gelukt.reduce((a, u) => a + (u.na.bedrag - u.voor.bedrag), 0);
  const codeNa = gelukt.reduce((a, u) => a + u.na.zonderCode, 0);
  console.log("");
  console.log(
    "Klaar: " + gelukt.length + "/" + uitkomsten.length + " rondes" +
      (APPLY ? " | kosten bijgesteld met EUR " + euro(bedrag) + " | nog " + codeNa + " regels zonder costCode" : "")
  );
  console.log("Rapport: " + REPORT);
}

main()
  .catch((e) => {
    console.error("FOUT:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
