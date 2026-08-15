/**
 * Zet de twee schemaregels klaar. Idempotent: opnieuw draaien verandert niets
 * aan een regel die je daarna handmatig hebt bijgesteld.
 */
import { prisma } from "../src/lib/db";

async function main() {
  // Beide schema's staan bewust op enabled: false tot de sync-motor compleet is
  // (later ingeschakeld in een volgende taak van het implementatieplan).
  await prisma.syncSchedule.upsert({
    where: { name: "short" },
    update: {},
    create: {
      name: "short",
      enabled: false,
      intervalMin: 60,
      endpoints: ["lots", "orders", "costs"],
      windowDays: 45,
    },
  });

  await prisma.syncSchedule.upsert({
    where: { name: "nightly" },
    update: {},
    create: {
      name: "nightly",
      enabled: false,
      atTime: "03:00",
      endpoints: ["suppliers", "growers", "lots", "orders", "costs"],
      windowDays: 45,
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
