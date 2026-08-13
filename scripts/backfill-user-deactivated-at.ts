/*
 * Verdeelt bestaande User-rijen over de twee betekenissen die `isActive = false`
 * tot nu toe droeg, zodat SSO ze uit elkaar kan houden.
 *
 * De splitsing komt uit de gids (§3.3): wie ooit een wachtwoord heeft gezet,
 * heeft het account in gebruik gehad en is dus uitgezet. Wie er geen heeft, is
 * nooit begonnen en blijft "uitgenodigd".
 *
 *   isActive = false, passwordHash gezet   -> deactivatedAt vullen
 *   isActive = false, geen passwordHash    -> null laten (uitgenodigd)
 *   isActive = true                        -> null laten
 *
 * Als tijdstempel gebruiken we `updatedAt`. We weten niet wanneer iemand is
 * uitgezet; de laatste wijziging benadert dat beter dan het moment waarop dit
 * script toevallig draait.
 *
 * DRAAI DIT VOORDAT DE ENTRA-PROVIDER AANGAAT. Zonder backfill ziet een
 * uitgezet account eruit als een uitgenodigd account. De beslissingsfunctie
 * heeft daar een vangnet voor, maar dat is een vangnet en geen migratie.
 *
 * Draaien:
 *   npx tsx scripts/backfill-user-deactivated-at.ts            # alleen rapporteren
 *   npx tsx scripts/backfill-user-deactivated-at.ts --apply    # ook wegschrijven
 *
 * Leest via de Neon HTTP-driver; Prisma over TCP 5432 komt niet door het
 * werknetwerk heen. Voor productie: DATABASE_URL uit .env.production gebruiken
 * via ENV_FILE=.env.production.
 */
import fs from "fs";
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const ENV_FILE = process.env.ENV_FILE || ".env";

const url = fs.readFileSync(ENV_FILE, "utf8").match(/^DATABASE_URL="?([^"\n\r]+)"?/m)![1];
const sql = neon(url);

interface Row {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  hasPassword: boolean;
  deactivatedAt: string | null;
  updatedAt: string;
}

(async () => {
  console.log(`Database uit ${ENV_FILE}`);
  console.log(APPLY ? "Modus: WEGSCHRIJVEN\n" : "Modus: alleen rapporteren (gebruik --apply)\n");

  const rows = (await sql`
    SELECT id, email, role, "isActive",
           ("passwordHash" IS NOT NULL) AS "hasPassword",
           to_char("deactivatedAt", 'YYYY-MM-DD') AS "deactivatedAt",
           to_char("updatedAt", 'YYYY-MM-DD') AS "updatedAt"
    FROM "User" ORDER BY role, email`) as unknown as Row[];

  const uitgezet = rows.filter((r) => !r.isActive && r.hasPassword && !r.deactivatedAt);
  const uitgenodigd = rows.filter((r) => !r.isActive && !r.hasPassword && !r.deactivatedAt);
  const actief = rows.filter((r) => r.isActive);
  const alGezet = rows.filter((r) => r.deactivatedAt);

  console.log(`${rows.length} gebruikers`);
  console.log(`  actief                              : ${actief.length}`);
  console.log(`  uitgenodigd, nooit geactiveerd      : ${uitgenodigd.length}  (blijft null)`);
  console.log(`  uitgezet — krijgt een tijdstempel   : ${uitgezet.length}`);
  console.log(`  had al een tijdstempel              : ${alGezet.length}`);

  if (uitgezet.length) {
    console.log("\nDeze krijgen deactivatedAt:");
    uitgezet.forEach((r) => console.log(`  ${r.role.padEnd(12)} ${r.email}  -> ${r.updatedAt}`));
  }
  if (uitgenodigd.length) {
    console.log("\nDeze blijven 'uitgenodigd' en kunnen dus via SSO activeren:");
    uitgenodigd.forEach((r) => console.log(`  ${r.role.padEnd(12)} ${r.email}`));
  }

  if (!APPLY) {
    console.log("\nNiets weggeschreven. Draai opnieuw met --apply.");
    return;
  }
  if (!uitgezet.length) {
    console.log("\nNiets te doen.");
    return;
  }

  await sql`
    UPDATE "User" SET "deactivatedAt" = "updatedAt"
    WHERE "isActive" = false AND "passwordHash" IS NOT NULL AND "deactivatedAt" IS NULL`;
  console.log(`\n${uitgezet.length} rijen bijgewerkt.`);
})().catch((e) => console.log("FOUT:", e.message));
