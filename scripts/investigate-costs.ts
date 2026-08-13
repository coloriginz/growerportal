import { prisma } from "../src/lib/db";

async function main() {
  // Find the salessheet with invoiceNumber "960"
  const ss960 = await prisma.salesSheet.findFirst({
    where: { invoiceNumber: "960" },
    include: {
      supplier: { select: { code: true, name: true } },
      lots: { select: { lotNumber: true, fabricPartId: true, fabricParthdrId: true }, take: 3 },
      costs: { select: { id: true, description: true, amount: true } },
    },
  });

  console.log("=== SALESSHEET '960' ===");
  if (ss960) {
    console.log(`id: ${ss960.id}`);
    console.log(`invoiceNumber: ${ss960.invoiceNumber}`);
    console.log(`fabricParthdrId: ${ss960.fabricParthdrId}`);
    console.log(`supplier: ${ss960.supplier.code} ${ss960.supplier.name}`);
    console.log(`totalTurnover: ${ss960.totalTurnover} | totalCosts: ${ss960.totalCosts} | netResult: ${ss960.netResult}`);
    console.log(`lots (first 3): ${ss960.lots.map(l => `${l.lotNumber} (part_id=${l.fabricPartId}, parthdr_id=${l.fabricParthdrId})`).join(", ")}`);
    console.log(`costs: ${ss960.costs.length} items`);
    for (const c of ss960.costs) {
      console.log(`  ${c.description}: ${c.amount}`);
    }
  } else {
    console.log("Not found");
  }

  // Check if there's a salessheet with invoice "402348"
  const ss402 = await prisma.salesSheet.findFirst({
    where: { invoiceNumber: "402348" },
    include: {
      supplier: { select: { code: true, name: true } },
      lots: { select: { lotNumber: true, fabricPartId: true, fabricParthdrId: true } },
      costs: { select: { id: true, description: true, amount: true } },
    },
  });

  console.log("\n=== SALESSHEET '402348' ===");
  if (ss402) {
    console.log(`id: ${ss402.id}`);
    console.log(`invoiceNumber: ${ss402.invoiceNumber}`);
    console.log(`fabricParthdrId: ${ss402.fabricParthdrId}`);
    console.log(`supplier: ${ss402.supplier.code} ${ss402.supplier.name}`);
    console.log(`totalTurnover: ${ss402.totalTurnover} | totalCosts: ${ss402.totalCosts} | netResult: ${ss402.netResult}`);
    console.log(`lots: ${ss402.lots.length} items`);
    for (const l of ss402.lots) {
      console.log(`  ${l.lotNumber} (part_id=${l.fabricPartId}, parthdr_id=${l.fabricParthdrId})`);
    }
    console.log(`costs: ${ss402.costs.length} items`);
    for (const c of ss402.costs) {
      console.log(`  ${c.description}: ${c.amount}`);
    }
  } else {
    console.log("Not found");
  }

  // Check: do the lots on ss960 share a parthdr_id with ss402?
  if (ss960 && ss402) {
    const pIds960 = new Set(ss960.lots.map(l => l.fabricParthdrId));
    console.log(`\n=== COMPARISON ===`);
    console.log(`ss960 parthdr_ids: ${[...pIds960].join(", ")}`);
    console.log(`ss402 fabricParthdrId: ${ss402.fabricParthdrId}`);
  }

  // Also look at the costs backfill CSV for this parthdr_id
  if (ss960?.fabricParthdrId) {
    const costsBySamePatrhdr = await prisma.salesSheetCost.findMany({
      where: { salesSheet: { fabricParthdrId: ss960.fabricParthdrId } },
    });
    console.log(`\nCosts linked to parthdr_id ${ss960.fabricParthdrId}: ${costsBySamePatrhdr.length}`);
  }

  // Check costs CSV data for lots' parthdr_ids
  if (ss960) {
    const allParthdrIds = [...new Set(ss960.lots.map(l => l.fabricParthdrId).filter(Boolean))];
    console.log(`\nAll unique parthdr_ids on ss960 lots: ${allParthdrIds.join(", ")}`);

    for (const pid of allParthdrIds) {
      const ssForPid = await prisma.salesSheet.findFirst({
        where: { fabricParthdrId: pid },
        select: { id: true, invoiceNumber: true },
      });
      console.log(`  parthdr_id ${pid} → salessheet: ${ssForPid?.invoiceNumber || "none"} (id: ${ssForPid?.id || "none"})`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
