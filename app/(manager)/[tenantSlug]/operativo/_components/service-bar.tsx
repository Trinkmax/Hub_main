'use client'

import { CalendarPlus, ScanLine } from 'lucide-react'
import Link from 'next/link'
import { type Ref, useImperativeHandle, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { formatNumber } from '@/lib/format/number-kind'
import { BOARD_FILTER_LABELS, type BoardFilter, type FilterCounts } from '@/lib/salon/operativo'
import { cn } from '@/lib/utils'

const FILTERS: BoardFilter[] = ['all', 'waiting', 'inside', 'done']

/**
 * La barra de trabajo: búsqueda + filtros, pegada bajo el topbar del panel
 * (`top-(--topbar-h)`, z menor que el topbar). Es lo único sticky de la
 * pantalla: la anfitriona tiene que poder buscar con el pulgar esté donde esté
 * en la lista. Papel sólido con un pelo abajo, como el topbar (sin vidrio).
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
  /** El `<input>` del buscador: el tablero lo enfoca con «/» y lo reconoce con Esc. */
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
  const searchWrap = useRef<HTMLDivElement>(null)
  // El SearchField se queda con su propio ref (lo usa «Limpiar» para devolver
  // el foco); al tablero se le pasa el <input> de adentro.
  useImperativeHandle(ref, () => searchWrap.current?.querySelector('input') as HTMLInputElement, [])
  const railPct = Math.round(Math.min(1, Math.max(0, progress)) * 100)

  return (
    <div className="sticky top-(--topbar-h) z-10 -mx-4 mt-4 border-b border-border bg-background px-4 py-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
      {/* Mini rail: adentro / reservados. */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-border',
          'transition-opacity duration-(--duration-quick) ease-(--ease-ui) motion-reduce:transition-none',
          showRail ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div
          className="h-full w-full bg-success transition-transform duration-220 ease-ui motion-reduce:transition-none"
          style={{ transform: `translateX(-${100 - railPct}%)` }}
        />
      </div>

      <div className="flex items-center gap-2">
        <div ref={searchWrap} className="relative min-w-0 flex-1">
          <SearchField
            name="buscar"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onClear={() => onQuery('')}
            placeholder="Buscar nombre, teléfono, mesa…"
            aria-label="Buscar reserva por nombre, teléfono, mesa o gestor"
            inputMode="search"
            enterKeyHint="search"
            autoCorrect="off"
            spellCheck={false}
          />
          {searching ? null : (
            <Kbd
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 lg:inline-flex"
            >
              /
            </Kbd>
          )}
        </div>

        {/* En pantallas chicas las acciones globales viven acá, a mano. */}
        <div className="flex shrink-0 items-center gap-2 sm:hidden">
          {canAward ? (
            <Button asChild variant="secondary" size="icon" aria-label="Escanear QR del socio">
              <Link href={`/${tenantSlug}/acreditar`} prefetch={false}>
                <ScanLine aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
          <Button asChild size="icon" aria-label="Nueva reserva">
            <Link href={`/${tenantSlug}/reservas/nuevo?date=${date}`} prefetch={false}>
              <CalendarPlus aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-2">
        {searching ? (
          <p
            className="flex min-h-(--control-md) items-center type-small text-muted-foreground"
            aria-live="polite"
          >
            {resultCount === 0
              ? 'Nadie con ese nombre en este día'
              : `${resultCount} ${resultCount === 1 ? 'coincidencia' : 'coincidencias'} · en todos los estados`}
          </p>
        ) : (
          // Si los filtros no entran (celular angosto), la fila se desliza: nunca se cortan.
          <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
            <SegmentedControl<BoardFilter>
              aria-label="Filtrar por estado"
              value={filter}
              onValueChange={onFilter}
              className="max-w-none"
              items={FILTERS.map((f) => ({
                value: f,
                label: (
                  <>
                    {BOARD_FILTER_LABELS[f]}
                    <span className="type-caption type-amount">{formatNumber(counts[f])}</span>
                    {f === 'waiting' && late > 0 ? (
                      <span className="type-caption font-medium text-warning-text">
                        · {late} tarde
                      </span>
                    ) : null}
                  </>
                ),
              }))}
            />
          </div>
        )}
      </div>
    </div>
  )
}
