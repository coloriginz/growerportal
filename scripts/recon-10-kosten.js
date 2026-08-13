/*
 * Stap 10: kostenreconciliatie — PDF tegenover portal tegenover shkost.
 *
 * Beantwoordt drie vragen:
 *   1. Op welke salessheets wijken de kosten in de portal af van de PDF?
 *   2. Welke kostensoorten veroorzaken dat verschil?
 *   3. Ligt het aan de import (portal != shkost) of aan shkost zelf
 *      (percentageregels die nog met een grondslag vermenigvuldigd moeten worden)?
 *
 * Gebruik: node scripts/recon-10-kosten.js [--out private_input/recon-kosten.json]
 */
const fs = require("fs");
const { neon } = require("@neondatabase/serverless");
require("dotenv").config();

const sql = neon(process.env.DATABASE_URL);
const n = (x) => (x === null || x === undefined ? 0 : Number(x));
const eur = (x) => (x < 0 ? "-" : "") + Math.abs(x).toFixed(2).replace(".", ",");

const schoon = JSON.parse(fs.readFileSync("private_input/recon-schoon.json", "utf8"));
const pdfData = JSON.parse(fs.readFileSync("private_input/recon-pdf-data.json", "utf8"));
const bron = JSON.parse(fs.readFileSync("private_input/recon-bron.json", "utf8"));
const shkost = bron["6"];
const kostLookup = new Map(bron["8"].map((k) => [String(k.kost_id), k]));

const pdfPerHdr = new Map(pdfData.map((p) => [String(p.parthdr_id), p]));

// shkost per parthdr, gesplitst in bedragen (type IN/UIT) en percentages
const shPerHdr = new Map();
for (const k of shkost) {
  const id = String(k.parthdr_id);
  if (!shPerHdr.has(id)) shPerHdr.set(id, []);
  shPerHdr.get(id).push(k);
}

