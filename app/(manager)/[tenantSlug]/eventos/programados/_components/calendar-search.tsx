'use client'

import { Search, SearchX } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { dayLabelInline } from '@/components/reservations/day-labels'
import { StatusPill } from '@/components/reservations/status-pill'
import { Button } from '@/components/ui/button'
import { ExportButton } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { SearchField } from '@/components/ui/input'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { monthName } from '@/lib/dates/format'
import { calendarHref, editReservationHref } from '@/lib/salon/calendar-links'
import { searchReservations } from '@/lib/salon/segment-actions'
import type { ReservationSearchResult } from '@/lib/salon/segment-rows'
import { SEGMENT_LABELS } from '@/lib/salon/segments-copy'

const MIN_CHARS = 2
const MAX_CHARS = 60
const DEBOUNCE_MS = 300
const SEARCH_ERROR = 'No pudimos buscar. Probá de nuevo.'

/** Resultado atado al texto que lo pidió: con otro texto tipeado, no se muestra. */
type SearchState =
  | { q: string; status: 'ready'; items: ReservationSearchResult[] }
  | { q: string; status: 'error'; message: string }

/** Descarga del mes visible: la misma ruta GET que usaba la lista (deja registro en audit). */
function exportHref(slug: string, ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const last = y && m ? new Date(Date.UTC(y, m, 0)).getUTCDate() : 31
  const params = new URLSearchParams({
    slug,
    from: `${ym}-01`,
    to: `${ym}-${String(last).padStart(2, '0')}`,
  })
  return `/api/reservas/export?${params.toString()}`
}

/** Saca ?buscar de la URL (un link con ?buscar= abre el buscador una sola vez). */
function dropSearchParam() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('buscar')) return
  url.searchParams.delete('buscar')
  window.history.replaceState(null, '', `${url.pathname}${url.search}`)
}

/**
 * "Buscar" del calendario. Busca por nombre o teléfono en cualquier fecha y, en
 * lugar de llevar a la ficha, abre el día con la reserva resaltada: se la ve en
 * su contexto (el servicio, el evento, cómo viene el cupo). "Editar" queda como
 * segunda acción y, al guardar, vuelve al calendario. Al pie, exportar el mes
 * visible.
 *
 * El texto buscado nunca se loguea: puede ser un nombre o un teléfono.
 */
