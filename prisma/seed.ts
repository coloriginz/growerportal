// @ts-nocheck
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { hash } from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { getISOWeek } from "date-fns";

const prisma = new PrismaClient();

// ─── DATA DEFINITIONS ────────────────────────────────────

const GROWERS = [
  { code: "PCFUP", name: "Odilia Santos", company: "Flora United Farm LDA", country: "Portugal", city: "Odeceixe", postalCode: "7630-909", street: "Apartado 178", vatNumber: "PT508247985", ggn: "4063061993861" },
  { code: "COLXSHA", name: "David Cohen", company: "Shachlav Flowers", country: "Israel", city: "Moshav Talmey Yosef", postalCode: "8548900", street: "Hadas 5, D.N hanegev 4" },
  { code: "PROFAR", name: "Johan van der Berg", company: "Protea Farm Stellenbosch", country: "South Africa", city: "Stellenbosch", postalCode: "7600", street: "12 Protea Road" },
  { code: "RSFZIM", name: "Tendai Moyo", company: "Rose Farm Zimbabwe", country: "Zimbabwe", city: "Harare", postalCode: "00263", street: "Plot 45 Mazowe Road" },
  { code: "FLOKEN", name: "James Mwangi", company: "Flora Kenya Ltd", country: "Kenya", city: "Naivasha", postalCode: "20117", street: "PO Box 234" },
  { code: "GRNCOL", name: "Carlos Gutierrez", company: "Green Colombia SAS", country: "Colombia", city: "Bogota", postalCode: "110111", street: "Calle 72 #10-25" },
  { code: "NATLEU", name: "Pierre Dubois", company: "Naturel Fleurs", country: "France", city: "Grasse", postalCode: "06130", street: "45 Route de Cannes" },
  { code: "BLOETH", name: "Abebe Tadesse", company: "Bloom Ethiopia PLC", country: "Ethiopia", city: "Addis Ababa", postalCode: "1000", street: "Bole Sub City" },
  { code: "PROAUS", name: "Sarah Mitchell", company: "ProFlora Australia", country: "Australia", city: "Perth", postalCode: "6000", street: "18 Wildflower Drive" },
  { code: "FYNBOS", name: "Pieter Botha", company: "Fynbos Blooms", country: "South Africa", city: "Cape Town", postalCode: "7700", street: "34 Fynbos Lane" },
  { code: "TROPEC", name: "Maria Rodriguez", company: "Tropical Ecuador SA", country: "Ecuador", city: "Quito", postalCode: "170150", street: "Av. Amazonas 123" },
  { code: "ROSIND", name: "Priya Sharma", company: "Rose India Exports", country: "India", city: "Pune", postalCode: "411001", street: "Plot 78 MIDC" },
  { code: "ORCHTH", name: "Somchai Patel", company: "Orchid Thailand Co.", country: "Thailand", city: "Bangkok", postalCode: "10330", street: "Sukhumvit Soi 55" },
  { code: "NATIVN", name: "Nguyen Van Hoa", company: "Native Flowers Vietnam", country: "Vietnam", city: "Da Lat", postalCode: "66000", street: "12 Tran Phu" },
  { code: "WILDNZ", name: "Emma Wilson", company: "Wildflower NZ Ltd", country: "New Zealand", city: "Auckland", postalCode: "1010", street: "28 Pohutukawa Ave" },
  { code: "SUNNSA", name: "Francois du Toit", company: "Sunny Blooms SA", country: "South Africa", city: "Paarl", postalCode: "7646", street: "8 Main Road" },
  { code: "MEDTUR", name: "Mehmet Yilmaz", company: "Mediterranean Flowers", country: "Turkey", city: "Antalya", postalCode: "07100", street: "Konyaalti Cad. 56" },
  { code: "ANDEAN", name: "Luis Fernandez", company: "Andean Flowers SRL", country: "Peru", city: "Lima", postalCode: "15001", street: "Jr. Union 456" },
  { code: "CAPFLO", name: "Anna de Villiers", company: "Cape Flora Export", country: "South Africa", city: "George", postalCode: "6530", street: "22 Garden Route" },
  { code: "EUROBQ", name: "Hans Mueller", company: "Euro Bouquets GmbH", country: "Germany", city: "Hamburg", postalCode: "20095", street: "Blumenstrasse 12" },
];

