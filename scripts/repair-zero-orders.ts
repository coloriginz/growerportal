/*
 * Repareert orderregels die in de portal op 0 stelen staan terwijl Fabric er
 * inmiddels wel een aantal voor heeft.
 *
 * Waarom dit nodig is: het warehouse vult historie na de feiten aan. Een
 * orderregel die bij het ophalen nog geen aantal had — productieorders zijn het
 * bekendste geval — krijgt later alsnog zijn stelen en prijs. Het schuivende
 * venster van de nachtelijke sync komt daar nooit meer langs, dus zonder een
 * inhaalronde blijft die nul voor altijd in de portal staan. Gemeten op
 * 25 augustus 2026: 2.047 orderregels, 3,6 miljoen stelen, EUR 1,6 miljoen.
 *
 * De route loopt bewust langs POST /api/import/orders en niet langs de
 * backfill-wachtrij. Die wachtrij gaat via Power Automate, dat 202 antwoordt
 * zodra de flow start — een SQL-fout bereikt de portal dan nooit en de job
 * blijft hangen tot de reaper hem na een kwartier omlegt. Hier komt de data uit
 * hetzelfde warehouse maar rechtstreeks, dus een fout is meteen zichtbaar. De
 * importroute zelf is ongewijzigd: die herberekent partijtotalen en ook de
 * omzet, kosten en het nettoresultaat van de geraakte afrekeningen.
 *
 * Draaien (de dev-server moet aanstaan, die bedient de importroute):
 *   npx tsx scripts/repair-zero-orders.ts                       # dry run (standaard)
 *   npx tsx scripts/repair-zero-orders.ts --apply
 *   npx tsx scripts/repair-zero-orders.ts --supplier=COLXGREE --apply
 *   npx tsx scripts/repair-zero-orders.ts --limit=3 --apply     # eerst een proefje
 *
 * Opties:
 *   --apply          schrijf echt weg. Zonder deze vlag wordt er niets gewijzigd.
 *   --supplier=CODE  beperk tot een leverancier (code, hoofdletterongevoelig).
 *   --limit=N        behandel hooguit N kwartaalrondes.
 *   --api-base=URL   doelportal. Standaard $API_BASE, anders http://localhost:3000.
 *   --report=PAD     schrijf het rapport hierheen.
 *
 * Herhaalbaar: de werklijst wordt elke run opnieuw afgeleid uit de nulregels die
 * er op dat moment staan. Wat Fabric echt op nul heeft staan blijft in de lijst
 * en wordt elke run opnieuw opgehaald — dat is goedkoop en het alternatief is
 * een uitzonderingenlijst die niemand bijhoudt. Afbreken kan zonder schade: elke
 * kwartaalronde staat op zichzelf.
 */
import { createRequire } from "module";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { ordersQuery } from "../src/lib/sync/queries/orders";
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
  name: string;
  label: string;
  from: Date;
  to: Date;
  /** Hoeveel nulregels de aanleiding vormden; puur voor het rapport. */
  nulregels: number;
};

type Meting = { regels: number; nullen: number; stelen: number; bedrag: number };

type Uitkomst = {
  ronde: Ronde;
  opgehaald: number;
  voor: Meting;
  na: Meting;
  fout?: string;
};

function argWaarde(vlag: string): string | undefined {
  const arg = process.argv.slice(2).find((a) => a.startsWith(vlag + "="));
  return arg ? arg.slice(vlag.length + 1) : undefined;
}

const APPLY = process.argv.includes("--apply");
const SUPPLIER = argWaarde("--supplier")?.toUpperCase();
const LIMIT = Number(argWaarde("--limit") ?? 0) || Infinity;
const API_BASE = argWaarde("--api-base") ?? process.env.API_BASE ?? "http://localhost:3000";
const REPORT = argWaarde("--report") ?? path.join("tasks", "repair-zero-orders.md");

/** Het kwartaal waar deze datum in valt, met dezelfde grenzen als de backfill. */
function kwartaalVan(datum: Date) {
  return quarterChunks(datum, datum)[0];
}

async function meet(supplierId: string, from: Date, to: Date): Promise<Meting> {
  const waar = { lot: { supplierId }, date: { gte: from, lt: to } };
  const [agg, nullen] = await Promise.all([
    prisma.transaction.aggregate({
      where: waar,
      _count: { _all: true },
      _sum: { stems: true, amount: true },
    }),
    prisma.transaction.count({ where: { ...waar, stems: 0 } }),
  ]);
  return {
    regels: agg._count._all,
    nullen,
    stelen: agg._sum.stems ?? 0,
    bedrag: Number(agg._sum.amount ?? 0),
  };
}

