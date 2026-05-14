/**
 * Seed CorrectionReasonCode table from reason codes CSV + English translations.
 *
 * Usage: npx tsx scripts/seed-reason-codes.ts
 */

import { createReadStream } from "fs";
import { parse } from "csv-parse";
import path from "path";

const CSV_PATH = path.resolve(__dirname, "../private_input/PBI/reason codes.csv");

// English translations for all reason codes (keyed by reden_id)
const EN_TRANSLATIONS: Record<number, { nameEn: string; typeNameEn: string }> = {
  // VRD - Voorraad correctie reden → Stock correction reason
  1:   { nameEn: "No Reason", typeNameEn: "Stock correction reason" },
  24:  { nameEn: "Corr: Poor flower", typeNameEn: "Stock correction reason" },
  25:  { nameEn: "Buyback from customer", typeNameEn: "Stock correction reason" },
  27:  { nameEn: "Corr: External transport damage", typeNameEn: "Stock correction reason" },
  28:  { nameEn: "PD rejected", typeNameEn: "Stock correction reason" },
  30:  { nameEn: "Corr: Poor leaf", typeNameEn: "Stock correction reason" },
  31:  { nameEn: "Corr: Poor stem", typeNameEn: "Stock correction reason" },
  32:  { nameEn: "Beginning stock correction", typeNameEn: "Stock correction reason" },
  33:  { nameEn: "Brown due to heat buildup", typeNameEn: "Stock correction reason" },
  36:  { nameEn: "Return: quality problem", typeNameEn: "Stock correction reason" },
  37:  { nameEn: "Correction delivered quantity", typeNameEn: "Stock correction reason" },
  38:  { nameEn: "Input error OZI", typeNameEn: "Stock correction reason" },
  39:  { nameEn: "Return: delivered too late", typeNameEn: "Stock correction reason" },
  40:  { nameEn: "Return: poor flower", typeNameEn: "Stock correction reason" },
  41:  { nameEn: "Return: poor leaf", typeNameEn: "Stock correction reason" },
  42:  { nameEn: "Promotion", typeNameEn: "Stock correction reason" },
  43:  { nameEn: "Return: internal error", typeNameEn: "Stock correction reason" },
  44:  { nameEn: "Return: poor branch", typeNameEn: "Stock correction reason" },
  58:  { nameEn: "Mold in flower/product", typeNameEn: "Stock correction reason" },
  59:  { nameEn: "Corr: Breakage damage / broken heads", typeNameEn: "Stock correction reason" },
  60:  { nameEn: "Fust correction stock", typeNameEn: "Stock correction reason" },
  87:  { nameEn: "Return: flower too ripe", typeNameEn: "Stock correction reason" },
  88:  { nameEn: "Return: flower too raw", typeNameEn: "Stock correction reason" },
  89:  { nameEn: "Return: incorrect sorting code", typeNameEn: "Stock correction reason" },
  90:  { nameEn: "Return: wrong variety", typeNameEn: "Stock correction reason" },
  91:  { nameEn: "Return: not ordered", typeNameEn: "Stock correction reason" },
  95:  { nameEn: "Inventory correction shortage", typeNameEn: "Stock correction reason" },
  96:  { nameEn: "Inventory correction surplus", typeNameEn: "Stock correction reason" },
  99:  { nameEn: "Return: rejection by customer", typeNameEn: "Stock correction reason" },
  103: { nameEn: "Not returned, poor quality", typeNameEn: "Stock correction reason" },
  108: { nameEn: "Commercial Correction", typeNameEn: "Stock correction reason" },
  110: { nameEn: "Poor Quality", typeNameEn: "Stock correction reason" },
  113: { nameEn: "Correction from stock scan", typeNameEn: "Stock correction reason" },

  // LEV - Levering correctie reden → Delivery correction reason
  22:  { nameEn: "Processing: too few in box", typeNameEn: "Delivery correction reason" },
  23:  { nameEn: "Processing: too many in box", typeNameEn: "Delivery correction reason" },
  29:  { nameEn: "Processing: quality", typeNameEn: "Delivery correction reason" },
  47:  { nameEn: "Too few delivered", typeNameEn: "Delivery correction reason" },
  48:  { nameEn: "Too many delivered", typeNameEn: "Delivery correction reason" },
  49:  { nameEn: "PD rejected", typeNameEn: "Delivery correction reason" },
  50:  { nameEn: "Poor product quality from supplier", typeNameEn: "Delivery correction reason" },
  51:  { nameEn: "Fust correction", typeNameEn: "Delivery correction reason" },
  94:  { nameEn: "Return to supplier", typeNameEn: "Delivery correction reason" },
  105: { nameEn: "Processing: Paint", typeNameEn: "Delivery correction reason" },
  107: { nameEn: "Processing: different product/length in box", typeNameEn: "Delivery correction reason" },
  109: { nameEn: "Processing: correction to mix", typeNameEn: "Delivery correction reason" },
  111: { nameEn: "Insurance claim", typeNameEn: "Delivery correction reason" },

  // VRK - Verkoop correctie reden → Sales correction reason
  34:  { nameEn: "Price correction", typeNameEn: "Sales correction reason" },
  35:  { nameEn: "Fust correction", typeNameEn: "Sales correction reason" },
  52:  { nameEn: "Return: poor leaf", typeNameEn: "Sales correction reason" },
  53:  { nameEn: "Return: mold in flower", typeNameEn: "Sales correction reason" },
  54:  { nameEn: "Return from customer due to inferior quality", typeNameEn: "Sales correction reason" },
  55:  { nameEn: "Return: delivered too late", typeNameEn: "Sales correction reason" },
  56:  { nameEn: "Not delivered", typeNameEn: "Sales correction reason" },
  57:  { nameEn: "Return: flower too ripe", typeNameEn: "Sales correction reason" },
  61:  { nameEn: "Return: yellow leaf", typeNameEn: "Sales correction reason" },
  62:  { nameEn: "Return: black leaf", typeNameEn: "Sales correction reason" },
  63:  { nameEn: "Too many delivered to customer", typeNameEn: "Sales correction reason" },
  64:  { nameEn: "Lost in internal transport", typeNameEn: "Sales correction reason" },
  65:  { nameEn: "Too few delivered to customer", typeNameEn: "Sales correction reason" },
  66:  { nameEn: "Return: damage during distribution", typeNameEn: "Sales correction reason" },
  67:  { nameEn: "Return: flower too raw", typeNameEn: "Sales correction reason" },
  68:  { nameEn: "Return: flower shriveling", typeNameEn: "Sales correction reason" },
  69:  { nameEn: "Return: empty flower", typeNameEn: "Sales correction reason" },
  70:  { nameEn: "Return: cold damage", typeNameEn: "Sales correction reason" },
  71:  { nameEn: "Return: discolored petal edge", typeNameEn: "Sales correction reason" },
  72:  { nameEn: "Return: Botrytis", typeNameEn: "Sales correction reason" },
  73:  { nameEn: "Return: uneven ripeness", typeNameEn: "Sales correction reason" },
  74:  { nameEn: "Return: thrips damage", typeNameEn: "Sales correction reason" },
  75:  { nameEn: "Return: aphid damage", typeNameEn: "Sales correction reason" },
  76:  { nameEn: "Return: spider mite damage", typeNameEn: "Sales correction reason" },
  77:  { nameEn: "Return: leaf tips", typeNameEn: "Sales correction reason" },
  78:  { nameEn: "Return: crooked branches", typeNameEn: "Sales correction reason" },
  79:  { nameEn: "Return: limp branches", typeNameEn: "Sales correction reason" },
  80:  { nameEn: "Return: incorrect length", typeNameEn: "Sales correction reason" },
  81:  { nameEn: "Return: breakage damage", typeNameEn: "Sales correction reason" },
  82:  { nameEn: "Return: incorrectly bunched", typeNameEn: "Sales correction reason" },
  83:  { nameEn: "Return: wrong variety", typeNameEn: "Sales correction reason" },
  84:  { nameEn: "Return: dried bud", typeNameEn: "Sales correction reason" },
  85:  { nameEn: "Return: discolored bud", typeNameEn: "Sales correction reason" },
  86:  { nameEn: "Return: damaged flowers", typeNameEn: "Sales correction reason" },
  92:  { nameEn: "Not yellow enough", typeNameEn: "Sales correction reason" },
  93:  { nameEn: "Return: buyback from customer", typeNameEn: "Sales correction reason" },
  97:  { nameEn: "Return: order pick error", typeNameEn: "Sales correction reason" },
  98:  { nameEn: "Correction: order pick error", typeNameEn: "Sales correction reason" },
  100: { nameEn: "Return: brown flower", typeNameEn: "Sales correction reason" },
  101: { nameEn: "Return: residue on leaf", typeNameEn: "Sales correction reason" },
  102: { nameEn: "Return: bud too small", typeNameEn: "Sales correction reason" },
  104: { nameEn: "Not returned, customer disposal", typeNameEn: "Sales correction reason" },
  106: { nameEn: "Too many delivered to customer", typeNameEn: "Sales correction reason" },
  112: { nameEn: "Return pick orders", typeNameEn: "Sales correction reason" },

  // RET - Retour reden → Return reason
  114: { nameEn: "Return: Quality", typeNameEn: "Return reason" },
  115: { nameEn: "Return: delivered too late", typeNameEn: "Return reason" },
  116: { nameEn: "Return: too many delivered", typeNameEn: "Return reason" },
  117: { nameEn: "Return: ordered incorrectly", typeNameEn: "Return reason" },
  118: { nameEn: "Too few delivered - adjust distribution rule", typeNameEn: "Return reason" },
  119: { nameEn: "Quality - customer disposal", typeNameEn: "Return reason" },
  120: { nameEn: "Return: delivered incorrectly", typeNameEn: "Return reason" },
};

