import { prisma } from "../src/lib/db";

async function main() {
  // Check where these ordreg_ids ended up
  const ids = [16841395, 16844164];

  for (const ordregId of ids) {
    const tx = await prisma.transaction.findUnique({
      where: { fabricOrdregId: ordregId },
      include: { lot: { select: { lotNumber: true, fabricPartId: true } } },
    });
    if (tx) {
      console.log(`ordreg_id ${ordregId}: lot ${tx.lot.lotNumber} (part_id ${tx.lot.fabricPartId}) | stems: ${tx.stems} | ${tx.salesType}`);
    } else {
      console.log(`ordreg_id ${ordregId}: NOT FOUND in database`);
    }
  }

  // Count how many ordreg_ids appear on multiple part_ids in the CSV
  // (this is a data model issue in Fabric)
  const dupeCount = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as total FROM (
      SELECT "fabricOrdregId"
      FROM "Transaction"
      GROUP BY "fabricOrdregId"
      HAVING COUNT(DISTINCT "lotId") > 1
    ) sub
  `);
  console.log("\nTransactions linked to multiple lots in DB:", dupeCount);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
