import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

async function main() {
  // Check both suppliers
  for (const code of ["COLBFL", "MPJCKARA"]) {
  const supplier = await prisma.supplier.findFirst({
    where: { code },
    select: { id: true, code: true, name: true, seasonStartMonth: true },
  });
  console.log("Supplier:", supplier);

  const ytdStart = new Date(2026, 0, 1);

  // Transactions aggregate
  const txAgg = await prisma.transaction.aggregate({
    where: { lot: { supplierId: supplier!.id }, date: { gte: ytdStart } },
    _sum: { stems: true, amount: true },
  });
  console.log("Transactions YTD - stems:", txAgg._sum.stems, "amount:", Number(txAgg._sum.amount));

  // SalesSheet costs aggregate
  const costsAgg = await prisma.salesSheet.aggregate({
    where: { supplierId: supplier!.id, invoiceDate: { gte: ytdStart } },
    _sum: { totalCosts: true },
  });
  console.log("SalesSheet costs YTD:", Number(costsAgg._sum.totalCosts));

  const avgPrice = txAgg._sum.stems! > 0 ? Number(txAgg._sum.amount) / txAgg._sum.stems! : 0;
  const netYield = txAgg._sum.stems! > 0 ? (Number(txAgg._sum.amount) - Number(costsAgg._sum.totalCosts || 0)) / txAgg._sum.stems! : 0;
  console.log("Avg price/stem:", avgPrice.toFixed(4));
  console.log("Net yield/stem:", netYield.toFixed(4));
  console.log("Difference (costs effect):", (avgPrice - netYield).toFixed(4));

  // Check individual salessheets with costs
  const sheets = await prisma.salesSheet.findMany({
    where: { supplierId: supplier!.id, invoiceDate: { gte: ytdStart } },
    select: { id: true, invoiceNumber: true, totalTurnover: true, totalCosts: true, netResult: true, invoiceDate: true },
    orderBy: { invoiceDate: "desc" },
    take: 20,
  });
  console.log("\nRecent salessheets:");
  for (const s of sheets) {
    const date = s.invoiceDate?.toISOString().slice(0, 10) ?? "null";
    console.log(`  ${s.invoiceNumber} | date: ${date} | turnover: ${Number(s.totalTurnover)} | costs: ${Number(s.totalCosts)} | net: ${Number(s.netResult)}`);
  }

  // Check if there are salessheets with negative costs
  const negativeCosts = await prisma.salesSheet.findMany({
    where: { supplierId: supplier!.id, invoiceDate: { gte: ytdStart }, totalCosts: { lt: 0 } },
    select: { invoiceNumber: true, totalCosts: true },
  });
  console.log("\nSalessheets with negative costs:", negativeCosts.length);
  for (const s of negativeCosts) {
    console.log(`  ${s.invoiceNumber}: ${Number(s.totalCosts)}`);
  }

  // Count salessheets with zero costs
  const zeroCosts = await prisma.salesSheet.count({
    where: { supplierId: supplier!.id, invoiceDate: { gte: ytdStart }, totalCosts: 0 },
  });
  const totalSheets = await prisma.salesSheet.count({
    where: { supplierId: supplier!.id, invoiceDate: { gte: ytdStart } },
  });
  console.log(`\nSalessheets with zero costs: ${zeroCosts} / ${totalSheets}`);

  console.log("\n" + "=".repeat(60) + "\n");
  }
  await prisma.$disconnect();
}

main();
