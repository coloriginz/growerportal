/*
 * Vult firstName / middleName / lastName voor gebruikers die alleen een
 * samengestelde `name` hebben.
 *
 * De drie velden zijn nieuw; alles wat er al stond heeft alleen `name`. Het
 * formulier splitst zo'n oude naam bij het openen ook zelf, maar dan pas op het
 * moment dat iemand die gebruiker toevallig bewerkt — deze ronde doet ze in
 * één keer, zodat een lijst op achternaam meteen klopt.
 *
 * De splitsing is een heuristiek (`splitPersonName`): eerste woord is de
 * voornaam, daarna zo veel mogelijk woorden die samen een tussenvoegsel vormen,
 * de rest is achternaam. `name` zelf wordt niet aangeraakt — die blijft precies
 * staan zoals hij was, dus deze ronde is niet zichtbaar in de portal en kan
 * zonder gevolgen opnieuw.
 *
 * Draaien:
 *   npx tsx scripts/backfill-user-names.ts            # dry run
 *   npx tsx scripts/backfill-user-names.ts --apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { composeName, splitPersonName } from "../src/lib/person-name";

const APPLY = process.argv.includes("--apply");

async function main() {
  const users = await prisma.user.findMany({
    where: { firstName: null, lastName: null },
    select: { id: true, name: true, email: true },
    orderBy: { email: "asc" },
  });

  console.log(`${users.length} gebruiker(s) zonder gesplitste naam`);
  if (users.length === 0) return;

  let geschreven = 0;
  let zonderAchternaam = 0;
  const voorbeelden: string[] = [];

  for (const user of users) {
    const parts = splitPersonName(user.name);

    // Zou samenstellen iets anders opleveren dan er staat, dan hebben we de
    // naam niet begrepen en blijft hij met rust: liever een leeg veld dan een
    // stille verminking van iemands naam.
    if (composeName(parts) !== user.name.trim().replace(/\s+/g, " ")) {
      console.log(`OVERGESLAGEN ${user.email}: "${user.name}" laat zich niet terugvormen`);
      continue;
    }

    if (!parts.lastName) zonderAchternaam++;
    if (voorbeelden.length < 10) {
      voorbeelden.push(`"${user.name}" -> ${parts.firstName} | ${parts.middleName || "-"} | ${parts.lastName || "-"}`);
    }

    if (APPLY) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          firstName: parts.firstName || null,
          middleName: parts.middleName || null,
          lastName: parts.lastName || null,
        },
      });
    }
    geschreven++;
  }

  console.log("\nVoorbeelden:");
  for (const v of voorbeelden) console.log("  " + v);
  console.log(`\n${geschreven} gebruiker(s) ${APPLY ? "bijgewerkt" : "zouden worden bijgewerkt"}`);
  if (zonderAchternaam > 0) {
    console.log(`${zonderAchternaam} daarvan hebben een naam van één woord en houden dus een lege achternaam.`);
  }
  if (!APPLY) console.log("\nDry run — draai met --apply om te schrijven.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