/**
 * De kwartaalrondes die iets te repareren hebben, afgeleid uit de nulregels zelf.
 *
 * Het kwartaal komt uit `Transaction.date`, en dat is exact het veld waarop de
 * importquery filtert (`_datum_key_vertrek`, zie orders/route.ts regel 210).
 * Zou dat uit elkaar lopen, dan haalt een ronde net de regel niet op die de
 * aanleiding was.
 */
async function bouwWerklijst(): Promise<Ronde[]> {
  const nulregels = await prisma.transaction.findMany({
    where: { stems: 0, lot: { supplier: { fabricId: { not: null } } } },
    select: {
      date: true,
      lot: {
        select: {
          supplierId: true,
          supplier: { select: { fabricId: true, code: true, name: true } },
        },
      },
    },
  });

  const perRonde = new Map<string, Ronde>();
  for (const regel of nulregels) {
    const supplier = regel.lot.supplier;
    if (SUPPLIER && supplier.code.toUpperCase() !== SUPPLIER) continue;
    const kwartaal = kwartaalVan(regel.date);
    const sleutel = supplier.fabricId + "::" + kwartaal.label;
    const bestaand = perRonde.get(sleutel);
    if (bestaand) {
      bestaand.nulregels++;
      continue;
    }
    perRonde.set(sleutel, {
      fabricId: supplier.fabricId!,
      supplierId: regel.lot.supplierId,
      code: supplier.code,
      name: supplier.name,
      label: kwartaal.label,
      from: kwartaal.from,
      to: kwartaal.to,
      nulregels: 1,
    });
  }

  return [...perRonde.values()].sort(
    (a, b) => a.code.localeCompare(b.code) || a.from.getTime() - b.from.getTime()
  );
}

/**
 * Haalt de orderregels van een ronde op, met een controle op stille leegte.
 *
 * Het Fabric-endpoint gaf tijdens het bouwen van dit script tweemaal een lege
 * recordset terug zonder een fout te gooien; dezelfde query even later leverde
 * 1.252 rijen. Een lege payload is op zichzelf ongevaarlijk — de import schrapt
 * alleen de (lotId, ordregId)-paren die erin zitten, dus nul rijen betekent nul
 * mutaties — maar het script zou dan stilzwijgend een kwartaal overslaan en dat
 * als een geslaagde ronde rapporteren. Precies de stilte die deze reparatie
 * moet opheffen.
 *
 * De controle gebruikt wat het script al weet: staan er in de portal
 * transacties in dit venster, dan kwamen die uit Fabric en kan Fabric er nu
 * onmogelijk nul hebben. Dat is geen schatting maar een tegenspraak, dus die
 * ronde wordt opnieuw geprobeerd en anders als mislukt genoteerd.
 */
