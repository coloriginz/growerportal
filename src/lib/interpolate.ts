/**
 * Vult `{naam}`-plaatshouders in een vertaalde tekst.
 *
 * De vertaalfunctie kent geen plaatshouders — nergens anders in dit portaal
 * staat een vertaling met een variabele erin. Voor de paginatievoet ("1-50 van
 * 422") is deze invulling goedkoper dan het vertaalsysteem uitbreiden, en ze
 * staat apart zodat `scripts/checks/list-pagination.ts` erop kan controleren.
 *
 * In één pass over het sjabloon en niet per waarde: bij het laatste wordt een
 * al ingevulde waarde opnieuw als plaatshouder gelezen. Een plaatshouder
 * waarvoor geen waarde is meegegeven blijft staan, zodat de check ziet dat de
 * namen in de vertaling en de namen in de aanroep uit elkaar lopen.
 */
export function interpolate(sjabloon: string, waarden: Record<string, string>): string {
  return sjabloon.replace(/\{(\w+)\}/g, (heel, naam: string) =>
    Object.prototype.hasOwnProperty.call(waarden, naam) ? waarden[naam] : heel
  );
}
