import { prisma } from "../src/lib/db";

async function main() {
  const supplier = await prisma.supplier.findFirst({ where: { code: "PCXOMRI" } });
  if (!supplier) { console.log("Supplier not found"); return; }

  const sheets = await prisma.salesSheet.findMany({
    where: { supplierId: supplier.id },
    include: {
      _count: { select: { costs: true } },
      lots: { select: { deliveryDate: true, fabricParthdrId: true }, take: 1 },
    },
    orderBy: { fabricParthdrId: "asc" },
  });

  const noCosts = sheets.filter((s) => s._count.costs === 0);
  console.log(`Salessheets zonder kosten (${noCosts.length}):`);
  for (const s of noCosts) {
    const lot = s.lots[0];
    console.log(
      `  inv=${s.invoiceNumber} | parthdr=${s.fabricParthdrId} | deliveryDate=${lot?.deliveryDate?.toISOString().slice(0, 10) || "n/a"}`
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