async function main() {
  const { prisma } = await import("../src/lib/db");

  const rows: Record<string, string>[] = [];
  await new Promise<void>((resolve, reject) => {
    createReadStream(CSV_PATH)
      .pipe(
        parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        })
      )
      .on("data", (row: Record<string, string>) => rows.push(row))
      .on("end", () => resolve())
      .on("error", reject);
  });

  console.log(`Parsed ${rows.length} reason codes from CSV`);

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const id = parseInt(row["reden_id"], 10);
    if (isNaN(id)) continue;

    const en = EN_TRANSLATIONS[id];

    const data = {
      code: row["Reden Code"]?.trim() || "",
      nameNl: row["Reden Naam"]?.trim() || "",
      nameEn: en?.nameEn || null,
      typeCode: row["Redentype Code"]?.trim() || "",
      typeNameNl: row["Redentype Naam"]?.trim() || "",
      typeNameEn: en?.typeNameEn || null,
      active: row["Reden Actief J/N"]?.trim() === "True",
      isClaim: row["Reden Claim J/N"]?.trim() === "True",
    };

    const existing = await prisma.correctionReasonCode.findUnique({ where: { id } });
    if (existing) {
      await prisma.correctionReasonCode.update({ where: { id }, data });
      updated++;
    } else {
      await prisma.correctionReasonCode.create({ data: { id, ...data } });
      created++;
    }
  }

  console.log(`Done: ${created} created, ${updated} updated`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
