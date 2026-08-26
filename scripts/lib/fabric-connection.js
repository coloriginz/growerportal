/*
 * De verbinding met de Fabric SQL analytics endpoints: device code flow op je
 * eigen Entra ID-account, met het refresh token in de Windows credential store.
 *
 * Apart van de CLI eromheen omdat er inmiddels meer dan één script het warehouse
 * bevraagt. Twee kopieën van deze inlogdans betekent twee token-caches die uit
 * de pas lopen, en een tweede plek waar het serveradres moet worden bijgewerkt
 * als het warehouse-item opnieuw wordt aangemaakt.
 *
 *   const { queryFabric } = require("./lib/fabric-connection");
 *   const [rows] = await queryFabric("SELECT TOP 5 * FROM marts.fct_orders");
 */
const fs = require("fs");
const path = require("path");
const sql = require("mssql");
const { DeviceCodeCredential, useIdentityPlugin } = require("@azure/identity");

// Bewaart het refresh token in de Windows credential store, zodat het access token
// stil vernieuwd wordt en je niet elk uur opnieuw hoeft in te loggen.
try {
  const { cachePersistencePlugin } = require("@azure/identity-cache-persistence");
  useIdentityPlugin(cachePersistencePlugin);
} catch {
  console.error("Let op: cache-persistence plugin niet geladen, login verloopt na een uur.");
}

// Het endpoint hangt aan het wárehouse-item, niet aan de workspace: wordt het
// item opnieuw aangemaakt (deployment pipeline, dbt-teardown), dan verandert het
// achtervoegsel en blijft het oude adres antwoorden op een leeg omhulsel.
const SERVER =
  process.env.FABRIC_SERVER ||
  "gxj6wkn4weouxoe35jxcon4hmi-bd7jcf6wfpgurdnlardqqbs62m.datawarehouse.fabric.microsoft.com";
const DATABASE = process.env.FABRIC_DB || "wh_transform";
const SCOPE = "https://database.windows.net/.default";
// Well-known public client id van Azure CLI; geen secret nodig.
const CLIENT_ID = "04b07795-8ddb-461a-bbee-02f9e1bf7b46";
const TENANT = process.env.FABRIC_TENANT || "organizations";

// Twee mappen omhoog: dit bestand staat in scripts/lib/, de bestanden horen in
// de projectwortel te blijven staan waar ze al stonden en waar .gitignore ze kent.
const WORTEL = path.join(__dirname, "..", "..");
const CACHE = path.join(WORTEL, ".fabric-token-cache.json");
const CODE_BESTAND = path.join(WORTEL, ".fabric-devicecode.txt");
const RECORD = path.join(WORTEL, ".fabric-auth-record.json");
const LOG = path.join(WORTEL, ".fabric-auth-log.txt");

/*
 * Diagnostiek gaat naar een bestand én naar stderr. In achtergrondruns wordt
 * stderr gebufferd en zie je niets tot het proces klaar is — precies wanneer
 * je het nodig hebt (hangende login) zie je dan niets. Het logbestand wel.
 */
function meld(tekst) {
  const regel = `[${new Date().toISOString().slice(11, 19)}] ${tekst}`;
  console.error(regel);
  try { fs.appendFileSync(LOG, regel + "\n", "utf8"); } catch { /* niet kritiek */ }
}

