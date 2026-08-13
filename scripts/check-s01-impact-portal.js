/*
 * Kruist de relaties met afwijkende S01-betekenis tegen de leveranciers die
 * daadwerkelijk in de grower portal zitten.
 */
const { PrismaClient } = require("../src/generated/prisma");
const prisma = new PrismaClient();

// rel_id -> partijen, uit de Fabric-query van 03-08-2026
const GERAAKT = {
  9442: 850, 11888: 340, 14388: 312, 13460: 274, 14624: 269, 9516: 263, 9456: 170,
  16167: 124, 9537: 118, 9884: 107, 13397: 77, 9407: 69, 10508: 61, 9451: 58,
  8576: 56, 9496: 54, 11534: 49, 9581: 48, 9549: 46, 13112: 41, 10208: 39,
  15639: 34, 29389: 27, 11352: 21, 28596: 20, 9730: 19, 14399: 18, 10171: 17,
  10552: 13, 18314: 11, 9443: 11, 11601: 9, 18564: 7, 16800: 7, 28887: 7,
  9487: 6, 10255: 5, 1: 3, 9519: 2, 16829: 2, 9533: 2, 11909: 2, 16596: 1,
  11435: 1, 29373: 1, 9406: 1, 9577: 1, 17203: 1, 12500: 1, 10634: 1,
};

(async () => {
  const ids = Object.keys(GERAAKT).map(Number);

  const suppliers = await prisma.supplier.findMany({
    where: { fabricId: { in: ids } },
    select: { code: true, name: true, fabricId: true, featureSales: true },
    orderBy: { name: "asc" },
  });

  const totaalPortal = await prisma.supplier.count();
  const metFabricId = await prisma.supplier.count({ where: { fabricId: { not: null } } });

  console.log(`Portal heeft ${totaalPortal} leveranciers, waarvan ${metFabricId} met een fabricId.\n`);

  if (!suppliers.length) {
    console.log("GEEN ENKELE geraakte relatie komt voor als leverancier in de portal.");
  } else {
    console.log(`${suppliers.length} geraakte relatie(s) zitten WEL in de portal:\n`);
    console.table(suppliers.map((s) => ({
      code: s.code, naam: s.name, fabricId: s.fabricId,
      partijen_geraakt: GERAAKT[s.fabricId], sales_actief: s.featureSales,
    })));
    const som = suppliers.reduce((t, s) => t + (GERAAKT[s.fabricId] || 0), 0);
    console.log(`\nTotaal geraakte partijen bij portal-leveranciers: ${som}`);
  }

  // hoeveel lots staan er nu in de portal met die suppliers
  if (suppliers.length) {
    const lots = await prisma.lot.groupBy({
      by: ["supplierId"],
      where: { supplier: { fabricId: { in: suppliers.map((s) => s.fabricId) } } },
      _count: { _all: true },
    });
    console.log(`\nDeze leveranciers hebben samen ${lots.reduce((t, l) => t + l._count._all, 0)} lots in de portal.`);
  }

  await prisma.$disconnect();
})().catch(async (e) => { console.error("FOUT: " + e.message); await prisma.$disconnect(); process.exit(1); });
