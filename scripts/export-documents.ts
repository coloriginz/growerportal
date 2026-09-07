/*
 * Zet de documentenlijst van één portal veilig, vóór een herbouw van de data.
 *
 * Waarom dit nodig is: de blobopslag bevat bestanden die nergens anders meer
 * staan. Gemeten op 7 september 2026 hangen op productie 415 documenten aan
 * 364 afrekeningen, en van die bestanden staat het merendeel niet in
 * `private_input/salessheets` — ze zijn per e-mail binnengekomen en meteen naar
 * de blobopslag geschreven. De `Document`-rij is daarmee de enige plek waar
 * staat wélk bestand het is. Wordt die rij weggegooid, dan staat het bestand er
 * nog wel, maar is niet meer te zien bij welke levering het hoorde.
 *
 * Een herbouw raakt `Document` niet vanzelf: de verwijzing loopt van de
 * afrekening naar het document, dus het weggooien van `SalesSheet` laat de
 * documenten staan. Dit script is de verzekering voor het geval er tóch iets
 * doorheen gaat — en met `--download` haalt het de bestanden zelf ook naar het
 * lokale archief, zodat `link-salessheet-pdfs.ts` ze na de herbouw opnieuw kan
 * aanbieden.
 *
 * Alleen lezen; dit script schrijft niets naar de database.
 *
 * Draaien:
 *   npx tsx scripts/export-documents.ts --env=production
 *   npx tsx scripts/export-documents.ts --env=production --download=private_input/salessheets-blob
 *
 * Opties:
 *   --env=test|production   welke portal. Verplicht — er is geen standaard, want een
 *                           export van de verkeerde omgeving ziet er precies hetzelfde uit.
 *   --download=PAD          haal ook de bestanden zelf op naar deze map (recursief
 *                           doorzoekbaar door de koppelscripts). Traag: één verzoek per bestand.
 *   --out=PAD               schrijf het JSON-bestand hierheen.
 */
import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

const args = process.argv.slice(2);
function optie(naam: string): string | null {
  const arg = args.find((a) => a.startsWith(`--${naam}=`));
  return arg ? arg.slice(naam.length + 3) : null;
}

const env = optie("env");
if (env !== "test" && env !== "production") {
  console.error("Geef expliciet op welke portal: --env=test of --env=production");
  process.exit(1);
}

const envBestand = env === "production" ? ".env.production" : ".env";
const config = dotenv.parse(fs.readFileSync(envBestand));
const url = config.DIRECT_URL || config.DATABASE_URL;
if (!url) {
  console.error(`${envBestand} bevat geen DIRECT_URL of DATABASE_URL`);
  process.exit(1);
}
const sql = neon(url);

const stempel = new Date().toISOString().slice(0, 10);
const uitvoer = optie("out") || `private_input/document-export-${env}-${stempel}.json`;
const downloadMap = optie("download");

type Rij = {
  id: string;
  supplierId: string;
  supplierCode: string | null;
  type: string;
  name: string;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  createdAt: string;
  salesSheetId: string | null;
  invoiceNumber: string | null;
  ourInvoiceNumber: string | null;
  deliveryDate: string | null;
};

async function main() {
  console.log(`Portal:   ${env} (${new URL(url!).hostname})`);

  const rijen = (await sql.query(`
    select d.id, d."supplierId", s.code as "supplierCode", d.type, d.name,
           d."fileName", d."fileUrl", d."fileSize", d."createdAt"::text as "createdAt",
           ss.id as "salesSheetId", ss."invoiceNumber", ss."ourInvoiceNumber",
           ss."deliveryDate"::text as "deliveryDate"
      from "Document" d
      left join "Supplier" s on s.id = d."supplierId"
      left join "SalesSheet" ss on ss."pdfDocumentId" = d.id
     order by d."createdAt", d.id
  `)) as Rij[];

  const gekoppeld = rijen.filter((r) => r.salesSheetId).length;
  const perType = new Map<string, number>();
  for (const r of rijen) perType.set(r.type, (perType.get(r.type) ?? 0) + 1);

  fs.mkdirSync(path.dirname(uitvoer), { recursive: true });
  fs.writeFileSync(
    uitvoer,
    JSON.stringify({ portal: env, exportedAt: new Date().toISOString(), documents: rijen }, null, 2)
  );

  console.log(`Documenten: ${rijen.length} (${gekoppeld} aan een afrekening, ${rijen.length - gekoppeld} los)`);
  for (const [type, n] of [...perType].sort((a, b) => b[1] - a[1])) console.log(`  ${type.padEnd(14)} ${n}`);
  console.log(`Geschreven: ${uitvoer}`);

  if (!downloadMap) {
    console.log("\nGeen --download opgegeven: alleen de lijst is veiliggesteld, niet de bestanden.");
    return;
  }

  /*
   * De bestandsnaam moet exact blijven: de koppelroute leest de leverancierscode
   * en het afrekeningsnummer eruit. Een tweede bestand met dezelfde naam gaat
   * daarom in een genummerde submap in plaats van hernoemd te worden — de
   * koppelscripts lopen de map toch recursief af.
   */
  fs.mkdirSync(downloadMap, { recursive: true });
  const gezien = new Set<string>();
  let gehaald = 0, overgeslagen = 0, mislukt = 0;

  for (const r of rijen) {
    let doel = path.join(downloadMap, r.fileName);
    if (gezien.has(doel.toLowerCase())) {
      let n = 2;
      while (gezien.has(path.join(downloadMap, String(n), r.fileName).toLowerCase())) n++;
      fs.mkdirSync(path.join(downloadMap, String(n)), { recursive: true });
      doel = path.join(downloadMap, String(n), r.fileName);
    }
    gezien.add(doel.toLowerCase());

    if (fs.existsSync(doel)) { overgeslagen++; continue; }
    try {
      const res = await fetch(r.fileUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(doel, Buffer.from(await res.arrayBuffer()));
      gehaald++;
      if (gehaald % 100 === 0) console.log(`  ${gehaald} opgehaald…`);
    } catch (fout) {
      mislukt++;
      console.error(`  MISLUKT ${r.fileName}: ${fout instanceof Error ? fout.message : String(fout)}`);
    }
  }
  console.log(`Bestanden: ${gehaald} opgehaald, ${overgeslagen} stonden er al, ${mislukt} mislukt -> ${downloadMap}`);
}

main().catch((fout) => {
  console.error(fout);
  process.exit(1);
});
