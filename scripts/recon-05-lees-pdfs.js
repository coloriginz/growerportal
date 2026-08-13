/*
 * Stap 5: lees van alle gekoppelde salessheets de samenvatting van pagina 1 en de
 * transactieregels van de vervolgpagina's.
 *
 * Pagina 1 bevat de opbouw van het netto resultaat: omzetcategorieen, kostenregels
 * en het bedrag dat de leverancier ontvangt.
 * Vervolgpagina's bevatten per partij de losse transacties.
 */
const fs = require("fs");

const WERK = "private_input/recon-werklijst.json";
const UIT = "private_input/recon-pdf-data.json";

const bedrag = (s) => {
  if (!s) return null;
  const m = String(s).replace(/[€\s]/g, "").match(/-?[\d.]+,\d{2}$|-?[\d.]+$/);
  if (!m) return null;
  return Number(m[0].replace(/\./g, "").replace(",", "."));
};
const getal = (s) => {
  if (s === null || s === undefined || s === "") return null;
  const t = String(s).trim().replace(/\./g, "").replace(",", ".");
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

(async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const werk = JSON.parse(fs.readFileSync(WERK, "utf8")).filter((w) => w.pdf);
  console.log(`${werk.length} salessheets met PDF\n`);

  const uit = [];
  let klaar = 0, fout = 0;

  for (const w of werk) {
    try {
      const doc = await getDocument({
        data: new Uint8Array(fs.readFileSync(w.pdf)), useSystemFonts: true, verbosity: 0,
      }).promise;

      // ---------- pagina 1: samenvatting ----------
      const p1 = await doc.getPage(1);
      const it1 = (await p1.getTextContent()).items.filter((i) => i.str.trim())
        .map((i) => ({ t: i.str.trim(), x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) }));
      const rechtsVan = (label, exact = false) => {
        const l = it1.find((i) => (exact ? i.t === label : new RegExp("^" + label, "i").test(i.t)));
        if (!l) return null;
        const r = it1.filter((i) => Math.abs(i.y - l.y) <= 3 && i.x > l.x + 5).sort((a, b) => b.x - a.x)[0];
        return r ? r.t : null;
      };

      const kostregels = [];
      const kostLabel = it1.find((i) => i.t === "Cost");
      const totaalLabel = it1.find((i) => /^Total costs/i.test(i.t));
      if (kostLabel && totaalLabel) {
        for (const i of it1) {
          if (i.y < kostLabel.y && i.y > totaalLabel.y && i.x < 200) {
            const w2 = it1.filter((j) => Math.abs(j.y - i.y) <= 3 && j.x > i.x + 5).sort((a, b) => b.x - a.x)[0];
            if (w2) kostregels.push({ omschrijving: i.t, bedrag: bedrag(w2.t) });
          }
        }
      }
      /*
       * Het totaalbedrag van de kosten staat NIET rechts van het label "Total costs"
       * maar op de regel erboven, als losstaand bedrag. Daarom apart opzoeken:
       * het dichtstbijzijnde bedrag boven het label.
       */
      let totaleKosten = null;
      if (totaalLabel) {
        const kandidaat = it1
          .filter((i) => i.y > totaalLabel.y && i.y - totaalLabel.y < 20 && /€|\d,\d{2}/.test(i.t) && i.x > 300)
          .sort((a, b) => a.y - b.y)[0];
        if (kandidaat) totaleKosten = bedrag(kandidaat.t);
      }
      if (totaleKosten === null && kostregels.length) {
        totaleKosten = +kostregels.reduce((s, k) => s + (k.bedrag || 0), 0).toFixed(2);
      }

      // ---------- vervolgpagina's: transactieregels ----------
      const transacties = [];
      let huidigeLot = null;
      for (let pg = 2; pg <= doc.numPages; pg++) {
        const pgObj = await doc.getPage(pg);
        const items = (await pgObj.getTextContent()).items.filter((i) => i.str.trim())
          .map((i) => ({ t: i.str.trim(), x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) }));
        const regels = new Map();
        for (const i of items) {
          const k = Math.round(i.y / 3) * 3;
          if (!regels.has(k)) regels.set(k, []);
          regels.get(k).push(i);
        }
        for (const [, rij] of [...regels.entries()].sort((a, b) => b[0] - a[0])) {
          const cellen = rij.sort((a, b) => a.x - b.x);
          const eerste = cellen[0];
          if (eerste.t === "Lot") {
            huidigeLot = {
              lotnummer: cellen[1] ? cellen[1].t : null,
              code: cellen[2] ? cellen[2].t : null,
              product: cellen.find((c) => c.x > 205 && c.x < 380)?.t || null,
            };
            continue;
          }
          // transactieregel: begint met een datum
          if (/^\d{2}-\d{2}-\d{4}$/.test(eerste.t) && huidigeLot) {
            const kanaal = cellen[1] ? cellen[1].t : null;
            const nums = cellen.filter((c) => c.x > 440).map((c) => c.t);
            if (nums.length >= 3) {
              transacties.push({
                lotnummer: huidigeLot.lotnummer,
                product: huidigeLot.product,
                datum: eerste.t,
                kanaal,
                stelen: getal(nums[0]),
                prijs: getal(nums[1]),
                bedrag: getal(nums[2]),
              });
            }
          }
        }
      }
      await doc.destroy();

      uit.push({
        parthdr_id: w.parthdr_id,
        leverancier: w.leverancier,
        factnum: w.factnum,
        pdf: w.pdf,
        paginas: doc.numPages,
        pdf_nummer: rechtsVan("Invoice number"),
        pdf_leverdatum: rechtsVan("Deliverydate"),
        pdf_factuurdatum: rechtsVan("Invoice date"),
        direct_sales: bedrag(rechtsVan("Direct sales")),
        turnover_auction: bedrag(rechtsVan("Turnover Auction")),
        used_in_production: bedrag(rechtsVan("Used in production")),
        total_turnover: bedrag(rechtsVan("Total nett turnover")),
        total_costs: totaleKosten,
        to_be_received: bedrag(rechtsVan("To be received by supplier")),
        kostregels: kostregels,
        transacties: transacties,
      });
      klaar++;
      if (klaar % 25 === 0) console.log(`  ${klaar}/${werk.length} verwerkt`);
    } catch (e) {
      fout++;
      uit.push({ parthdr_id: w.parthdr_id, leverancier: w.leverancier, pdf: w.pdf, fout: e.message });
    }
  }

  fs.writeFileSync(UIT, JSON.stringify(uit, null, 1), "utf8");
  const goed = uit.filter((u) => !u.fout);
  const metTx = goed.filter((u) => u.transacties.length);
  const metProd = goed.filter((u) => u.used_in_production);
  console.log(`\nklaar: ${klaar} gelezen, ${fout} mislukt`);
  console.log(`  met transactieregels : ${metTx.length} (${goed.reduce((s, u) => s + u.transacties.length, 0)} regels totaal)`);
  console.log(`  met "Used in production": ${metProd.length}`);
  console.log(`  met totaalomzet gevonden: ${goed.filter((u) => u.total_turnover !== null).length}`);
  console.log(`-> ${UIT}`);
})().catch((e) => { console.error("FOUT: " + e.stack); process.exit(1); });
