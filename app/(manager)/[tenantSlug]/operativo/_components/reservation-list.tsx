'use client'

import { CalendarPlus, CalendarX2, ChevronDown, SearchX } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { BoardFilter } from '@/lib/salon/operativo'
import { BOARD_FILTER_LABELS } from '@/lib/salon/operativo'
import type { ServiceBucket } from '@/lib/salon/services'
import type { ReservationWithJoins } from '@/lib/salon/types'
import { cn } from '@/lib/utils'
import { NowDivider } from './now-divider'

/**
 * La lista de la noche, cortada por SERVICIO (merienda, cena…) y en orden de
 * hora. El encabezado de cada servicio dice cuántos cubiertos y cuántas mesas
 * hay que armar; la línea de "ahora" se cuela donde corresponde.
 *
 * Nada acá es sticky: la barra de búsqueda ya lo es y con dos cosas pegadas
 * el celular se queda sin pantalla.
 */
export function ReservationList({
  groups,
  total,
  searching,
  query,
  filter,
  eventFilter,
  onClearEventFilter,
  markerIndex,
  nowLabel,
  cancelled,
  tenantSlug,
  date,
  isToday,
  emptyAll,
  renderCard,
}: {
  groups: Array<ServiceBucket<ReservationWithJoins>>
  total: number
  searching: boolean
  query: string
  filter: BoardFilter
  eventFilter: string | null
  onClearEventFilter: () => void
  /** Posición del marcador de "ahora" sobre la lista plana; `null` = sin marcador. */
  markerIndex: number | null
  nowLabel: string | null
  cancelled: ReservationWithJoins[]
  tenantSlug: string
  date: string
  isToday: boolean
  /** No hay NINGUNA reserva operable en el día (distinto de "el filtro no deja nada"). */
  emptyAll: boolean
  renderCard: (r: ReservationWithJoins, flatIndex: number) => ReactNode
}) {
  const reduced = useReducedMotion()
  const [showCancelled, setShowCancelled] = useState(false)
  const scrolledRef = useRef(false)

  // Una sola vez al abrir HOY: dejar la línea de "ahora" a la vista, si hay
  // reservas que ya pasaron (si no, arriba de todo ya está bien).
  useEffect(() => {
    if (!isToday || scrolledRef.current || markerIndex === null || markerIndex === 0) return
    scrolledRef.current = true
    const el = document.querySelector<HTMLElement>('[data-now-marker]')
    if (!el) return
    const timer = window.setTimeout(() => {
      el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [isToday, markerIndex, reduced])

  if (emptyAll && !searching) {
    return (
      <div className="card-hairline mt-4 rounded-2xl border bg-card p-10 text-center">
        <CalendarX2 className="mx-auto size-9 text-muted-foreground/60" aria-hidden />
        <h2 className="mt-3 font-serif text-lg font-semibold">
          {isToday ? 'Nada reservado para hoy' : 'Nada reservado para este día'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground text-balance">
          Si entra una reserva, aparece acá sola.
        </p>
        <Button asChild variant="outline" className="mt-5 h-11 gap-2 rounded-full">
          <Link href={`/${tenantSlug}/reservas/nuevo?date=${date}`} prefetch={false}>
            <CalendarPlus className="size-4" aria-hidden />
            Cargar una reserva
          </Link>
        </Button>
      </div>
    )
  }

  if (total === 0) {
    return (
      <div className="card-hairline mt-4 rounded-2xl border bg-card p-8 text-center">
        <SearchX className="mx-auto size-8 text-muted-foreground/60" aria-hidden />
        {searching ? (
          <>
            <h2 className="mt-3 font-serif text-lg font-semibold">
              Nadie con «{query.trim()}» hoy
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Probá con el apellido o los últimos dígitos del teléfono.
            </p>
            <Button asChild variant="outline" className="mt-5 h-11 gap-2 rounded-full">
              <Link
                href={`/${tenantSlug}/reservas/nuevo?date=${date}&guest_name=${encodeURIComponent(query.trim())}`}
                prefetch={false}
              >
                <CalendarPlus className="size-4" aria-hidden />
                Nueva reserva para «{query.trim()}»
              </Link>
            </Button>
          </>
        ) : (
          <>
            <h2 className="mt-3 font-serif text-lg font-semibold">
              Nada en «{BOARD_FILTER_LABELS[filter]}»{eventFilter ? ' para ese evento' : ''}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {filter === 'waiting'
                ? 'Todos los que reservaron ya están adentro.'
                : 'Cambiá el filtro para ver el resto.'}
            </p>
            {eventFilter ? (
              <Button variant="ghost" className="mt-4" onClick={onClearEventFilter}>
                Quitar filtro de evento
              </Button>
            ) : null}
          </>
        )}
      </div>
    )
  }

  let flat = 0
  return (
    <div className="mt-4 space-y-6">
      {eventFilter && !searching ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-secondary/40 px-3 py-2 text-sm">
          <span>Mostrando solo las reservas de ese evento.</span>
          <Button variant="ghost" size="sm" className="h-8" onClick={onClearEventFilter}>
            Ver todas
          </Button>
        </div>
      ) : null}

      {groups.map((group) => {
        const startIndex = flat
        flat += group.rows.length
        return (
          <section
            key={group.mealType}
            aria-label={`${group.label}: ${group.rows.length} reservas`}
          >
            <header className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-1">
              <h2 className="font-serif text-lg font-semibold tracking-tight">{group.label}</h2>
              <p className="text-xs text-muted-foreground tabular-nums">
                <strong className="font-semibold text-foreground">{group.covers}</strong> cubiertos
                {' · '}
                {group.activeCount} {group.activeCount === 1 ? 'mesa' : 'mesas'}
                {group.byZone.planta_alta > 0 || group.byZone.planta_baja > 0 ? (
                  <>
                    {' · '}
                    <span className="whitespace-nowrap">
                      PA {group.byZone.planta_alta} · PB {group.byZone.planta_baja}
                    </span>
                  </>
                ) : null}
                {group.cakes > 0 ? (
                  <>
                    {' · '}
                    <span className="text-warning-text">
                      {group.cakes} {group.cakes === 1 ? 'torta' : 'tortas'}
                    </span>
                  </>
                ) : null}
              </p>
            </header>

            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {group.rows.flatMap((r, i) => {
                  const idx = startIndex + i
                  const isLast = groups[groups.length - 1] === group
                  const items = []
                  // La línea de "ahora" va antes de la primera reserva futura;
                  // si ya pasaron todas, al final del último servicio.
                  if (markerIndex === idx) items.push(<NowDivider key="now" label={nowLabel} />)
                  items.push(
                    <motion.li
                      key={r.id}
                      layout={reduced ? false : 'position'}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.16 } }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    >
                      {renderCard(r, idx)}
                    </motion.li>,
                  )
                  if (isLast && i === group.rows.length - 1 && markerIndex === idx + 1) {
                    items.push(<NowDivider key="now" label={nowLabel} />)
                  }
                  return items
                })}
              </AnimatePresence>
            </ul>
          </section>
        )
      })}

      {cancelled.length > 0 && !searching && filter === 'all' && !eventFilter ? (
        <section aria-label="Canceladas" className="pt-2">
          <button
            type="button"
            onClick={() => setShowCancelled((v) => !v)}
            aria-expanded={showCancelled}
            className="flex h-11 w-full items-center justify-between rounded-xl px-2 text-sm text-muted-foreground transition-colors hover:bg-(--cream-tint)"
          >
            <span>
              Canceladas{' '}
              <span className="font-mono text-xs tabular-nums">({cancelled.length})</span>
            </span>
            <ChevronDown
              className={cn(
                'size-4 transition-transform duration-(--duration-base)',
                showCancelled && 'rotate-180',
              )}
              aria-hidden
            />
          </button>
          {showCancelled ? (
            <ul className="mt-1 divide-y divide-border/60 rounded-xl border border-border/60 bg-card/60">
              {cancelled.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {r.reservation_time_local.slice(0, 5)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground line-through">
                    {r.guest_name}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {r.estimated_guests}p
                  </span>
                  {r.cancelled_reason ? (
                    <span className="hidden max-w-[14rem] truncate text-xs text-muted-foreground sm:block">
                      {r.cancelled_reason}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
