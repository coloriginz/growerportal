/*
 * Wat de orders-import mag opruimen dat Fabric heeft ingetrokken.
 *
 * De import kon lang wel toevoegen en wijzigen, maar nooit verwijderen: de
 * opruiming vóór het herinvoeren was gescoped op de (partij, ordreg)-paren die
 * in de binnenkomende batch zaten. Een orderregel die het warehouse intrekt komt
 * in geen enkele latere batch meer voor en werd dus nooit meer aangeraakt. Dat
 * leverde op 29-08-2026 176 weesregels op — 150.735 stelen en EUR 49.419 aan
 * omzet die de kweker in de portal zag en nooit heeft gekregen, verspreid over
 * 105 leveringen. Twee daarvan bestonden voor 100% uit ingetrokken regels.
 *
 * Vensterbreed opruimen mag alleen als vaststaat dat de payload compleet is over
 * dat venster. Dat is precies wat de portal-gestuurde sync garandeert: één
 * SyncJob is één query is één POST, en de brokgrootte is zo gekozen dat het
 * antwoord in één post past (zie backfill.ts). Buiten die garantie — de oude
 * DAX-flows en de reparatiescripts, die zonder batchId posten — blijft het bij
 * de oude, paargescopede opruiming.
 *
 * Deze functie is het enige punt waar die afweging valt, apart van de SQL zodat
 * hij te controleren is zonder database (scripts/checks/withdrawal.ts).
 */

export type WithdrawalScope =
  /** Ruim het hele vensterdeel op dat niet in de payload zit. */
  | { mode: "window"; from: Date; to: Date; supplierId: string | null }
  /** Laat staan wat niet in de payload zit; alleen de paren worden herschreven. */
  | { mode: "pairs"; reason: string };

export type WithdrawalInput = {
  /** De sync-job achter deze batch, of null als de POST er geen had. */
  job: {
    windowFrom: Date;
    windowTo: Date;
    supplierFabricId: number | null;
  } | null;
  /**
   * De portal-leverancier achter `job.supplierFabricId`, of null als die niet te
   * vinden was. Bij een job zonder leverancier is dit altijd null.
   */
  supplierId: string | null;
  /** Het aantal rijen dat de payload droeg, vóór alle filtering. */
  payloadRows: number;
};

export function resolveWithdrawalScope(input: WithdrawalInput): WithdrawalScope {
  const { job, supplierId, payloadRows } = input;

  // Geen job: dit is een oude DAX-flow of een reparatiescript. Die kennen geen
  // venster, en wat zij niet meesturen is daarom geen bewijs dat het weg mag.
  if (!job) return { mode: "pairs", reason: "geen sync-job bij deze batch" };

  // Een leeg antwoord is geen bewijs dat het venster leeg is. Fabric geeft een
  // gefilterde query soms zonder fout een lege recordset terug — drie keer op rij
  // gemeten op 26-08-2026, waarna dezelfde query 1.511 rijen gaf. Op zo'n
  // antwoord een heel venster wissen is precies de fout die dan niet opvalt.
  if (payloadRows === 0) return { mode: "pairs", reason: "lege payload" };

  // Een job voor één leverancier waarvan de portal de leverancier niet kan
  // thuisbrengen, mag niet stilzwijgend verbreden naar álle leveranciers: dan
  // wist een backfill voor één kweker het venster van iedereen.
  if (job.supplierFabricId !== null && supplierId === null) {
    return {
      mode: "pairs",
      reason: `leverancier ${job.supplierFabricId} niet gevonden in de portal`,
    };
  }

  if (!(job.windowTo > job.windowFrom)) {
    return { mode: "pairs", reason: "leeg venster" };
  }

  return {
    mode: "window",
    from: job.windowFrom,
    to: job.windowTo,
    supplierId: job.supplierFabricId === null ? null : supplierId,
  };
}
