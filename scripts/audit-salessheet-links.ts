/*
 * Controleert elke bestaande salessheet-koppeling tegen de PDF zelf.
 *
 * De koppelroute legt alleen een verband als de leverdatum op de PDF exact
 * gelijk is aan die van de afrekening — sales sheet-nummers recyclen per jaar,
 * dus het nummer alleen is niet genoeg. Koppelingen van vóór die controle staan
 * er nog, en die zijn niet aan de portal te zien: er hangt een PDF, hij opent,
 * en hij gaat over een andere levering.
 *
 * Gemeten op 29 augustus 2026: zes PCFUP-leveringen uit februari en maart 2025
 * droegen de afrekening van februari en maart 2026, waarvan drie van een heel
 * andere leverancier (Israël, Zuid-Afrika). De kweker kan dus de afrekening van
 * een concurrent downloaden. Zie `tasks/todo-salessheet-verkeerde-leverancier.md`.
 *
 * Dit script leest de PDF uit het lokale archief, vergelijkt de leverdatum met
 * die van de afrekening, en maakt met `--apply` de koppelingen los die niet
 * kloppen. Losmaken is genoeg: `scripts/link-salessheet-pdfs.ts` zoekt
 * afrekeningen zónder PDF en biedt ze opnieuw aan, en die route legt ze dan met
 * de datumcontrole erbij goed.
 *
 * Draaien:
 *   npx tsx scripts/audit-salessheet-links.ts                 # dry run
 *   npx tsx scripts/audit-salessheet-links.ts --apply         # koppelingen losmaken
 *   npx tsx scripts/audit-salessheet-links.ts --limit=200     # proefje
 *
 * Opties:
 *   --apply        maak foute koppelingen los én haal het bijbehorende document uit de
 *                  documentenbibliotheek. Zonder deze vlag wordt er niets gewijzigd.
 *   --check-urls   controleer ook of het bestand in de blobopslag nog bestaat. Kost een
 *                  netwerkaanroep per koppeling, dus staat standaard uit.
 *   --limit=N      controleer hooguit N koppelingen.
 *   --blob         haal bestanden die niet in het archief staan uit de blobopslag, zodat
 *                  ook de e-mailkoppelingen op inhoud worden gecontroleerd. Traag, maar
 *                  op productie staat élk bestand alleen daar.
 *   --archief=PAD  wortelmap met PDF's. Standaard private_input/salessheets.
 *   --report=PAD   schrijf het rapport hierheen.
 */
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { parseSalesSheetPdf } from "../src/lib/salessheet-pdf-parser";
import { parseSalesSheetFilename } from "../src/lib/salessheet-filename-parser";

function argWaarde(vlag: string): string | undefined {
  const arg = process.argv.slice(2).find((a) => a.startsWith(vlag + "="));
  return arg ? arg.slice(vlag.length + 1) : undefined;
}

const APPLY = process.argv.includes("--apply");
/**
 * Haal bestanden die niet in het archief staan op uit de blobopslag. Zonder dit
 * blijft elke e-mailkoppeling ongecontroleerd — op productie is dat alles.
 */
const BLOB = process.argv.includes("--blob");
const CHECK_URLS = process.argv.includes("--check-urls");
const LIMIT = Number(argWaarde("--limit") ?? 0) || Infinity;
const ARCHIEF = argWaarde("--archief") ?? path.join("private_input", "salessheets");
const REPORT = argWaarde("--report") ?? path.join("tasks", "audit-salessheet-links.md");

/*
 * De ruwe tekst van de eerste pagina's, om te zien wiens afrekening het is.
 *
 * De leverdatum alleen is niet genoeg gebleken. Op productie hing
 * `PCXOMRI - ... - 564 - 406743.PDF` aan levering 564 van PCXBAR (Tal Baruch) en
 * de datum klopte tot op de dag — twee leveranciers leverden allebei op
 * 10-07-2026 en droegen allebei shipment 564. In de PDF staat "Omri Cohen",
 * "Ein Habesor ISRAEL" en drie keer `PCXOMRI`; "Baruch" komt er niet in voor.
 * Zonder deze controle blijft zo'n koppeling staan omdat elk ander signaal klopt.
 */
async function pdfTekst(buffer: Buffer): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    verbosity: 0,
  }).promise;
  try {
    let tekst = "";
    for (let i = 1; i <= Math.min(doc.numPages, 2); i++) {
      const inhoud = await (await doc.getPage(i)).getTextContent();
      tekst += inhoud.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
    }
    return tekst;
  } finally {
    await doc.destroy();
  }
}

