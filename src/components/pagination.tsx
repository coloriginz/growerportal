'use client'

import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/* Beheerd bestand van @col/pagination — niet lokaal aanpassen.
   Bijwerken: npx shadcn add @col/pagination --overwrite */

export const PAGINATION_VERSION = '1.0.0'

export interface PaginationLabels {
  /** Toegankelijke naam van de vorige-knop. Default 'Previous page'. */
  previous?: string
  /** Toegankelijke naam van de volgende-knop. Default 'Next page'. */
  next?: string
  /** Toegankelijke naam van de paginakiezer. Default 'Go to page'. */
  picker?: string
  /** Tekst op de kiezer. Default '40 / 55' — bewust taalneutraal. */
  page?: (page: number, totalPages: number) => string
  /** Tekst per regel in de lijst. Default het paginanummer. */
  pageItem?: (page: number, totalPages: number) => string
}

export interface PaginationProps {
  /** Huidige pagina, 1-based. */
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  /** Blokkeert alle drie de besturingselementen, bijvoorbeeld tijdens het laden. */
  disabled?: boolean
  className?: string
  labels?: PaginationLabels
}

/**
 * Vorige, een paginakiezer en volgende. De kiezer is het punt: zonder hem kost
 * pagina 40 van 55 negenendertig klikken op Next.
 *
 * Controlled — dit component houdt geen paginanummer bij en haalt niets op. Bij
 * één pagina of minder rendert het niets, zodat de aanroeper er geen
 * `totalPages > 1` omheen hoeft te zetten.
 */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  disabled,
  className,
  labels,
}: PaginationProps) {
  if (totalPages <= 1) return null

  const current = Math.min(Math.max(page, 1), totalPages)
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1)
  const pageLabel = labels?.page ?? ((value: number, total: number) => `${value} / ${total}`)
  const itemLabel = labels?.pageItem ?? ((value: number) => String(value))

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label={labels?.previous ?? 'Previous page'}
        disabled={disabled || current <= 1}
        onClick={() => onPageChange(current - 1)}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <DropdownMenu>
        {/* Geen <Button asChild> in de trigger: de helft van de consumers draait
            op Base UI en kent dat idioom niet. Zie AGENTS.md regel 5. */}
        <DropdownMenuTrigger
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'h-8 gap-1.5 tabular-nums'
          )}
          aria-label={labels?.picker ?? 'Go to page'}
          disabled={disabled}
        >
          {pageLabel(current, totalPages)}
          <ChevronDown className="h-4 w-4 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="max-h-72 min-w-24 overflow-y-auto">
          {pages.map((entry) => (
            <DropdownMenuItem
              key={entry}
              onClick={() => onPageChange(entry)}
              className={cn(
                'cursor-pointer justify-end tabular-nums',
                entry === current && 'bg-accent font-medium'
              )}
            >
              {itemLabel(entry, totalPages)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label={labels?.next ?? 'Next page'}
        disabled={disabled || current >= totalPages}
        onClick={() => onPageChange(current + 1)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
