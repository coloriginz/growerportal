/*
 * Stap 11: waar komt het kostenverschil vandaan?
 *
 * Alleen de percentageregels (shkost.type = 'VE') wijken af. Voor die regels
 * rekenen we terug: welk bedrag zou de grondslag moeten zijn om op het PDF-bedrag
 * uit te komen, en welk bedrag hoort bij het portalbedrag? Dat verschil vergelijken
 * we met de omzetcomponenten van de salessheet.
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

const pdfByHdr = new Map(pdfData.map((p) => [String(p.parthdr_id), p]));
const shByHdr = new Map();
for (const r of bron["6"]) {
  const id = String(r.parthdr_id);
  if (!shByHdr.has(id)) shByHdr.set(id, []);
  shByHdr.get(id).push(r);
}

// kost_id -> (PDF-omschrijving, portal-omschrijving)
const CASES = [
  { kost_id: "156", pdf: "Transaction levy", portal: "Transactie heffing" },
  { kost_id: "17", pdf: "Commission direct sales", portal: "Commissie directe verkoop" },
  { kost_id: "166", pdf: "Financing and debtors insurance", portal: "Finance en debiteuren verzekering" },
];

async function main() {
  const ids = schoon.map((s) => String(s.parthdr));
  const rows = await sql`
    SELECT s."fabricParthdrId" AS parthdr, c.description, c.amount
    FROM   "SalesSheetCost" c
    JOIN   "SalesSheet" s ON s.id = c."salesSheetId"
    WHERE  s."fabricParthdrId" = ANY(${ids})
  `;
  const portalByHdr = new Map();
  for (const r of rows) {
    const id = String(r.parthdr);
    if (!portalByHdr.has(id)) portalByHdr.set(id, new Map());
    portalByHdr.get(id).set((r.description || "").trim(), n(r.amount));
  }

  for (const c of CASES) {
    console.log(`\n========== ${c.pdf} (kost_id ${c.kost_id}) ==========\n`);
    const rijen = [];
    for (const s of schoon) {
      const id = String(s.parthdr);
      const pdf = pdfByHdr.get(id);
      if (!pdf) continue;
      const pdfBedrag = (pdf.kostregels || []).filter((k) => k.omschrijving.trim() === c.pdf).reduce((a, k) => a + n(k.bedrag), 0);
      const portalBedrag = portalByHdr.get(id)?.get(c.portal);
      if (portalBedrag === undefined) continue;
      const tarief = n(shByHdr.get(id)?.find((k) => String(k.kost_id) === c.kost_id)?.bedrag);
      if (!tarief) continue;
      const d = +(portalBedrag - pdfBedrag).toFixed(2);
      rijen.push({
        lev: s.lev,
        parthdr: s.parthdr,
        tarief,
        pdf: +pdfBedrag.toFixed(2),
        portal: +portalBedrag.toFixed(2),
        d,
        grondslag_pdf: +((pdfBedrag / tarief) * 100).toFixed(2),
        grondslag_portal: +((portalBedrag / tarief) * 100).toFixed(2),
        d_grondslag: +(((portalBedrag - pdfBedrag) / tarief) * 100).toFixed(2),
        pdf_direct: n(s.pdf_direct),
        pdf_veiling: n(s.pdf_veiling),
        pdf_productie: n(s.pdf_productie),
        pdf_omzet: n(s.pdf_omzet),
        portal_omzet: n(s.portal_omzet),
        d_omzet: +(n(s.portal_omzet) - n(s.pdf_omzet)).toFixed(2),
      });
    }
    const afw = rijen.filter((r) => Math.abs(r.d) >= 1);
    console.log(`${rijen.length} salessheets met deze kostenregel, ${afw.length} met verschil >= EUR 1`);
    console.log(`totaal PDF ${eur(rijen.reduce((a, r) => a + r.pdf, 0))} | portal ${eur(rijen.reduce((a, r) => a + r.portal, 0))}`);

    // Verklaart het verschil in grondslag zich uit een omzetcomponent?
    let verklaardProd = 0;
    let verklaardOmzet = 0;
    for (const r of afw) {
      if (r.pdf_productie && Math.abs(r.d_grondslag + r.pdf_productie) < 5) verklaardProd++;
      if (Math.abs(r.d_grondslag - r.d_omzet) < 5) verklaardOmzet++;
    }
    console.log(`  grondslagverschil = -productieomzet : ${verklaardProd}/${afw.length}`);
    console.log(`  grondslagverschil = omzetverschil   : ${verklaardOmzet}/${afw.length}`);

    console.log("\nlev      | parthdr  | tarief | PDF       | portal    | verschil  | grondslag PDF | grondslag portal | d grondslag | productie | direct    | veiling");
    for (const r of afw.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 12)) {
      console.log(
        `${r.lev.padEnd(8)} | ${String(r.parthdr).padStart(8)} | ${String(r.tarief).padStart(6)} | ${eur(r.pdf).padStart(9)} | ` +
          `${eur(r.portal).padStart(9)} | ${eur(r.d).padStart(9)} | ${eur(r.grondslag_pdf).padStart(13)} | ${eur(r.grondslag_portal).padStart(16)} | ` +
          `${eur(r.d_grondslag).padStart(11)} | ${eur(r.pdf_productie).padStart(9)} | ${eur(r.pdf_direct).padStart(9)} | ${eur(r.pdf_veiling).padStart(9)}`
      );
    }
  }
}

main().catch((e) => {
  console.error("FOUT: " + e.message);
  process.exit(1);
});