/** Alle PDF's in het archief, op kleine-letter bestandsnaam. */
function indexeerArchief(wortel: string): Map<string, string[]> {
  const perNaam = new Map<string, string[]>();
  const loop = (map: string) => {
    for (const item of fs.readdirSync(map, { withFileTypes: true })) {
      const pad = path.join(map, item.name);
      if (item.isDirectory()) loop(pad);
      else if (/\.pdf$/i.test(item.name)) {
        const sleutel = item.name.toLowerCase();
        const lijst = perNaam.get(sleutel);
        if (lijst) lijst.push(pad);
        else perNaam.set(sleutel, [pad]);
      }
    }
  };
  loop(wortel);
  return perNaam;
}

type Uitkomst = {
  invoiceNumber: string;
  supplier: string;
  leverdatumPortal: string;
  bestand: string;
  leverdatumPdf: string | null;
  status:
    | "klopt"
    | "datum wijkt af"
    | "datum onleesbaar"
    | "bestand niet gevonden"
    | "blob onbereikbaar"
    /** De PDF noemt zelf de code van een andere leverancier. Zwaarder dan de datum. */
    | "andere leverancier";
  /*
   * De leverancierscode die de bestandsnaam noemt, als die afwijkt van de
   * leverancier van de afrekening. Bewust een eigen veld en niet in `status`
   * verwerkt: de telling moet op de uitkomst blijven optellen, en dit is een
   * aanwijzing naast die uitkomst, geen uitkomst op zichzelf.
   *
   * En het is echt niet meer dan een aanwijzing. Op test dragen 35 koppelingen
   * een naam met een andere code terwijl de leverdatum in de PDF gewoon klopt
   * (gemeten 29-08-2026, alle 4.024 leesbare koppelingen nagerekend). Op productie
   * viel het wél samen: van de zes die daar op inhoud zijn nagerekend weken alle
   * zes óók maanden af op de datum. Alleen op de naam losmaken zou hier dus
   * twintig goede koppelingen hebben gesloopt.
   */
  naamCode: string | null;
};

