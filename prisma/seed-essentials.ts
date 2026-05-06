/**
 * Seed essential non-data records: companies, internal users, fust types, transporter.
 * Run AFTER seed-fabric.ts which only creates suppliers, lots, transactions, etc.
 *
 * Usage: npx tsx prisma/seed-essentials.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Seeding essential records ===\n");

  // ─── Companies ──────────────────────────────────────────
  const coloriginz = await prisma.company.upsert({
    where: { slug: "coloriginz" },
    update: {},
    create: {
      name: "Coloriginz",
      slug: "coloriginz",
      logoUrl: "/logos/coloriginz.png",
      emailFrom: "noreply@coloriginz.com",
      emailName: "Coloriginz Grower Portal",
      footerText: "Coloriginz \u2014 OZ Import BV, Aalsmeer",
    },
  });
  console.log("Company: Coloriginz (upserted)");

  await prisma.company.upsert({
    where: { slug: "mypeony" },
    update: {},
    create: {
      name: "MyPeony",
      slug: "mypeony",
      logoUrl: "/logos/mypeony.png",
      emailFrom: "noreply@mypeonysociety.com",
      emailName: "MyPeony Grower Portal",
      footerText: "MyPeony Society",
    },
  });
  console.log("Company: MyPeony (upserted)");

  // ─── Internal Users ─────────────────────────────────────
  const adminHash = await hash("Colori2026!", 12);
  const commercieHash = await hash("FloraDesk#24", 12);
  const transportHash = await hash("Transport#2026", 12);
  const financeHash = await hash("Finance#2026", 12);

  // Admin
  await prisma.user.upsert({
    where: { email: "admin@coloriginz.com" },
    update: {},
    create: {
      email: "admin@coloriginz.com",
      passwordHash: adminHash,
      name: "Admin Coloriginz",
      role: "admin",
      isActive: true,
    },
  });
  console.log("User: admin@coloriginz.com (admin)");

  // Commercie users
  const commercie1 = await prisma.user.upsert({
    where: { email: "iris.inkoper@coloriginz.com" },
    update: {},
    create: {
      email: "iris.inkoper@coloriginz.com",
      passwordHash: commercieHash,
      name: "Iris Inkoper",
      role: "commercie",
      isActive: true,
    },
  });
  console.log("User: iris.inkoper@coloriginz.com (commercie)");

  await prisma.user.upsert({
    where: { email: "tom.tulp@coloriginz.com" },
    update: {},
    create: {
      email: "tom.tulp@coloriginz.com",
      passwordHash: commercieHash,
      name: "Tom Tulp",
      role: "commercie",
      isActive: true,
    },
  });
  console.log("User: tom.tulp@coloriginz.com (commercie)");

  // Finance
  await prisma.user.upsert({
    where: { email: "finance@coloriginz.com" },
    update: {},
    create: {
      email: "finance@coloriginz.com",
      passwordHash: financeHash,
      name: "Lisa Boekhouder",
      role: "finance",
      isActive: true,
    },
  });
  console.log("User: finance@coloriginz.com (finance)");

  // ─── Transporter ────────────────────────────────────────
  const transporter = await prisma.transporter.upsert({
    where: { id: "flowertrans-default" },
    update: {},
    create: {
      id: "flowertrans-default",
      name: "FlowerTrans BV",
      email: "dispatch@flowertrans.nl",
      phone: "+31 20 555 0100",
      isActive: true,
    },
  });
  console.log("Transporter: FlowerTrans BV (upserted)");

  // Transporteur user
  await prisma.user.upsert({
    where: { email: "chauffeur@flowertrans.nl" },
    update: {},
    create: {
      email: "chauffeur@flowertrans.nl",
      passwordHash: transportHash,
      name: "Kees de Vries",
      role: "transporteur",
      isActive: true,
      transporterId: transporter.id,
    },
  });
  console.log("User: chauffeur@flowertrans.nl (transporteur)");

  // ─── Fust Types ─────────────────────────────────────────
  const FUST_TYPES = [
    { code: "Fc555", name: "Bloemenemmer nieuw (2026)", category: "emmers", pricePerUnit: 3.50, sortOrder: 1 },
    { code: "Fc566", name: "Bloemenemmer klein", category: "emmers", pricePerUnit: 3.00, sortOrder: 2 },
    { code: "Fc577", name: "Bloemenemmer groot (oud)", category: "emmers", pricePerUnit: 3.50, sortOrder: 3 },
    { code: "Fc588", name: "Bloemenemmer groot (nieuw)", category: "emmers", pricePerUnit: 3.50, sortOrder: 4 },
    { code: "Fc965", name: "Container + draagplateau", category: "emmers", pricePerUnit: 5.00, sortOrder: 5 },
    { code: "Fc996", name: "Bloemenemmer Fc566 + opzetrek", category: "emmers", pricePerUnit: 4.80, sortOrder: 6 },
    { code: "Fc997", name: "Bloemenemmer Fc577 + opzetrek", category: "emmers", pricePerUnit: 5.50, sortOrder: 7 },
    { code: "Fc998", name: "Bloemenemmer Fc588 + opzetrek", category: "emmers", pricePerUnit: 5.50, sortOrder: 8 },
    { code: "Fc595", name: "Laag opzetrek meermalig", category: "opzetrekken", pricePerUnit: 1.80, sortOrder: 1 },
    { code: "Fc596", name: "Hoog opzetrek meermalig", category: "opzetrekken", pricePerUnit: 2.00, sortOrder: 2 },
    { code: "Fc597", name: "Opzetrek / draagplateau", category: "opzetrekken", pricePerUnit: 2.00, sortOrder: 3 },
    { code: "3170", name: "Deense kar", category: "karren", pricePerUnit: 10.50, sortOrder: 1 },
    { code: "3171", name: "CC container", category: "karren", pricePerUnit: 12.00, sortOrder: 2 },
    { code: "3175", name: "Deense kar half", category: "karren", pricePerUnit: 7.50, sortOrder: 3 },
    { code: "3180", name: "Stapelwagen", category: "karren", pricePerUnit: 15.00, sortOrder: 4 },
    { code: "3190", name: "Palletkar", category: "karren", pricePerUnit: 18.00, sortOrder: 5 },
    { code: "4100", name: "Normkrat", category: "kratten", pricePerUnit: 1.30, sortOrder: 1 },
    { code: "4200", name: "Veilingkrat groen", category: "kratten", pricePerUnit: 1.50, sortOrder: 2 },
    { code: "4210", name: "Veilingkrat blauw", category: "kratten", pricePerUnit: 1.50, sortOrder: 3 },
    { code: "4250", name: "Boekettenkrat", category: "kratten", pricePerUnit: 2.20, sortOrder: 4 },
    { code: "4500", name: "Emmerkrat", category: "kratten", pricePerUnit: 1.80, sortOrder: 5 },
    { code: "4910", name: "ELF-tray", category: "kratten", pricePerUnit: 0.85, sortOrder: 6 },
    { code: "4920", name: "Procona 12/14", category: "kratten", pricePerUnit: 1.10, sortOrder: 7 },
    { code: "4930", name: "Procona 16", category: "kratten", pricePerUnit: 1.25, sortOrder: 8 },
    { code: "4940", name: "Procona 19", category: "kratten", pricePerUnit: 1.40, sortOrder: 9 },
    { code: "5100", name: "Inzet 1/1", category: "dozen", pricePerUnit: 0.35, sortOrder: 1 },
    { code: "5200", name: "Inzet 1/2", category: "dozen", pricePerUnit: 0.25, sortOrder: 2 },
    { code: "5310", name: "Hoezen lang", category: "overig", pricePerUnit: 0.15, sortOrder: 1 },
    { code: "5320", name: "Hoezen kort", category: "overig", pricePerUnit: 0.12, sortOrder: 2 },
    { code: "6100", name: "Beschermdop", category: "overig", pricePerUnit: 0.08, sortOrder: 3 },
    { code: "7100", name: "Waterbuisje", category: "overig", pricePerUnit: 0.05, sortOrder: 4 },
  ];

  let ftCreated = 0;
  for (const ft of FUST_TYPES) {
    await prisma.fustType.upsert({
      where: { code: ft.code },
      update: {},
      create: ft,
    });
    ftCreated++;
  }
  console.log(`Fust types: ${ftCreated} (upserted)`);

  // ─── Enable fust for some suppliers ─────────────────────
  // Pick first 5 suppliers that have transaction data
  const suppliersWithData = await prisma.supplier.findMany({
    where: { lots: { some: { transactions: { some: {} } } } },
    take: 5,
    select: { id: true, code: true },
  });

  for (const s of suppliersWithData) {
    await prisma.supplier.update({
      where: { id: s.id },
      data: { fustEnabled: true, defaultTransporterId: transporter.id },
    });
  }
  console.log(`Fust enabled for ${suppliersWithData.length} suppliers: ${suppliersWithData.map(s => s.code).join(", ")}`);

  // ─── Assign commercie to some suppliers ─────────────────
  const allSuppliers = await prisma.supplier.findMany({ select: { id: true } });
  const half = Math.ceil(allSuppliers.length / 2);
  for (let i = 0; i < allSuppliers.length; i++) {
    await prisma.supplier.update({
      where: { id: allSuppliers[i].id },
      data: { commercieId: commercie1.id },
    });
  }
  console.log(`Assigned commercie to ${allSuppliers.length} suppliers`);

  // ─── Settings ───────────────────────────────────────────
  await prisma.setting.upsert({
    where: { key: "test_email_mode" },
    update: {},
    create: { key: "test_email_mode", value: "ethereal" },
  });
  console.log("Settings: test_email_mode = ethereal");

  // ─── Summary ────────────────────────────────────────────
  console.log("\n=== Essential seed complete ===");
  console.log(`  Companies: ${await prisma.company.count()}`);
  console.log(`  Users: ${await prisma.user.count()}`);
  console.log(`  Fust types: ${await prisma.fustType.count()}`);
  console.log(`  Transporters: ${await prisma.transporter.count()}`);
  console.log("\n  Demo accounts:");
  console.log("    admin@coloriginz.com / Colori2026!");
  console.log("    iris.inkoper@coloriginz.com / FloraDesk#24");
  console.log("    finance@coloriginz.com / Finance#2026");
  console.log("    chauffeur@flowertrans.nl / Transport#2026");
}

main()
  .catch((e) => {
    console.error("Essentials seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
