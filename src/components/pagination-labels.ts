import type { PaginationLabels } from "@/components/pagination";

/* Het registry-item toont standaard "40 / 55" om geen taal op te dringen.
   Dit portaal is Engelstalig en schrijft het voluit, overal hetzelfde. */
export const pageLabels: PaginationLabels = {
  page: (page, totalPages) => `Page ${page} of ${totalPages}`,
};
