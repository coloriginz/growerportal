/**
 * Zet de twee schemaregels klaar. Idempotent: opnieuw draaien verandert niets
 * aan een regel die je daarna handmatig hebt bijgesteld.
 */
import { prisma } from "../src/lib/db";

async function main() {
  // Beide schema's staan bewust op enabled: false tot de sync-motor compleet is
  // (later ingeschakeld in een volgende taak van het implementatieplan).
  // Partijen en orderregels ontstaan bij levering, dus terugkijken heeft daar
  // weinig zin: twee dagen dekt de vertraging op het warehouse ruim.
  await prisma.syncSchedule.upsert({
    where: { name: "intraday" },
    update: {},
    create: {
      name: "intraday",
      enabled: false,
      intervalMin: 360,
      endpoints: ["lots", "orders"],
      windowDays: 2,
    },
  });

  // Zeven dagen is de tijd die je hebt om een storing op te merken. Kosten
  // ontstaan pas bij afrekenen en zijn na drie weken compleet, vandaar 28.
  await prisma.syncSchedule.upsert({
    where: { name: "nightly" },
    update: {},
    create: {
      name: "nightly",
      enabled: false,
      atTime: "03:00",
      endpoints: ["suppliers", "growers", "lots", "orders", "costs"],
      windowDays: 7,
      windowOverrides: { costs: 28 },
    },
  });

  const all = await prisma.syncSchedule.findMany();
  console.log(JSON.stringify(all, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