export function CalendarSearch({
  tenantSlug,
  ym,
  initialQuery,
}: {
  tenantSlug: string
  /** Mes visible del calendario: el del export y el que decide si abrir el día sin navegar. */
  ym: string
  /** ?buscar=: abre el buscador con ese texto. */
  initialQuery?: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(Boolean(initialQuery))
  const [query, setQuery] = useState(initialQuery ?? '')
  const [result, setResult] = useState<SearchState | null>(null)
  const requestRef = useRef(0)
  // Al elegir un resultado se abre la vista del día: la hoja no tiene que
  // devolverle el foco al botón "Buscar" y robárselo al diálogo nuevo.
  const navigatingRef = useRef(false)

  const term = query.trim()
  const month = monthName(Number(ym.slice(5, 7))) || 'el mes'

  // Solo el último pedido escribe; además cada resultado lleva el texto que
  // lo pidió, así una respuesta atrasada de "lo" no se muestra con "lop".
  const runSearch = useCallback(
    async (q: string) => {
      const id = ++requestRef.current
      let next: SearchState
      try {
        const res = await searchReservations(tenantSlug, q)
        next = res.ok
          ? { q, status: 'ready', items: res.data }
          : { q, status: 'error', message: res.message || SEARCH_ERROR }
      } catch (error) {
        // Red caída o deploy nuevo en el medio. Sin el texto buscado en el log.
        console.error('[calendario.buscar]', error instanceof Error ? error.message : error)
        next = { q, status: 'error', message: SEARCH_ERROR }
      }
      if (id === requestRef.current) setResult(next)
    },
    [tenantSlug],
  )

  // Debounce de 300 ms: no se pega una búsqueda por cada tecla.
  useEffect(() => {
    if (!open || term.length < MIN_CHARS) return
    const timer = window.setTimeout(() => void runSearch(term), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [open, term, runSearch])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) dropSearchParam()
  }

  function openResult(r: ReservationSearchResult) {
    navigatingRef.current = true
    setOpen(false)
    const href = calendarHref(tenantSlug, {
      day: r.reservation_date,
      segment: r.segment,
      focusId: r.id,
    })
    // Mismo mes: se abre el día sin pedir nada al server (el mes ya está
    // cargado) y el Atrás lo cierra. Otro mes: navegación real, así el mes de
    // fondo es el de la reserva y el día llega precargado.
    if (r.reservation_date.slice(0, 7) === ym) window.history.pushState(null, '', href)
    else router.push(href)
  }

  const shown = result && result.q === term ? result : null
  const searching = term.length >= MIN_CHARS && shown === null
  // Lo que se anuncia al lector de pantalla: el estado, no la lista entera.
  const liveText = searching
    ? 'Buscando…'
    : shown?.status === 'error'
      ? shown.message
      : shown?.status === 'ready'
        ? shown.items.length === 1
          ? '1 reserva encontrada'
          : `${shown.items.length} reservas encontradas`
        : ''

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button type="button" variant="secondary" data-tour="eventos-buscar">
          <Search aria-hidden />
          Buscar
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        size="md"
        onOpenAutoFocus={(e) => {
          // El foco va directo al buscador (no a la X de la hoja).
          e.preventDefault()
          ;(e.currentTarget as HTMLElement | null)
            ?.querySelector<HTMLInputElement>('[data-slot="search-field"] input')
            ?.focus()
        }}
        onCloseAutoFocus={(e) => {
          if (navigatingRef.current) {
            e.preventDefault()
            navigatingRef.current = false
          }
        }}
      >
        <SheetHeader className="gap-3">
          <div className="grid gap-1">
            <SheetTitle>Buscar reservas</SheetTitle>
            <SheetDescription>
              Por nombre o teléfono, en cualquier fecha. Tocá una para verla en su día.
            </SheetDescription>
          </div>
          <SearchField
            name="buscar"
            inputMode="search"
            enterKeyHint="search"
            value={query}
            maxLength={MAX_CHARS}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery('')}
            placeholder="Nombre o teléfono"
            aria-label="Buscar reserva por nombre o teléfono"
          />
        </SheetHeader>

        <p className="sr-only" aria-live="polite">
          {liveText}
        </p>
        <SheetBody aria-busy={searching || undefined}>
          {term.length < MIN_CHARS ? (
            <p className="text-pretty type-small text-muted-foreground">
              Escribí al menos 2 letras del nombre, o 4 números del teléfono.
            </p>
          ) : searching ? (
            <p className="flex items-center gap-2 type-small text-muted-foreground">
              <Spinner aria-hidden size={16} />
              Buscando…
            </p>
          ) : shown?.status === 'error' ? (
            <ErrorState
              size="sm"
              title="No pudimos buscar"
              description={shown.message}
              onRetry={() => {
                setResult(null)
                void runSearch(term)
              }}
            />
          ) : shown?.status === 'ready' && shown.items.length === 0 ? (
            <EmptyState
              size="sm"
              icon={SearchX}
              title="No encontramos reservas"
              description={`Nada con «${term}». Probá con el apellido o con otro pedazo del teléfono.`}
            />
          ) : shown?.status === 'ready' ? (
            <ul className="divide-y divide-border overflow-clip rounded-xl border border-border bg-card">
              {shown.items.map((r) => (
                <li key={r.id} className="flex items-start gap-1">
                  <button
                    type="button"
                    onClick={() => openResult(r)}
                    className="grid min-w-0 flex-1 gap-1 px-3 py-2.5 text-left outline-(--ring) -outline-offset-2 hover:bg-hover focus-visible:outline-2 active:bg-active"
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate type-body font-medium">{r.guest_name}</span>
                      <StatusPill status={r.status} className="shrink-0" />
                    </span>
                    <span className="block type-caption tabular-nums text-muted-foreground">
                      {dayLabelInline(r.reservation_date)} · {r.reservation_time_local} ·{' '}
                      {r.guests === 1 ? '1 persona' : `${r.guests} personas`} ·{' '}
                      {SEGMENT_LABELS[r.segment]}
                      {r.eventName ? ` · ${r.eventName}` : ''}
                    </span>
                  </button>
                  <Button asChild variant="ghost" size="sm" className="m-1.5 shrink-0">
                    <Link
                      href={editReservationHref(tenantSlug, r.id, { from: 'calendario' })}
                      aria-label={`Editar la reserva de ${r.guest_name}`}
                    >
                      Editar
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </SheetBody>

        <SheetFooter className="items-stretch">
          <ExportButton href={exportHref(tenantSlug, ym)} label={`Exportar ${month}`} />
          <p className="text-center type-caption text-muted-foreground">
            Todas las reservas del mes en una planilla (CSV).
          </p>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
