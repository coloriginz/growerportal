import { prisma } from "../src/lib/db";

async function main() {
  const lotNumber = "3920612";

  // Find the lot
  const lot = await prisma.lot.findFirst({
    where: { lotNumber },
    include: {
      transactions: { orderBy: { date: "asc" } },
      corrections: true,
      supplier: { select: { code: true, name: true } },
      salesSheet: { select: { invoiceNumber: true } },
    },
  });

  if (!lot) {
    console.log(`Lot ${lotNumber} not found`);
    await prisma.$disconnect();
    return;
  }

  console.log("=== LOT ===");
  console.log(`Lot: ${lot.lotNumber} | fabricPartId: ${lot.fabricPartId}`);
  console.log(`Supplier: ${lot.supplier.code} ${lot.supplier.name}`);
  console.log(`SalesSheet: ${lot.salesSheet?.invoiceNumber}`);
  console.log(`totalStems (stored): ${lot.totalStems}`);
  console.log(`invoicedVolume: ${lot.invoicedVolume}`);
  console.log(`totalAmount: ${lot.totalAmount}`);
  console.log(`avgPrice: ${lot.avgPrice}`);
  console.log(`colli: ${lot.colli} | stemLength: ${lot.stemLength}`);

  console.log("\n=== TRANSACTIONS ===");
  let txTotal = 0;
  for (const tx of lot.transactions) {
    console.log(`  ${tx.date.toISOString().slice(0,10)} | ${tx.salesType.padEnd(15)} | stems: ${String(tx.stems).padStart(5)} | price: ${tx.pricePerStem} | amount: ${tx.amount} | ordregId: ${tx.fabricOrdregId}`);
    txTotal += tx.stems;
  }
  console.log(`  TOTAL: ${txTotal} stems from ${lot.transactions.length} transactions`);

  console.log("\n=== CORRECTIONS ===");
  // correctionReasonId heeft geen FK (zie schema.prisma), dus de naam apart opzoeken.
  const reasonIds = [...new Set(lot.corrections.map(c => c.correctionReasonId).filter((id): id is number => id != null))];
  const reasons = reasonIds.length === 0
    ? []
    : await prisma.correctionReasonCode.findMany({ where: { id: { in: reasonIds } } });
  const reasonById = new Map(reasons.map(r => [r.id, r]));
  for (const c of lot.corrections) {
    const reason = c.correctionReasonId != null ? reasonById.get(c.correctionReasonId) : undefined;
    console.log(`  ${c.facttypeSub} | reasonId: ${c.correctionReasonId} (${reason?.nameEn || reason?.nameNl || 'unknown'}) | volume: ${c.correctionVolume} | fabricPartId: ${c.fabricPartId}`);
  }

  // Check if there are other lots with same lotNumber (different suppliers?)
  const otherLots = await prisma.lot.findMany({
    where: { lotNumber, id: { not: lot.id } },
    select: { id: true, supplierId: true, supplier: { select: { code: true } } },
  });
  if (otherLots.length > 0) {
    console.log("\n=== OTHER LOTS WITH SAME NUMBER ===");
    for (const ol of otherLots) {
      console.log(`  id: ${ol.id} | supplier: ${ol.supplier.code}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
