import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
const sql = neon(/^DATABASE_URL="?([^"\n\r]+)"?/m.exec(fs.readFileSync(".env","utf8"))[1]);
const r = await sql`SELECT ss."invoiceNumber", d."fileUrl" FROM "SalesSheet" ss JOIN "Document" d ON d.id=ss."pdfDocumentId" WHERE ss."fabricParthdrId" IN (2471194, 2471193)`;
fs.writeFileSync("tmp-urls.json", JSON.stringify(r));
console.log(r.map(x => x.invoiceNumber + " -> " + (x.fileUrl ? "url aanwezig" : "geen url")).join("\n"));
