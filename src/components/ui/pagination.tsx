"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Prev / page picker / next. De picker staat er omdat pagina 40 van 55
 * anders 39 keer Next kost. Elke pagina staat in de lijst; bij een paar
 * honderd pagina's blijft dat werkbaar, en verder komt geen scherm hier.
 */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  disabled,
  className,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label="Previous page"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        <RiArrowLeftSLine className="h-4 w-4" />
      </Button>

      <Select
        value={String(page)}
        onValueChange={(value) => {
          const next = Number(value);
          if (Number.isFinite(next) && next !== page) onPageChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger size="sm" aria-label="Go to page">
          {/* Zonder deze functie toont Base UI de rauwe waarde: "40" zonder context. */}
          <SelectValue>{(value) => `Page ${value} of ${totalPages}`}</SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-72 min-w-(--anchor-width)">
          {pages.map((entry) => (
            <SelectItem key={entry} value={String(entry)}>
              {`Page ${entry}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label="Next page"
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
      >
        <RiArrowRightSLine className="h-4 w-4" />
      </Button>
    </div>
  );
}