const ARTICLE_GROUPS = ["Protea", "Chamelaucium", "Delphinium", "Liatris", "Solidago", "Aster", "Nutans", "Leucadendron"];

const PRODUCTS: Record<string, string[]> = {
  Protea: ["Protea Cynaroides Madiba", "Protea White Night", "Protea Pink Ice", "Protea Repens", "Protea Magnifica"],
  Chamelaucium: ["Chamelaucium Adi", "Chamelaucium Ofir", "Chamelaucium Sirius", "Chamelaucium Jupiter Moon", "Chamelaucium Grand Adi"],
  Delphinium: ["Delph Du Elatum Christel", "Delph Du Elatum Guardian Blue", "Delph Du Belladonna Volkerfrieden"],
  Liatris: ["Liatris Spicata", "Liatris Callilepis"],
  Solidago: ["Solidago Tara", "Solidago Goldkind"],
  Aster: ["Aster Ericoides White", "Aster Monte Casino"],
  Nutans: ["Nutans Ayoba Sun", "Nutans Ayoba Pink", "Nutans Soleil", "Nutans Joti"],
  Leucadendron: ["Leucadendron Safari Sunset", "Leucadendron Rosette", "Leucadendron Galpinii"],
};

const SALES_TYPES = ["Direct sales", "VBA", "VPL", "Production"];
const COST_TYPES = [
  "Additional handling charges", "Commission auction", "Container rental",
  "Distribution Costs", "Handling charges", "Lot levy", "Trolley levy",
  "Waste tax", "Admin./Price information", "Commission auction sales",
  "Commission direct sales", "Financing and debtors insurance",
  "Service charge + BBH levy", "Transaction levy",
];
const QUALITY_CODES = [
  { code: "110", description: "Few damaged flowers/bud/fruit" },
  { code: "120", description: "Discoloured flowers" },
  { code: "130", description: "Botrytis" },
  { code: "154", description: "Few impure flowers" },
  { code: "160", description: "Bent stems" },
  { code: "170", description: "Dehydrated" },
];
const CORRECTION_TYPES = [
  "Handling: less in box", "Handling: more in box", "Handling: quality",
  "stock check shortage", "stock check extra amount",
  "Commerciele Correctie", "Poor product quality",
  "Returned by customer due to insufficient quality",
];
const CERTIFICATE_TYPES = [
  { type: "GlobalGAP", prefix: "GGN-" },
  { type: "MPS", prefix: "MPS-" },
];
const STEM_LENGTHS = [35, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130];

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function roundTo(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

async function main() {
  console.log("Clearing database...");
  await prisma.changeRequest.deleteMany();
  await prisma.qualityIssue.deleteMany();
  await prisma.lotCost.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.salesSheetCost.deleteMany();
  await prisma.lot.deleteMany();
  await prisma.salesSheet.deleteMany();
  await prisma.document.deleteMany();
  await prisma.certificate.deleteMany();
  await prisma.user.deleteMany();
  await prisma.grower.deleteMany();

  console.log("Creating admin and commercie users...");
  const adminPasswordHash = await hash("Colori2026!", 12);
  const commerciePasswordHash = await hash("FloraDesk#24", 12);

  const adminUser = await prisma.user.create({
    data: {
      email: "admin@coloriginz.com",
      passwordHash: adminPasswordHash,
      name: "Admin User",
      role: "admin",
      isActive: true,
    },
  });

  const commercieUser1 = await prisma.user.create({
    data: {
      email: "iris.inkoper@coloriginz.com",
      passwordHash: commerciePasswordHash,
      name: "Iris Inkoper",
      role: "commercie",
      isActive: true,
    },
  });

  const commercieUser2 = await prisma.user.create({
    data: {
      email: "jan.smit@coloriginz.com",
      passwordHash: commerciePasswordHash,
      name: "Jan Smit",
      role: "commercie",
      isActive: true,
    },
  });

  const commercieUsers = [commercieUser1, commercieUser2];

  console.log("Creating 20 growers with data...");
  const growerPasswordHash = await hash("GreenField99", 12);

  for (let i = 0; i < GROWERS.length; i++) {
    const growerData = GROWERS[i];
    const commercie = pick(commercieUsers);

    // Create grower
    const grower = await prisma.grower.create({
      data: {
        code: growerData.code,
        name: growerData.name,
        company: growerData.company,
        street: growerData.street,
        city: growerData.city,
        postalCode: growerData.postalCode,
        country: growerData.country,
        vatNumber: growerData.vatNumber || null,
        ggn: growerData.ggn || null,
        commercieId: commercie.id,
      },
    });

    // Create user account for grower
    await prisma.user.create({
      data: {
        email: `${growerData.code.toLowerCase()}@example.com`,
        passwordHash: growerPasswordHash,
        name: growerData.name,
        role: "grower",
        isActive: true,
        growerId: grower.id,
      },
    });

    // Create certificates
    const numCerts = rand(1, 2);
    const certTypes = pickN(CERTIFICATE_TYPES, numCerts);
    for (const certType of certTypes) {
      await prisma.certificate.create({
        data: {
          growerId: grower.id,
          type: certType.type,
          number: `${certType.prefix}${rand(1000000, 9999999)}`,
          validFrom: new Date(2024, 0, 1),
          validUntil: new Date(2027, 11, 31),
        },
      });
    }

    // Pick 2-4 article groups for this grower
    const growerArticleGroups = pickN(ARTICLE_GROUPS, rand(2, 4));

    // Generate lots spanning 2025 and 2026
    const now = new Date(2026, 2, 15); // March 15, 2026
    const startDate = new Date(2024, 0, 1); // Jan 1, 2024 — for year-over-year comparison

    // Create 16-35 salessheets per grower (more to cover 26 months)
    const numSalesSheets = rand(16, 35);
    let lotCounter = 3880000 + i * 1000;
    let invoiceCounter = 397000 + i * 100;

    for (let ss = 0; ss < numSalesSheets; ss++) {
      const deliveryDate = randomDate(startDate, now);
      const invoiceDate = new Date(deliveryDate);
      invoiceDate.setDate(invoiceDate.getDate() + rand(7, 14));

      // 3-8 lots per salessheet
      const numLots = rand(3, 8);
      let totalTurnover = 0;
      let totalCosts = 0;

      const salesSheet = await prisma.salesSheet.create({
        data: {
          invoiceNumber: String(invoiceCounter++),
          growerId: grower.id,
          invoiceDate,
          deliveryDate,
          flightContainer: String(rand(50, 99)),
          totalTurnover: 0,
          totalCosts: 0,
          netResult: 0,
        },
      });

      for (let l = 0; l < numLots; l++) {
        const articleGroup = pick(growerArticleGroups);
        const productName = pick(PRODUCTS[articleGroup]);
        const stemLength = pick(STEM_LENGTHS);
        const colli = rand(1, 24);
        const stemsPerColli = rand(30, 150);
        const totalStems = colli * stemsPerColli;
        const lotNum = String(lotCounter++);
        const refNum = lotNum;

        // Determine status based on delivery date
        const daysSinceDelivery = Math.floor((now.getTime() - deliveryDate.getTime()) / 86400000);
        const status = daysSinceDelivery < 2 ? "in_transit" : daysSinceDelivery < 5 ? "selling" : "sold";

        // Generate transactions
        const txData: {
          date: Date; salesType: string; stems: number;
          pricePerStem: number; amount: number;
          qualityCode: string | null; qualityNote: string | null;
          s1: string | null; s2: string | null; s3: string | null;
          isCorrection: boolean; correctionType: string | null;
        }[] = [];

        let stemsRemaining = totalStems;
        const basePrice = roundTo(0.3 + Math.random() * 4, 3);

        // Maybe add a correction first
        if (Math.random() < 0.3) {
          const corrType = pick(CORRECTION_TYPES);
          const corrStems = corrType.includes("more") ? -rand(5, 20) : rand(5, 20);
          txData.push({
            date: new Date(deliveryDate.getTime() + 86400000),
            salesType: "Correction",
            stems: corrStems,
            pricePerStem: 0,
            amount: 0,
            qualityCode: null,
            qualityNote: null,
            s1: null, s2: null, s3: null,
            isCorrection: true,
            correctionType: corrType,
          });
          stemsRemaining += corrStems; // corrections adjust remaining
        }

        // Sell the stems over multiple transactions
        let txDay = 1;
        while (stemsRemaining > 0) {
          const txDate = new Date(deliveryDate.getTime() + txDay * 86400000);
          if (txDate > now) break;

          const batchStems = Math.min(stemsRemaining, rand(20, Math.max(50, Math.floor(stemsRemaining * 0.6))));
          const salesType = pick(SALES_TYPES.slice(0, 3)); // mainly Direct, VBA, VPL
          const priceVariation = 0.7 + Math.random() * 0.6; // 70-130% of base
          const price = roundTo(basePrice * priceVariation, 3);
          const amount = roundTo(batchStems * price, 2);

          // Sometimes add quality code
          let qualityCode = null;
          let qualityNote = null;
          let s1: string | null = null;
          let s2: string | null = null;
          let s3: string | null = null;

          if (Math.random() < 0.15) {
            const qi = pick(QUALITY_CODES);
            qualityCode = qi.code;
            qualityNote = qi.description;
          }

          s1 = String(stemLength);
          s2 = Math.random() < 0.5 ? String(rand(20, 90)) : null;
          s3 = Math.random() < 0.3 ? String(rand(20, 40)) : null;

          txData.push({
            date: txDate,
            salesType,
            stems: batchStems,
            pricePerStem: price,
            amount,
            qualityCode,
            qualityNote,
            s1, s2, s3,
            isCorrection: false,
            correctionType: null,
          });

          stemsRemaining -= batchStems;
          txDay += rand(0, 2);
        }

        // Calculate lot totals
        const soldTx = txData.filter((t) => !t.isCorrection);
        const lotTotalAmount = soldTx.reduce((s, t) => s + t.amount, 0);
        const lotTotalStems = soldTx.reduce((s, t) => s + t.stems, 0);
        const lotAvgPrice = lotTotalStems > 0 ? lotTotalAmount / lotTotalStems : 0;

        const lot = await prisma.lot.create({
          data: {
            lotNumber: lotNum,
            refNumber: refNum,
            growerId: grower.id,
            salesSheetId: salesSheet.id,
            productCode: growerData.code,
            productName,
            articleGroup,
            colli,
            stemLength,
            totalStems: lotTotalStems,
            avgPrice: roundTo(lotAvgPrice, 4),
            totalAmount: roundTo(lotTotalAmount, 2),
            containerType: pick(["Box", "Bucket"]),
            deliveryDate,
            status,
          },
        });

        // Create transactions
        for (const tx of txData) {
          await prisma.transaction.create({
            data: {
              lotId: lot.id,
              date: tx.date,
              salesType: tx.salesType,
              stems: tx.stems,
              pricePerStem: tx.pricePerStem,
              amount: tx.amount,
              qualityCode: tx.qualityCode,
              qualityNote: tx.qualityNote,
              s1: tx.s1,
              s2: tx.s2,
              s3: tx.s3,
              isCorrection: tx.isCorrection,
              correctionType: tx.correctionType,
            },
          });
        }

        // Create lot costs (3-8 cost types)
        const numCosts = rand(3, 8);
        const costTypes = pickN(COST_TYPES, numCosts);
        let lotCostTotal = 0;
        for (const costType of costTypes) {
          const costAmount = roundTo(lotTotalAmount * (0.01 + Math.random() * 0.05), 2);
          lotCostTotal += costAmount;
          await prisma.lotCost.create({
            data: {
              lotId: lot.id,
              description: costType,
              amount: costAmount,
            },
          });
        }

        totalTurnover += lotTotalAmount;
        totalCosts += lotCostTotal;

        // Quality issues (from transactions with quality codes)
        const qualityTx = txData.filter((t) => t.qualityCode);
        for (const qt of qualityTx) {
          await prisma.qualityIssue.create({
            data: {
              growerId: grower.id,
              lotId: lot.id,
              code: qt.qualityCode!,
              description: qt.qualityNote!,
              stems: qt.stems,
              date: qt.date,
            },
          });
        }
      }

      // Update salessheet totals
      await prisma.salesSheet.update({
        where: { id: salesSheet.id },
        data: {
          totalTurnover: roundTo(totalTurnover, 2),
          totalCosts: roundTo(totalCosts, 2),
          netResult: roundTo(totalTurnover - totalCosts, 2),
        },
      });

      // Create consolidated costs on salessheet
      const allLotCosts = await prisma.lotCost.findMany({
        where: { lot: { salesSheetId: salesSheet.id } },
      });
      const costMap = new Map<string, number>();
      for (const lc of allLotCosts) {
        costMap.set(lc.description, (costMap.get(lc.description) || 0) + Number(lc.amount));
      }
      for (const [desc, amount] of costMap) {
        await prisma.salesSheetCost.create({
          data: {
            salesSheetId: salesSheet.id,
            description: desc,
            amount: roundTo(amount, 2),
          },
        });
      }
    }

    console.log(`  Created grower ${growerData.code} (${growerData.name})`);
  }

  // ─── SEED SHIPMENT FORECASTS ─────────────────────────────
  console.log("Creating shipment forecasts...");
  await prisma.shipmentForecast.deleteMany();

  const allGrowers = await prisma.grower.findMany({ select: { id: true } });
  const currentWeekNow = getISOWeek(new Date(2026, 2, 15));
  let forecastCount = 0;

  for (const grower of allGrowers) {
    // Each grower forecasts 2-4 products
    const growerGroups = pickN(ARTICLE_GROUPS, rand(2, 4));
    for (const group of growerGroups) {
      const productName = pick(PRODUCTS[group]);
      // Forecast from current week to ~12 weeks ahead
      for (let w = currentWeekNow; w <= currentWeekNow + rand(8, 14); w++) {
        const actualWeek = w > 52 ? w - 52 : w;
        const actualYear = w > 52 ? 2027 : 2026;
        const stems = rand(2, 30) * 100; // 200-3000 stems
        await prisma.shipmentForecast.create({
          data: {
            growerId: grower.id,
            productName,
            articleGroup: group,
            year: actualYear,
            week: actualWeek,
            stems,
            trolleys: Math.ceil(stems / 600),
            colli: Math.ceil(stems / 120),
          },
        });
        forecastCount++;
      }
    }
  }

  // Summary
  const growerCount = await prisma.grower.count();
  const userCount = await prisma.user.count();
  const lotCount = await prisma.lot.count();
  const txCount = await prisma.transaction.count();
  const ssCount = await prisma.salesSheet.count();

  console.log(`\nSeed complete!`);
  console.log(`  ${growerCount} growers`);
  console.log(`  ${userCount} users`);
  console.log(`  ${ssCount} sales sheets`);
  console.log(`  ${lotCount} lots`);
  console.log(`  ${txCount} transactions`);
  console.log(`  ${forecastCount} forecasts`);
  console.log(`\nLogin credentials:`);
  console.log(`  Admin: admin@coloriginz.com / Colori2026!`);
  console.log(`  Commercie: iris.inkoper@coloriginz.com / FloraDesk#24`);
  console.log(`  Grower (example): pcfup@example.com / GreenField99`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
