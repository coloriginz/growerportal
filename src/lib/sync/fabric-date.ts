/**
 * Leest een datum zoals Fabric hem levert, en rekent hem als UTC.
 *
 * De warehouse geeft datums zonder tijdzone terug ("2025-07-14T00:00:00").
 * JavaScript leest die vorm als *lokale* tijd, dus op een machine in
 * Europe/Amsterdam wordt dat 2025-07-13T22:00:00Z en schuift elke levering een
 * dag terug. Op Vercel valt dat nooit op, want die draait in UTC — en precies
 * daarom is het een val: de fout verschijnt alleen als iemand een importronde of
 * een reparatiescript lokaal draait, en dan verplaatst hij stilzwijgend data.
 *
 * Gemeten tijdens het bouwen van de creditfactuur-uitbreiding: een handmatige
 * ronde over 14 juli 2025 zette alle 111 transacties van COLXLNFW op 13 juli.
 *
 * Een datum zonder tijddeel ("2025-07-14") leest JavaScript al als UTC; die
 * blijft ongemoeid, want er "Z" achter plakken maakt hem juist ongeldig.
 */
export function parseFabricDate(waarde: string): Date {
  const s = waarde.trim().replace(" ", "T");
  if (!s.includes("T")) return new Date(s);
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return new Date(s);
  return new Date(`${s}Z`);
}