async function main() {
  const ids = schoon.map((s) => String(s.parthdr));

  // portal-kostenregels ophalen
  const rows = await sql`
    SELECT s."fabricParthdrId" AS parthdr, c.description, c.amount, c."costTypeCode"
    FROM   "SalesSheetCost" c
    JOIN   "SalesSheet" s ON s.id = c."salesSheetId"
    WHERE  s."fabricParthdrId" = ANY(${ids})
  `;
  const portalPerHdr = new Map();
  for (const r of rows) {
    const id = String(r.parthdr);
    if (!portalPerHdr.has(id)) portalPerHdr.set(id, []);
    portalPerHdr.get(id).push(r);
  }

  const regels = [];
  for (const s of schoon) {
    const id = String(s.parthdr);
    const pdf = pdfPerHdr.get(id);
    const portalRegels = portalPerHdr.get(id) || [];
    const shRegels = shPerHdr.get(id) || [];

    const portalKosten = portalRegels.reduce((a, r) => a + n(r.amount), 0);
    const shSom = shRegels.reduce((a, r) => a + n(r.bedrag), 0);
    // heuristiek: een regel < 25 met grondslag_id != 1 ruikt naar een percentage
    const shGroot = shRegels.filter((r) => n(r.bedrag) >= 25).reduce((a, r) => a + n(r.bedrag), 0);

    regels.push({
      lev: s.lev,
      parthdr: s.parthdr,
      factnum: s.factnum,
      leverdatum: s.leverdatum,
      pdf_kosten: n(s.pdf_kosten),
      portal_kosten_werklijst: n(s.portal_kosten),
      portal_kosten_regels: +portalKosten.toFixed(2),
      portal_regels: portalRegels.length,
      pdf_regels: pdf ? (pdf.kostregels || []).length : 0,
      shkost_regels: shRegels.length,
      shkost_som: +shSom.toFixed(2),
      shkost_som_groot: +shGroot.toFixed(2),
      d_portal_pdf: +(portalKosten - n(s.pdf_kosten)).toFixed(2),
      d_shkost_pdf: +(shSom - n(s.pdf_kosten)).toFixed(2),
      d_portal_shkost: +(portalKosten - shSom).toFixed(2),
    });
  }

  // ---------- 1. totalen ----------
  const perLev = {};
  for (const r of regels) {
    const l = (perLev[r.lev] ||= { n: 0, pdf: 0, portal: 0, shkost: 0, exact: 0, tol5: 0, tol50: 0 });
    l.n++;
    l.pdf += r.pdf_kosten;
    l.portal += r.portal_kosten_regels;
    l.shkost += r.shkost_som;
    const d = Math.abs(r.d_portal_pdf);
    if (d < 0.5) l.exact++;
    if (d < 5) l.tol5++;
    if (d < 50) l.tol50++;
  }

  console.log("\n=== 1. Kosten per leverancier (234 salessheets met geverifieerde PDF) ===\n");
  console.log("lev      | n   | PDF          | portal       | shkost rauw  | verschil     | exact | <5  | <50");
  for (const [lev, l] of Object.entries(perLev)) {
    console.log(
      `${lev.padEnd(8)} | ${String(l.n).padStart(3)} | ${eur(l.pdf).padStart(12)} | ${eur(l.portal).padStart(12)} | ` +
        `${eur(l.shkost).padStart(12)} | ${eur(l.portal - l.pdf).padStart(12)} | ${String(l.exact).padStart(5)} | ` +
        `${String(l.tol5).padStart(3)} | ${String(l.tol50).padStart(3)}`
    );
  }

  // ---------- 2. grootste afwijkers ----------
  const afwijkend = regels.filter((r) => Math.abs(r.d_portal_pdf) >= 5).sort((a, b) => Math.abs(b.d_portal_pdf) - Math.abs(a.d_portal_pdf));
  console.log(`\n=== 2. Salessheets met kostenverschil >= EUR 5: ${afwijkend.length} van ${regels.length} ===\n`);
  console.log("lev      | parthdr  | fact | leverdatum | PDF        | portal     | verschil   | regels PDF/portal/shkost");
  for (const r of afwijkend.slice(0, 30)) {
    console.log(
      `${r.lev.padEnd(8)} | ${String(r.parthdr).padStart(8)} | ${String(r.factnum).padStart(4)} | ${r.leverdatum} | ` +
        `${eur(r.pdf_kosten).padStart(10)} | ${eur(r.portal_kosten_regels).padStart(10)} | ${eur(r.d_portal_pdf).padStart(10)} | ` +
        `${r.pdf_regels}/${r.portal_regels}/${r.shkost_regels}`
    );
  }
  if (afwijkend.length > 30) console.log(`... (${afwijkend.length - 30} meer)`);

  // ---------- 3. per kostensoort ----------
  /*
   * De PDF is Engels, de portal Nederlands. Onderstaande tabel koppelt beide.
   * Twee gevallen zijn 1-op-n: de PDF vat "Container rental" en "Clearing & Logistics"
   * samen wat in KBT twee aparte kostensoorten zijn.
   */
  const KOPPEL = {
    "Handling charges": "Verwerkingskosten",
    "Commission direct sales": "Commissie directe verkoop",
    "Commission auction": "Veilingprovisie",
    "Commission auction sales": "Commissie veilingverkoop",
    "Distribution Costs": "Distributiekosten",
    "Transaction levy": "Transactie heffing",
    "Trolley levy": "Karheffing",
    "Lot levy": "Partijheffing",
    "Financing and debtors insurance": "Finance en debiteuren verzekering",
    "Customers Clearing": "Inklaren / aangifte",
    "Clearing & Logistics Surcharge Airport": "Afhandelingskosten afhandelaar - variabel tarief",
    "Additional handling charges": "Verwerkingskosten extra",
    "Admin./Price information": "Prijsinformatie en Admin. kosten",
    "Handling charges Coloriginz": "Verwerkingskosten Coloriginz",
    "Freight costs Holland": "Vrachtkosten Nederland",
    "Others": "Diversen",
    "Transport costs": "Transportkosten",
    "Documents": "Documenten",
    "Service charge + BBH levy": "Service charge + BBH levy",
    "Waste tax": "Waste tax",
    "Additional Declaration": "Additional Declaration",
    "Import duties": "Invoerrechten",
    "Container rental": ["Fusthuur Directe Verkopen", "Fusthuur Aanvoer Orders"],
    "Clearing & Logistics": ["Afhandelingskst. lokatie vertrek", "Afhandelingskst. lokatie aankomst"],
  };
  const nlNaarEn = new Map();
  for (const [en, nl] of Object.entries(KOPPEL)) for (const x of [].concat(nl)) nlNaarEn.set(x, en);

  const perSoort = new Map();
  const soortAfwijkingen = [];
  for (const s of schoon) {
    const id = String(s.parthdr);
    const pdf = pdfPerHdr.get(id);
    if (!pdf) continue;
    const pdfSoort = new Map();
    const portalSoort = new Map();
    for (const k of pdf.kostregels || []) {
      const naam = k.omschrijving.trim();
      pdfSoort.set(naam, (pdfSoort.get(naam) || 0) + n(k.bedrag));
    }
    for (const r of portalPerHdr.get(id) || []) {
      const nl = (r.description || "?").trim();
      const naam = nlNaarEn.get(nl) || `?? ${nl}`;
      portalSoort.set(naam, (portalSoort.get(naam) || 0) + n(r.amount));
    }
    for (const naam of new Set([...pdfSoort.keys(), ...portalSoort.keys()])) {
      const p = pdfSoort.get(naam) || 0;
      const q = portalSoort.get(naam) || 0;
      const e = perSoort.get(naam) || { naam, pdf: 0, portal: 0, pdf_n: 0, portal_n: 0, mist_portal: 0, mist_pdf: 0, afw: 0 };
      e.pdf += p;
      e.portal += q;
      if (pdfSoort.has(naam)) e.pdf_n++;
      if (portalSoort.has(naam)) e.portal_n++;
      if (!portalSoort.has(naam)) e.mist_portal++;
      if (!pdfSoort.has(naam)) e.mist_pdf++;
      if (Math.abs(q - p) >= 1) {
        e.afw++;
        soortAfwijkingen.push({ lev: s.lev, parthdr: s.parthdr, factnum: s.factnum, soort: naam, pdf: +p.toFixed(2), portal: +q.toFixed(2), d: +(q - p).toFixed(2) });
      }
      perSoort.set(naam, e);
    }
  }
  const soorten = [...perSoort.values()].sort((a, b) => Math.abs(b.portal - b.pdf) - Math.abs(a.portal - a.pdf));
  console.log("\n=== 3. Per kostensoort, PDF gekoppeld aan de portal-omschrijving ===\n");
  console.log("kostensoort (PDF)                     | PDF          | portal       | verschil     | n PDF/portal | alleen PDF | alleen portal | regels >= EUR 1 afw.");
  for (const s of soorten) {
    console.log(
      `${s.naam.slice(0, 37).padEnd(37)} | ${eur(s.pdf).padStart(12)} | ${eur(s.portal).padStart(12)} | ` +
        `${eur(s.portal - s.pdf).padStart(12)} | ${String(s.pdf_n).padStart(5)}/${String(s.portal_n).padEnd(6)} | ` +
        `${String(s.mist_portal).padStart(10)} | ${String(s.mist_pdf).padStart(13)} | ${s.afw}`
    );
  }

  console.log(`\n=== 3b. Regelverschillen >= EUR 1: ${soortAfwijkingen.length} ===\n`);
  const top = soortAfwijkingen.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 25);
  console.log("lev      | parthdr  | fact           | kostensoort                    | PDF        | portal     | verschil");
  for (const a of top) {
    console.log(
      `${a.lev.padEnd(8)} | ${String(a.parthdr).padStart(8)} | ${String(a.factnum).slice(0, 14).padEnd(14)} | ` +
        `${a.soort.slice(0, 30).padEnd(30)} | ${eur(a.pdf).padStart(10)} | ${eur(a.portal).padStart(10)} | ${eur(a.d).padStart(10)}`
    );
  }

  // ---------- 4. shkost: bedrag of percentage ----------
  console.log("\n=== 4. shkost per kostensoort: staat er een bedrag of een percentage? ===\n");
  const perKost = new Map();
  for (const k of shkost) {
    const e = perKost.get(String(k.kost_id)) || { n: 0, som: 0, min: Infinity, max: -Infinity, grondslagen: new Set(), types: new Set() };
    e.n++;
    e.som += n(k.bedrag);
    e.min = Math.min(e.min, n(k.bedrag));
    e.max = Math.max(e.max, n(k.bedrag));
    e.grondslagen.add(String(k.grondslag_id));
    e.types.add(String(k.type));
    perKost.set(String(k.kost_id), e);
  }
  console.log("kost_id | kode     | omschrijving                   |    n | gemiddeld |   min |     max | grondslag | type");
  for (const [id, e] of [...perKost.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const l = kostLookup.get(id) || {};
    console.log(
      `${id.padStart(7)} | ${String(l.kode || "?").padEnd(8)} | ${String(l.oms || "?").slice(0, 30).padEnd(30)} | ` +
        `${String(e.n).padStart(4)} | ${(e.som / e.n).toFixed(2).padStart(9)} | ${e.min.toFixed(2).padStart(5)} | ` +
        `${e.max.toFixed(2).padStart(7)} | ${[...e.grondslagen].join(",").padEnd(9)} | ${[...e.types].join(",")}`
    );
  }

  const outIdx = process.argv.indexOf("--out");
  if (outIdx > -1) {
    fs.writeFileSync(process.argv[outIdx + 1], JSON.stringify({ regels, soorten }, null, 1), "utf8");
    console.log(`\nWeggeschreven naar ${process.argv[outIdx + 1]}`);
  }
}

main().catch((e) => {
  console.error("FOUT: " + e.message);
  process.exit(1);
});