async function haalToken() {
  // 1. nog geldig access token in de eenvoudige cache?
  if (fs.existsSync(CACHE)) {
    try {
      const c = JSON.parse(fs.readFileSync(CACHE, "utf8"));
      if (c.expiresOnTimestamp && c.expiresOnTimestamp - Date.now() > 120000) return c.token;
    } catch { /* cache corrupt, opnieuw ophalen */ }
  }

  try { fs.writeFileSync(LOG, "", "utf8"); } catch { /* niet kritiek */ }
  meld("access token verlopen of afwezig; account zoeken");

  // 2. eerder bewaard account, zodat het refresh token stil gebruikt kan worden
  let record;
  if (fs.existsSync(RECORD)) {
    try {
      record = JSON.parse(fs.readFileSync(RECORD, "utf8"));
      meld("account gevonden in .fabric-auth-record.json");
    } catch (e) { meld("account-bestand onleesbaar: " + e.message); }
  } else {
    meld("geen .fabric-auth-record.json — die wordt nu aangemaakt");
  }

  const opties = {
    tenantId: TENANT,
    clientId: CLIENT_ID,
    tokenCachePersistenceOptions: { enabled: true, name: "growerportal-fabric" },
    ...(record ? { authenticationRecord: record } : {}),
    userPromptCallback: (info) => {
      const tekst =
        "\n=================================================================\n" +
        "  LOGIN NODIG\n" +
        "  Ga naar : " + info.verificationUri + "\n" +
        "  Code    : " + info.userCode + "\n" +
        "=================================================================\n";
      console.error(tekst);
      // ook naar bestand, want console-output kan in pipes blijven hangen
      try { fs.writeFileSync(CODE_BESTAND, tekst, "utf8"); } catch { /* niet kritiek */ }
    },
  };

  const cred = new DeviceCodeCredential(opties);

  /*
   * authenticate() geeft het account terug: stil uit de cache als dat kan, anders
   * via een device code. Het wordt altijd aangeroepen wanneer er nog geen record is,
   * zodat dat bestand gegarandeerd ontstaat. Eerdere opzet riep het alleen aan als
   * getToken faalde, waardoor het record nooit werd geschreven zolang de cache nog
   * een geldig token had — en dus elke keer opnieuw ingelogd moest worden.
   */
  if (!record) {
    try {
      const nieuw = await cred.authenticate(SCOPE);
      if (nieuw) {
        fs.writeFileSync(RECORD, JSON.stringify(nieuw), "utf8");
        meld(`account bewaard (${nieuw.username || "onbekende gebruiker"})`);
      } else {
        meld("LET OP: authenticate() gaf geen account terug — stille vernieuwing blijft onmogelijk");
      }
    } catch (e) {
      meld("LET OP: authenticate() mislukt: " + e.name + " — " + e.message);
    }
  }

  let t = null;
  try {
    t = await cred.getToken(SCOPE, { disableAutomaticAuthentication: true });
    if (t) meld("token stil vernieuwd, geen login nodig");
  } catch (e) {
    meld("stille vernieuwing niet mogelijk (" + e.name + "), device code volgt");
  }
  if (!t) t = await cred.getToken(SCOPE);

  fs.writeFileSync(CACHE, JSON.stringify({ token: t.token, expiresOnTimestamp: t.expiresOnTimestamp }), "utf8");
  try { if (fs.existsSync(CODE_BESTAND)) fs.unlinkSync(CODE_BESTAND); } catch { /* niet kritiek */ }
  return t.token;
}

/** Voert de query uit en geeft alle recordsets terug. */
async function queryFabric(sqlText) {
  const token = await haalToken();
  const pool = new sql.ConnectionPool({
    server: SERVER,
    database: DATABASE,
    options: {
      encrypt: true,
      trustServerCertificate: false,
      port: 1433,
      ...(process.env.FABRIC_PACKET ? { packetSize: Number(process.env.FABRIC_PACKET) } : {}),
      ...(process.env.FABRIC_DEBUG ? { debug: { packet: true, data: false, payload: false, token: false } } : {}),
    },
    authentication: { type: "azure-active-directory-access-token", options: { token } },
    connectionTimeout: Number(process.env.FABRIC_CONN_TIMEOUT || 60000),
    requestTimeout: 600000,
  });
  if (process.env.FABRIC_DEBUG) {
    pool.on("debug", (m) => console.error("[tedious] " + m));
    pool.on("error", (e) => console.error("[pool-error] " + e.message));
  }
  await pool.connect();
  try {
    const r = await pool.request().query(sqlText);
    return r.recordsets;
  } finally {
    await pool.close();
  }
}

module.exports = { queryFabric };
