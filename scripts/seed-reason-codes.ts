/**
 * Seed CorrectionReasonCode table from reason codes CSV.
 *
 * Usage: npx tsx scripts/seed-reason-codes.ts
 */

import { createReadStream } from "fs";
import { parse } from "csv-parse";
import path from "path";

const CSV_PATH = path.resolve(__dirname, "../private_input/PBI/reason codes.csv");

// Use dynamic import for Prisma (ESM compat)
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

    const data = {
      code: row["Reden Code"]?.trim() || "",
      nameNl: row["Reden Naam"]?.trim() || "",
      typeCode: row["Redentype Code"]?.trim() || "",
      typeNameNl: row["Redentype Naam"]?.trim() || "",
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