async function main() {
  if (!fs.existsSync(ARCHIEF)) {
    console.error(`Archief niet gevonden: ${ARCHIEF}`);
    process.exit(1);
  }
  const archief = indexeerArchief(ARCHIEF);
  console.log(`archief: ${[...archief.values()].reduce((a, l) => a + l.length, 0)} PDF's`);

  const gekoppeld = await prisma.salesSheet.findMany({
    where: { pdfDocumentId: { not: null } },
    select: {
      id: true,
      invoiceNumber: true,
      deliveryDate: true,
      pdfDocumentId: true,
      supplier: { select: { code: true } },
      pdfDocument: { select: { fileName: true, fileUrl: true } },
    },
    orderBy: { deliveryDate: "asc" },
  });
  const teDoen = LIMIT === Infinity ? gekoppeld : gekoppeld.slice(0, LIMIT);
  console.log(`gekoppelde afrekeningen: ${gekoppeld.length}${teDoen.length < gekoppeld.length ? ` — beperkt tot ${teDoen.length}` : ""}`);
  console.log(APPLY ? "Foute koppelingen worden losgemaakt" : "DRY RUN — er wordt niets gewijzigd");
  console.log("");

  // Vooraf, want de lus toetst er per koppeling tegen: een code in de
  // bestandsnaam telt alleen als het een échte andere leverancier is.
  const bekendeCodes = new Set(
    (await prisma.supplier.findMany({ select: { code: true } })).map((s) => s.code.toUpperCase())
  );

  const uitkomsten: Uitkomst[] = [];
  const losTeMaken: string[] = [];

  for (const [i, sheet] of teDoen.entries()) {
    const naam = sheet.pdfDocument?.fileName ?? "";
    const paden = archief.get(naam.toLowerCase()) ?? [];
    const leverdatumPortal = sheet.deliveryDate.toISOString().slice(0, 10);
    const naamCode0 = parseSalesSheetFilename(naam)?.supplierCode ?? null;
    const basis = {
      invoiceNumber: sheet.invoiceNumber,
      supplier: sheet.supplier.code,
      leverdatumPortal,
      bestand: naam,
      naamCode:
        naamCode0 && naamCode0.toUpperCase() !== sheet.supplier.code.toUpperCase()
          ? naamCode0
          : null,
    };

    /*
     * Eerst of het bestand er nog is. Een afrekening kan een documentverwijzing
     * dragen waarvan de blob verdwenen is: in het scherm staat dan een
     * downloadknop die nergens heen gaat. Dat is een andere fout dan een
     * verkeerd gekoppelde PDF en hij is niet aan de data te zien, alleen aan de
     * opslag. Ook hier is losmaken de reparatie — een knop die niets doet is
     * erger dan geen knop.
     */
    if (CHECK_URLS && sheet.pdfDocument?.fileUrl) {
      let bereikbaar = false;
      try {
        bereikbaar = (await fetch(sheet.pdfDocument.fileUrl, { method: "HEAD" })).ok;
      } catch {
        bereikbaar = false;
      }
      if (!bereikbaar) {
        uitkomsten.push({ ...basis, leverdatumPdf: null, status: "blob onbereikbaar" });
        losTeMaken.push(sheet.id);
        continue;
      }
    }

    /*
     * De leverancierscode uit de bestandsnaam, als eerste zeef.
     *
     * Kost niets — geen bestand, geen download — en hij vindt precies de
     * koppelingen die deze audit tot 29-08-2026 niet zag: PDF's die alleen in de
     * blobopslag staan omdat ze via de e-mailstroom binnenkwamen. Op productie
     * staat élke gekoppelde PDF daar, dus daar was deze audit tot nu toe blind.
     * Gemeten op die dag: 84 van 433 productiekoppelingen dragen een andere
     * leverancierscode dan de afrekening waar ze aan hangen, en de zes die ik op
     * inhoud narekende weken allemaal óók maanden af op de leverdatum in de PDF
     * zelf. Twee onafhankelijke signalen, dus dit is geen ruis.
     *
     * Losmaken doet deze zeef niet op eigen houtje: de bestandsnaam is een
     * aanwijzing, de leverdatum in het document is het bewijs. Staat het bestand
     * lokaal of is `--blob` meegegeven, dan beslist die datum hieronder alsnog.
     */
    let bron: Buffer | null = null;
    if (paden.length > 0) {
      bron = fs.readFileSync(paden[0]);
    } else if (BLOB && sheet.pdfDocument?.fileUrl) {
      // Alleen op verzoek: dit haalt elk bestand op dat niet lokaal staat.
      try {
        const res = await fetch(sheet.pdfDocument.fileUrl);
        if (res.ok) bron = Buffer.from(await res.arrayBuffer());
      } catch {
        // onbereikbaar; hieronder afgehandeld als "bestand niet gevonden"
      }
    }

    if (!bron) {
      uitkomsten.push({
        ...basis,
        leverdatumPdf: null,
        status: "bestand niet gevonden",
      });
      continue;
    }

    let leverdatumPdf: string | null = null;
    try {
      leverdatumPdf = (await parseSalesSheetPdf(bron)).deliveryDate;
    } catch {
      // Een onleesbare PDF is geen bewijs van een foute koppeling; alleen melden.
    }

    /*
     * De zwaarste controle staat vóór de datum: noemt de PDF zelf de code van de
     * leverancier uit de bestandsnaam, en niet die van de afrekening, dan is het
     * document van iemand anders — ook als elke datum klopt.
     */
    let anderLuidt = false;
    if (basis.naamCode && bekendeCodes.has(basis.naamCode.toUpperCase())) {
      try {
        const tekst = (await pdfTekst(bron)).toUpperCase();
        anderLuidt =
          tekst.includes(basis.naamCode.toUpperCase()) &&
          !tekst.includes(sheet.supplier.code.toUpperCase());
      } catch {
        // Onleesbaar: dan beslist de datum hieronder, zoals voorheen.
      }
    }

    if (anderLuidt) {
      uitkomsten.push({ ...basis, leverdatumPdf, status: "andere leverancier" });
      losTeMaken.push(sheet.id);
    } else if (!leverdatumPdf) {
      uitkomsten.push({ ...basis, leverdatumPdf: null, status: "datum onleesbaar" });
    } else if (leverdatumPdf === leverdatumPortal) {
      uitkomsten.push({ ...basis, leverdatumPdf, status: "klopt" });
    } else {
      uitkomsten.push({ ...basis, leverdatumPdf, status: "datum wijkt af" });
      losTeMaken.push(sheet.id);
    }

    if ((i + 1) % 250 === 0) console.log(`  ${i + 1}/${teDoen.length}`);
  }

  /*
   * De koppeling weghalen én het document uit de bibliotheek halen.
   *
   * Alleen loskoppelen was niet genoeg, en dat was lang niet te zien. De
   * shipmentpagina toont de PDF via `SalesSheet.pdfDocumentId`, maar de
   * documentenpagina leest `Document.supplierId` — een heel ander pad. Een
   * losgekoppelde PDF verdween dus uit het leveringoverzicht en bleef gewoon in
   * de documentenlijst van de verkeerde leverancier staan, downloadbaar. Bij een
   * verkeerd gekoppelde afrekening is dat precies het deel dat ertoe doet: de
   * omzet, kosten en kwekersnamen van een ander.
   *
   * Het bestand zelf blijft in de blobopslag en de bestandsnaam staat in het
   * rapport, dus terugvinden kan nog steeds — alleen niet meer door de verkeerde
   * leverancier. Een document dat nog aan een ándere afrekening hangt blijft
   * staan; dan is het daar wél op zijn plek.
   */
  let documentenVerwijderd = 0;
  if (APPLY && losTeMaken.length > 0) {
    const betrokken = await prisma.salesSheet.findMany({
      where: { id: { in: losTeMaken } },
      select: { pdfDocumentId: true },
    });
    const documentIds = [...new Set(betrokken.map((s) => s.pdfDocumentId).filter(Boolean))] as string[];

    /*
     * Ook `ourInvoiceNumber` wissen. Dat veld wordt alleen geschreven wanneer een
     * PDF wordt gekoppeld, en komt dus uit de bestandsnaam van precies de PDF die
     * hier fout blijkt. Laten staan betekent dat de afrekening het factuurnummer
     * van een andere levering blijft dragen — en `findCandidates()` in
     * /api/shipments/import-email zoekt daar op, zodat een volgende PDF opnieuw bij
     * deze levering uitkomt. De leverdatumcontrole houdt dat tegen, dus het maakt
     * geen foute koppeling, maar het blijft een verkeerd spoor voeden.
     */
    const losgemaakt = await prisma.salesSheet.updateMany({
      where: { id: { in: losTeMaken } },
      data: {
        pdfDocumentId: null,
        ourInvoiceNumber: null,
        // Ook de gelezen bedragen. Blijven die van een verkeerde PDF staan, dan
        // levert dat een blijvende mismatch op die naar zichzelf wijst: de
        // vergelijking zou een document beoordelen dat er niet meer hangt.
        pdfTurnover: null,
        pdfCosts: null,
        pdfNetResult: null,
        // Ook de factuurdatum: blijft die staan, dan draagt deze levering de
        // factuurdatum van de PDF die hier net is losgemaakt.
        pdfInvoiceDate: null,
        pdfParsedAt: null,
      },
    });
    console.log(`\nlosgemaakt: ${losgemaakt.count} koppelingen`);

    if (documentIds.length > 0) {
      // Pas ná het loskoppelen: zolang de afrekening er nog naar wijst, telt hij
      // zichzelf mee als "nog in gebruik".
      const nogInGebruik = await prisma.salesSheet.findMany({
        where: { pdfDocumentId: { in: documentIds } },
        select: { pdfDocumentId: true },
      });
      const bezet = new Set(nogInGebruik.map((s) => s.pdfDocumentId));
      const vrij = documentIds.filter((id) => !bezet.has(id));
      if (vrij.length > 0) {
        documentenVerwijderd = (await prisma.document.deleteMany({ where: { id: { in: vrij } } }))
          .count;
        console.log(`uit de documentenbibliotheek gehaald: ${documentenVerwijderd} documenten`);
      }
    }
  }

  /*
   * De restanten van eerdere rondes.
   *
   * Tot vandaag maakte dit script alleen de koppeling los en liet het document
   * staan. Elke ronde daarvóór liet dus een PDF achter in de bibliotheek van een
   * leverancier die er niets mee te maken heeft — 83 stuks bij de ronde van
   * 29-08-2026. Die vind je niet meer via de afrekeningen, want die verwijzing is
   * juist weg; het enige spoor is de bestandsnaam.
   *
   * De regel is streng gehouden: alleen documenten die aan géén enkele afrekening
   * hangen én waarvan de naam een code draagt die een échte andere leverancier is.
   * Een naam met een onbekende code kan van alles zijn en bewijst niets.
   */
  const losseDocs = await prisma.document.findMany({
    where: { type: "salessheet", salesSheets: { none: {} } },
    select: { id: true, fileName: true, supplier: { select: { code: true } } },
  });
  const verkeerdGearchiveerd = losseDocs.filter((d) => {
    const code = parseSalesSheetFilename(d.fileName)?.supplierCode?.toUpperCase();
    return code && code !== d.supplier.code.toUpperCase() && bekendeCodes.has(code);
  });

  if (verkeerdGearchiveerd.length > 0) {
    console.log(
      `
losse documenten bij de verkeerde leverancier: ${verkeerdGearchiveerd.length}`
    );
    for (const d of verkeerdGearchiveerd) {
      console.log(`  ${d.supplier.code} draagt ${d.fileName}`);
    }
    if (APPLY) {
      const n = (
        await prisma.document.deleteMany({
          where: { id: { in: verkeerdGearchiveerd.map((d) => d.id) } },
        })
      ).count;
      documentenVerwijderd += n;
      console.log(`  uit de bibliotheek gehaald: ${n}`);
    }
  }

  schrijfRapport(uitkomsten);

  const tel = (s: Uitkomst["status"]) => uitkomsten.filter((u) => u.status === s).length;
  console.log("");
  console.log(`gecontroleerd        : ${uitkomsten.length}`);
  console.log(`klopt                : ${tel("klopt")}`);
  if (CHECK_URLS) console.log(`blob onbereikbaar    : ${tel("blob onbereikbaar")}${APPLY ? " (losgemaakt)" : ""}`);
  console.log(`andere leverancier   : ${tel("andere leverancier")}${APPLY ? " (losgemaakt)" : ""}`);
  console.log(`datum wijkt af       : ${tel("datum wijkt af")}${APPLY ? " (losgemaakt)" : ""}`);
  console.log(`datum onleesbaar     : ${tel("datum onleesbaar")}`);
  if (APPLY) console.log(`documenten verwijderd: ${documentenVerwijderd}`);
  console.log(`bestand niet gevonden: ${tel("bestand niet gevonden")}`);
  console.log(`Rapport: ${REPORT}`);
}

