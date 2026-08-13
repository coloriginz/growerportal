import { prisma } from "../src/lib/db";

async function main() {
  // Get PCXOMRI supplier info
  const supplier = await prisma.supplier.findFirst({
    where: { code: "PCXOMRI" },
    select: { id: true, fabricId: true, code: true, name: true },
  });
  console.log("Supplier:", supplier);

  if (!supplier) return;

  // Get ALL salessheets for this supplier with cost counts
  const sheets = await prisma.salesSheet.findMany({
    where: { supplierId: supplier.id },
    include: {
      _count: { select: { costs: true, lots: true } },
    },
    orderBy: { fabricParthdrId: "asc" },
  });

  console.log(`\n=== ALL SALESSHEETS (${sheets.length}) ===`);
  for (const s of sheets) {
    console.log(
      `  inv=${s.invoiceNumber} | parthdr=${s.fabricParthdrId} | turnover=${s.totalTurnover} | costs=${s.totalCosts} | costRows=${s._count.costs} | lots=${s._count.lots}`
    );
  }

  // Get all unique parthdr_ids from lots for this supplier
  const lots = await prisma.lot.findMany({
    where: { supplierId: supplier.id },
    select: { lotNumber: true, fabricPartId: true, fabricParthdrId: true, salesSheetId: true },
  });

  const parthdrIds = [...new Set(lots.map((l) => l.fabricParthdrId).filter(Boolean))];
  console.log(`\n=== UNIQUE PARTHDR_IDs on lots (${parthdrIds.length}) ===`);
  console.log(parthdrIds.sort((a, b) => (a ?? 0) - (b ?? 0)).join(", "));

  // Check which ones have salessheets
  const sheetParthdrIds = new Set(sheets.map((s) => s.fabricParthdrId));
  const missingSheets = parthdrIds.filter((id) => !sheetParthdrIds.has(id));
  console.log(`\nParthdr_ids WITHOUT salessheet: ${missingSheets.length}`);
  for (const id of missingSheets) {
    console.log(`  ${id}`);
  }

  // Check lots that are on salessheet "960"
  const ss960 = sheets.find((s) => s.invoiceNumber === "960");
  if (ss960) {
    const lotsOn960 = lots.filter((l) => l.salesSheetId === ss960.id);
    console.log(`\n=== LOTS ON SALESSHEET "960" (${lotsOn960.length}) ===`);
    for (const l of lotsOn960) {
      console.log(`  lot=${l.lotNumber} | part_id=${l.fabricPartId} | parthdr=${l.fabricParthdrId}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
