/*
 * Markeert verkopen die ná de datum op de afrekening zijn geboekt, en
 * herberekent de partij- en leveringstotalen zonder die rijen.
 *
 * De import doet dit voortaan zelf en de koppelroute doet het zodra de
 * factuurdatum bekend wordt, maar geen van beide komt terug langs oude
 * vensters. Dit is die inhaalronde.
 *
 * Wat er niet verborgen wordt: correcties. Een tegenboeking draait een eerdere
 * verkoop terug, dus haar wegnemen zou de omzet juist verhogen — zie
 * `src/lib/sync/after-settlement.ts`.
 *
 * Draaien:
 *   npx tsx scripts/backfill-after-settlement.ts            # dry run
 *   npx tsx scripts/backfill-after-settlement.ts --apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { markAfterSettlement, recalculateAfterSettlement } from "../src/lib/sync/after-settlement";

const APPLY = process.argv.includes("--apply");

async function meet(label: string) {
  const r = await prisma.$queryRaw<{ n: bigint; stems: bigint; bedrag: string; leveringen: bigint }[]>`
    SELECT COUNT(*) n, COALESCE(SUM(tx.stems),0) stems, CAST(COALESCE(SUM(tx.amount),0) AS TEXT) bedrag,
           COUNT(DISTINCT lo."salesSheetId") leveringen
    FROM "Transaction" tx JOIN "Lot" lo ON lo.id = tx."lotId"
    WHERE tx."afterSettlement"`;
  console.log(`${label}: ${r[0].n} verborgen transacties over ${r[0].leveringen} leveringen, ${r[0].stems} stelen, EUR ${Number(r[0].bedrag).toFixed(2)}`);
}

async function main() {
  const kandidaten = await prisma.$queryRaw<{ lotid: string }[]>`
    SELECT DISTINCT lo.id AS lotid
    FROM "Transaction" tx
    JOIN "Lot" lo ON lo.id = tx."lotId"
    JOIN "SalesSheet" ss ON ss.id = lo."salesSheetId"
    WHERE ss."pdfInvoiceDate" IS NOT NULL
      AND tx."bronFeitExtra" = 'origineel'
      AND tx.date > ss."pdfInvoiceDate"`;
  const lotIds = kandidaten.map((k) => k.lotid);
  console.log(`${lotIds.length} partijen met een verkoop na de afrekeningsdatum`);
  await meet("nu");

  if (!APPLY) {
    console.log("\ndry run — er wordt niets gewijzigd. Draai met --apply.");
    return;
  }

  const gemarkeerd = await markAfterSettlement(lotIds);
  console.log(`\n${gemarkeerd} transactierijen van vlag gewisseld`);
  await recalculateAfterSettlement(lotIds);
  console.log("partij- en leveringstotalen herberekend");
  await meet("na");

  // De invariant die stil fout kan gaan: een verborgen correctie haalt een
  // negatief bedrag weg en verhoogt de omzet in plaats van hem te verlagen.
  const fout = await prisma.transaction.count({
    where: { afterSettlement: true, bronFeitExtra: { not: "origineel" } },
  });
  console.log(
    fout === 0
      ? "controle: geen enkele correctie is verborgen"
      : `FOUT: ${fout} correctie(s) zijn verborgen — dat verhoogt de omzet in plaats van hem te verlagen`
  );
  if (fout > 0) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