function schrijfRapport(uitkomsten: Uitkomst[]) {
  const fout = uitkomsten.filter((u) => u.status === "datum wijkt af");
  const regels = [
    "# Audit salessheet-koppelingen",
    "",
    "Uitgevoerd: " + new Date().toISOString().slice(0, 16).replace("T", " "),
    "Modus: " + (APPLY ? "foute koppelingen losgemaakt" : "dry run"),
    "",
    "| uitkomst | aantal |",
    "|---|---|",
    ...([
      "klopt",
      "datum wijkt af",
      "datum onleesbaar",
      "bestand niet gevonden",
      "blob onbereikbaar",
    ] as const).map(
      (s) => `| ${s} | ${uitkomsten.filter((u) => u.status === s).length} |`
    ),
    "",
    "## Koppelingen waarvan de leverdatum afwijkt",
    "",
    "| leverancier | shipment | leverdatum portal | leverdatum op PDF | naam zegt | bestand |",
    "|---|---|---|---|---|---|",
    ...fout.map(
      (u) =>
        `| ${u.supplier} | ${u.invoiceNumber} | ${u.leverdatumPortal} | ${u.leverdatumPdf} | ${u.naamCode ?? "-"} | ${u.bestand} |`
    ),
    "",
    /*
     * Apart, en met opzet niet losgemaakt. Een bestandsnaam die een andere
     * leverancier noemt terwijl de leverdatum klopt is een vraag, geen fout: op
     * test zijn dat er 35 en ze kloppen allemaal op inhoud. Ze hier tonen maakt
     * ze naslaanbaar zonder ze te behandelen als bewijs.
     */
    "## Koppelingen waarvan alleen de bestandsnaam een andere leverancier noemt",
    "",
    `Aanwijzing, geen bevinding: de leverdatum in de PDF is hier leidend en die klopt.`,
    "",
    "| leverancier | shipment | naam zegt | uitkomst | bestand |",
    "|---|---|---|---|---|",
    ...uitkomsten
      .filter((u) => u.naamCode && u.status !== "datum wijkt af")
      .map((u) => `| ${u.supplier} | ${u.invoiceNumber} | ${u.naamCode} | ${u.status} | ${u.bestand} |`),
    "",
  ];
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, regels.join("\n"), "utf8");
}

main()
  .catch((e) => {
    console.error("FOUT:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
