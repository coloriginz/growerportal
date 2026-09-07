export interface PagedResponse<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
}

/** Bovengrens op het aantal rondes, zodat een verkeerd `totalPages` niet blijft doorlopen. */
const MAX_RONDES = 200;

/**
 * Loopt alle pagina's van een gepagineerde lijstroute af en geeft de rijen samen
 * terug.
 *
 * Voor de CSV-export. Zonder dit zou de export precies de fout maken die de
 * paginatie moest oplossen: een bestand dat stilzwijgend afkapt op wat er
 * toevallig in beeld stond. De export vraagt daarom dezelfde filters op als het
 * scherm, maar dan alle pagina's — en `limit` staat hoger dan wat het scherm
 * gebruikt, zodat dat een paar rondes zijn en niet tientallen.
 */
export async function fetchAllPages<T>(
  basisUrl: string,
  limit = 500,
  signal?: AbortSignal
): Promise<T[]> {
  const rijen: T[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const url = new URL(basisUrl, window.location.origin);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));

    const res = await fetch(url.toString(), { signal });
    if (!res.ok) throw new Error(`${url.pathname} gaf ${res.status}`);

    const data = (await res.json()) as PagedResponse<T>;
    rijen.push(...data.items);
    totalPages = data.totalPages;
    page += 1;
  } while (page <= totalPages && page <= MAX_RONDES);

  return rijen;
}
