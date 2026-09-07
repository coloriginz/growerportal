"use client";

import { Pagination, type PaginationLabels } from "@/components/pagination";
import { useLanguage } from "@/components/providers/language-provider";
import { formatNumber } from "@/lib/format";
import { interpolate } from "@/lib/interpolate";

export interface ListPaginationProps {
  /** Huidige pagina, 1-based. */
  page: number;
  totalPages: number;
  /** Aantal rijen over alle pagina's samen, na filteren. */
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

/**
 * De voet onder een gepagineerde lijst: hoeveel er getoond wordt van hoeveel,
 * en de paginakiezer.
 *
 * De telling staat er ook bij één pagina, en dat is het punt van dit component.
 * Een lijst die stilzwijgend afkapte was de aanleiding: `/api/shipments` gaf
 * 200 rijen zonder dat ergens stond dat er 422 waren, en een leverancier las
 * dat als "verder terug is er niets". Zolang het totaal in beeld staat, kan die
 * vergissing niet meer gemaakt worden.
 */
export function ListPagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  disabled,
}: ListPaginationProps) {
  const { t } = useLanguage();

  if (total === 0) return null;

  const van = (page - 1) * pageSize + 1;
  const tot = Math.min(page * pageSize, total);

  const labels: PaginationLabels = {
    previous: t("common.previousPage"),
    next: t("common.nextPage"),
    picker: t("common.goToPage"),
    page: (huidige, aantal) =>
      interpolate(t("common.pageOf"), { page: String(huidige), total: String(aantal) }),
  };

  return (
    <div className="flex items-center justify-between gap-4 pt-4">
      <p className="text-muted-foreground text-sm tabular-nums">
        {interpolate(t("common.showingRange"), {
          from: formatNumber(van),
          to: formatNumber(tot),
          total: formatNumber(total),
        })}
      </p>
      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={onPageChange}
        labels={labels}
        disabled={disabled}
      />
    </div>
  );
}
