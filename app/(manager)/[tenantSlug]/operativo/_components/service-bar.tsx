'use client'

import { CalendarPlus, ScanLine, Search, X } from 'lucide-react'
import Link from 'next/link'
import type { Ref } from 'react'
import { Button } from '@/components/ui/button'
import { BOARD_FILTER_LABELS, type BoardFilter, type FilterCounts } from '@/lib/salon/operativo'
import { cn } from '@/lib/utils'

const FILTERS: BoardFilter[] = ['all', 'waiting', 'inside', 'done']

/**
 * La barra de trabajo: búsqueda + filtros, pegada bajo el topbar del manager
 * (`top-14`, z menor que el topbar). Es lo único sticky de la pantalla: la
 * anfitriona tiene que poder buscar con el pulgar esté donde esté en la lista.
 *
 * El "mini rail" de 2 px es la continuidad del pulso: cuando la tarjeta grande
 * ya se fue de la vista, la barrita dice cuánta gente entró sin volver arriba.
 */
export function ServiceBar({
  ref,
  query,
  onQuery,
  filter,
  onFilter,
  counts,
  late,
  progress,
  showRail,
  resultCount,
  tenantSlug,
  date,
  canAward,
}: {
  ref?: Ref<HTMLInputElement>
  query: string
  onQuery: (q: string) => void
  filter: BoardFilter
  onFilter: (f: BoardFilter) => void
  counts: FilterCounts
  late: number
  progress: number
  showRail: boolean
  /** Cuántas coinciden con la búsqueda; `null` sin búsqueda. */
  resultCount: number | null
  tenantSlug: string
  date: string
  canAward: boolean
}) {
  const searching = query.trim().length > 0

  return (
    <div className="sticky top-14 z-10 -mx-4 mt-4 border-b border-border/60 bg-background/90 px-4 pb-2 pt-2 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75 sm:-mx-6 sm:px-6 lg:-mx-0 lg:rounded-b-2xl lg:border-x lg:px-4">
      {/* Mini rail: adentro / reservados. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden transition-opacity duration-(--duration-base)',
          showRail ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div className="h-full w-full bg-border">
          <div
            className="h-full bg-success transition-[width] duration-(--duration-slower) ease-(--ease-out)"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Buscar reserva por nombre, teléfono, mesa o gestor</span>
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            ref={ref}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Buscar nombre, teléfono, mesa…"
            className="h-11 w-full rounded-full border border-border/70 bg-card pl-10 pr-10 text-base shadow-xs outline-none transition-[box-shadow,border-color] duration-(--duration-fast) placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/40 md:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {searching ? (
            <button
              type="button"
              aria-label="Limpiar búsqueda"
              onClick={() => onQuery('')}
              className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border/70 bg-secondary px-1.5 font-mono text-[10px] text-muted-foreground lg:block">
              /
            </kbd>
          )}
        </label>

        {/* En pantallas chicas las acciones globales viven acá, a mano. */}
        <div className="flex shrink-0 items-center gap-1.5 sm:hidden">
          {canAward ? (
            <Button
              asChild
              variant="outline"
              size="icon"
              className="size-11 rounded-full"
              aria-label="Escanear QR del socio"
            >
              <Link href={`/${tenantSlug}/acreditar`} prefetch={false}>
                <ScanLine className="size-5" aria-hidden />
              </Link>
            </Button>
          ) : null}
          <Button asChild size="icon" className="size-11 rounded-full" aria-label="Nueva reserva">
            <Link href={`/${tenantSlug}/reservas/nuevo?date=${date}`} prefetch={false}>
              <CalendarPlus className="size-5" aria-hidden />
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        {searching ? (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {resultCount === 0
              ? 'Nadie con ese nombre hoy'
              : `${resultCount} ${resultCount === 1 ? 'coincidencia' : 'coincidencias'} · en todos los estados`}
          </p>
        ) : (
          <ul
            aria-label="Filtrar por estado"
            className="-mx-4 flex snap-x gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
          >
            {FILTERS.map((f) => {
              const active = filter === f
              const count = counts[f]
              return (
                <li key={f} className="shrink-0 snap-start">
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onFilter(f)}
                    className={cn(
                      'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-[background-color,color,border-color] duration-(--duration-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border/70 bg-card text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {BOARD_FILTER_LABELS[f]}
                    <span
                      className={cn(
                        'font-mono text-[11px] tabular-nums',
                        active ? 'opacity-80' : 'text-muted-foreground/80',
                      )}
                    >
                      {count}
                    </span>
                    {f === 'waiting' && late > 0 ? (
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-px font-mono text-[10px] font-semibold tabular-nums',
                          active ? 'bg-background/20' : 'bg-warning/25 text-warning-text',
                        )}
                        title={`${late} atrasada${late === 1 ? '' : 's'}`}
                      >
                        {late} tarde
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