async function haalRijen(ronde: Ronde, voor: Meting): Promise<Record<string, unknown>[]> {
  const sql = ordersQuery({ from: ronde.from, to: ronde.to, supplierFabricId: ronde.fabricId });

  for (let poging = 1; poging <= 2; poging++) {
    const rijen = (await queryFabric(sql))[0] ?? [];
    if (rijen.length > 0 || voor.regels === 0) return rijen;
    if (poging === 1) {
      console.error(
        "    leeg terwijl de portal " + voor.regels + " transacties heeft — opnieuw proberen"
      );
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  throw new Error(
    "Fabric gaf 0 rijen terug terwijl de portal " + voor.regels +
      " transacties in dit venster heeft — overgeslagen in plaats van leeg weggeschreven"
  );
}

/** Stuurt de rijen naar de importroute. Gooit bij een fout; 401/403 apart herkenbaar. */
async function importeer(rijen: Record<string, unknown>[]): Promise<void> {
  const res = await fetch(API_BASE + "/api/import/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + process.env.IMPORT_API_KEY,
    },
    body: JSON.stringify({ orders: rijen }),
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

function getal(n: number): string {
  return n.toLocaleString("nl-NL");
}

function schrijfRapport(uitkomsten: Uitkomst[]): void {
  const perLeverancier = new Map<string, Uitkomst[]>();
  for (const u of uitkomsten) {
    const lijst = perLeverancier.get(u.ronde.code) ?? [];
    lijst.push(u);
    perLeverancier.set(u.ronde.code, lijst);
  }

  const regels: string[] = [
    "# Reparatie nulregels orders",
    "",
    "Uitgevoerd: " + new Date().toISOString().slice(0, 16).replace("T", " "),
    "Modus: " + (APPLY ? "toegepast" : "dry run — niets gewijzigd"),
    "Doelportal: " + API_BASE,
    "",
    "| leverancier | kwartalen | nulregels voor | nulregels na | stelen erbij | omzet erbij |",
    "|---|---|---|---|---|---|",
  ];

  let totStelen = 0;
  let totBedrag = 0;
  let totNulVoor = 0;
  let totNulNa = 0;

  for (const [code, lijst] of [...perLeverancier].sort()) {
    const gelukt = lijst.filter((u) => !u.fout);
    const nulVoor = gelukt.reduce((a, u) => a + u.voor.nullen, 0);
    const nulNa = gelukt.reduce((a, u) => a + u.na.nullen, 0);
    const stelen = gelukt.reduce((a, u) => a + (u.na.stelen - u.voor.stelen), 0);
    const bedrag = gelukt.reduce((a, u) => a + (u.na.bedrag - u.voor.bedrag), 0);
    totStelen += stelen;
    totBedrag += bedrag;
    totNulVoor += nulVoor;
    totNulNa += nulNa;
    const fouten = lijst.filter((u) => u.fout).length;
    const kwartalen = gelukt.length + (fouten ? " (" + fouten + " mislukt)" : "");
    regels.push(
      "| " + code + " | " + kwartalen + " | " + nulVoor + " | " + nulNa + " | " +
        getal(stelen) + " | " + euro(bedrag) + " |"
    );
  }

  regels.push(
    "| **totaal** | " + uitkomsten.filter((u) => !u.fout).length + " | " + totNulVoor +
      " | " + totNulNa + " | **" + getal(totStelen) + "** | **" + euro(totBedrag) + "** |",
    ""
  );

  const mislukt = uitkomsten.filter((u) => u.fout);
  if (mislukt.length > 0) {
    regels.push("## Mislukte rondes", "");
    for (const u of mislukt) regels.push("- " + u.ronde.code + " " + u.ronde.label + ": " + u.fout);
    regels.push("");
  }

  regels.push(
    "## Overgebleven nulregels",
    "",
    "Wat hierna nog op 0 staat, staat in Fabric ook echt op 0 — nulregels met een",
    "lege prijs en plus/min-terugboekingen. Die horen daar te blijven staan.",
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
  const leveranciers = new Set(teDoen.map((r) => r.code)).size;

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
          kop + ": " + rijen.length + " rijen in Fabric, " + voor.nullen + " nulregels in de portal"
        );
        uitkomsten.push({ ronde, opgehaald: rijen.length, voor, na: voor });
        continue;
      }

      await importeer(rijen);
      const na = await meet(ronde.supplierId, ronde.from, ronde.to);
      uitkomsten.push({ ronde, opgehaald: rijen.length, voor, na });

      console.log(
        kop + ": " + rijen.length + " rijen | nullen " + voor.nullen + " -> " + na.nullen +
          " | +" + getal(na.stelen - voor.stelen) + " stelen | +EUR " + euro(na.bedrag - voor.bedrag)
      );
    } catch (e) {
      const bericht = e instanceof Error ? e.message : String(e);
      console.error(kop + ": MISLUKT — " + bericht);
      const leeg = { regels: 0, nullen: 0, stelen: 0, bedrag: 0 };
      uitkomsten.push({ ronde, opgehaald: 0, voor: leeg, na: leeg, fout: bericht });
      // Een verkeerde sleutel maakt elke volgende ronde net zo kansloos; dan is
      // doorgaan alleen maar honderd keer dezelfde fout in het rapport.
      if (bericht.startsWith("AUTH")) {
        console.error("Authenticatie faalt — gestopt.");
        break;
      }
    }
  }

  schrijfRapport(uitkomsten);

  const gelukt = uitkomsten.filter((u) => !u.fout);
  const stelen = gelukt.reduce((a, u) => a + (u.na.stelen - u.voor.stelen), 0);
  const bedrag = gelukt.reduce((a, u) => a + (u.na.bedrag - u.voor.bedrag), 0);
  console.log("");
  console.log(
    "Klaar: " + gelukt.length + "/" + uitkomsten.length + " rondes over " + leveranciers +
      " leveranciers" +
      (APPLY ? " | +" + getal(stelen) + " stelen | +EUR " + euro(bedrag) : "")
  );
  console.log("Rapport: " + REPORT);
}

main()
  .catch((e) => {
    console.error("FOUT:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
