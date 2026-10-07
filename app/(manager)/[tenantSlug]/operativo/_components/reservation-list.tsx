'use client'

import { CalendarPlus, CalendarX2, ChevronDown, Filter, SearchX } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { PartySizeChips } from '@/components/reservations/party-size-chips'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { EmptyState } from '@/components/ui/empty-state'
import { Section } from '@/components/ui/section'
import type { BoardFilter } from '@/lib/salon/operativo'
import { BOARD_FILTER_LABELS } from '@/lib/salon/operativo'
import {
  type PartySizeBucket,
  type PartySizeTally,
  partySizeAriaLabel,
} from '@/lib/salon/party-size'
import type { ServiceBucket } from '@/lib/salon/services'
import type { ReservationWithJoins } from '@/lib/salon/types'
import { cn } from '@/lib/utils'
import { NowDivider } from './now-divider'

/**
 * Lo que se enfoca con Tab adentro de la lista no queda escondido abajo de lo
 * fijo (WCAG 2.4.11): el topbar (`--topbar-h`) más la barra de búsqueda y
 * filtros, que también es sticky (~7,5 rem con los controles táctiles).
 */
const FOCUS_CLEARANCE = '[&_:is(a,button)]:scroll-mt-[calc(var(--topbar-h)+7.5rem)]'

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
  onShowAll,
  eventFilter,
  eventFilterLabel,
  onClearEventFilter,
  partySize,
  partyTally,
  onPartySize,
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
  /** Vuelve el filtro de estado a «Todas». */
  onShowAll: () => void
  eventFilter: string | null
  /** El nombre del evento filtrado, para que el aviso diga cuál. */
  eventFilterLabel: string | null
  onClearEventFilter: () => void
  /** El tamaño de mesa elegido ("mesas de 4"); `null` = todos. */
  partySize: PartySizeBucket | null
  /** Cuántas mesas hay de cada tamaño en lo que ya está filtrado por estado. */
  partyTally: PartySizeTally
  onPartySize: (bucket: PartySizeBucket | null) => void
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
  const cancelledId = useId()

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

  // "Personas por mesa": cuántas mesas de 2, de 3, de 4… hay en lo que se está
  // mirando, y tocar una filtra. Va acá y no en la barra sticky a propósito: la
  // barra es lo único pegado a la pantalla y el celular se queda sin alto.
  // Con una búsqueda activa no se dibuja, por lo mismo que se ignora el filtro
  // de estado: si escribís "García" querés a García, sea la mesa que sea.
  const sizeChips = searching ? null : (
    <PartySizeChips tally={partyTally} active={partySize} onSelect={onPartySize} className="mt-4" />
  )
  const newReservationHref = `/${tenantSlug}/reservas/nuevo?date=${date}`

  if (emptyAll && !searching) {
    return (
      <EmptyState
        className="mt-4"
        icon={CalendarX2}
        title={isToday ? 'Nada reservado para hoy' : 'Nada reservado para este día'}
        description="Si entra una reserva, aparece acá sola. También podés cargarla vos."
        action={
          <Button asChild variant="secondary">
            <Link href={newReservationHref} prefetch={false}>
              <CalendarPlus aria-hidden="true" />
              Cargar una reserva
            </Link>
          </Button>
        }
      />
    )
  }

  if (total === 0) {
    const q = query.trim()
    return (
      <>
        {sizeChips}
        {searching ? (
          <EmptyState
            className="mt-4"
            icon={SearchX}
            title={`Nadie con «${q}» ${isToday ? 'hoy' : 'este día'}`}
            description="Probá con el apellido o los últimos dígitos del teléfono."
            action={
              <Button asChild variant="secondary">
                <Link
                  href={`${newReservationHref}&guest_name=${encodeURIComponent(q)}`}
                  prefetch={false}
                >
                  <CalendarPlus aria-hidden="true" />
                  Nueva reserva para «{q}»
                </Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            className="mt-4"
            icon={SearchX}
            title={
              <>
                {partySize
                  ? `No hay ${partySizeAriaLabel(partySize)}`
                  : `Nada en «${BOARD_FILTER_LABELS[filter]}»`}
                {partySize && filter !== 'all' ? ` en «${BOARD_FILTER_LABELS[filter]}»` : ''}
                {eventFilter ? ' para ese evento' : ''}
              </>
            }
            description={
              partySize
                ? 'Tocá «Todas» para ver el resto de los tamaños.'
                : filter === 'waiting'
                  ? 'Todos los que reservaron ya están adentro.'
                  : 'Cambiá el filtro para ver el resto.'
            }
            action={
              partySize || eventFilter || filter !== 'all' ? (
                <>
                  {partySize ? (
                    <Button variant="secondary" onClick={() => onPartySize(null)}>
                      Ver todos los tamaños
                    </Button>
                  ) : null}
                  {eventFilter ? (
                    <Button variant="secondary" onClick={onClearEventFilter}>
                      Quitar filtro de evento
                    </Button>
                  ) : null}
                  {!partySize && filter !== 'all' ? (
                    <Button variant="secondary" onClick={onShowAll}>
                      Ver todas
                    </Button>
                  ) : null}
                </>
              ) : null
            }
          />
        )}
      </>
    )
  }

  let flat = 0
  return (
    <>
      {sizeChips}
      <div className={cn('mt-4 flex flex-col gap-6', FOCUS_CLEARANCE)}>
        {eventFilter && !searching ? (
          <Callout
            tone="neutral"
            icon={Filter}
            action={
              <Button variant="secondary" size="sm" onClick={onClearEventFilter}>
                Ver todas
              </Button>
            }
          >
            Mostrando solo las reservas de{' '}
            {eventFilterLabel ? (
              <strong className="font-medium text-foreground">{eventFilterLabel}</strong>
            ) : (
              'ese evento'
            )}
            .
          </Callout>
        ) : null}

        {groups.map((group) => {
          const startIndex = flat
          flat += group.rows.length
          return (
            <Section
              key={group.mealType}
              title={group.label}
              className="gap-2"
              description={
                <span className="tabular-nums">
                  <strong className="font-semibold text-foreground">{group.covers}</strong>{' '}
                  cubiertos
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
                </span>
              }
            >
              <ul className="flex flex-col gap-2">
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
            </Section>
          )
        })}

        {cancelled.length > 0 && !searching && filter === 'all' && !eventFilter ? (
          <section aria-label="Canceladas" className="pt-2">
            <button
              type="button"
              onClick={() => setShowCancelled((v) => !v)}
              aria-expanded={showCancelled}
              aria-controls={cancelledId}
              className="flex min-h-11 w-full items-center justify-between rounded-lg px-2 type-body text-muted-foreground outline-(--ring) -outline-offset-2 hover:bg-hover hover:text-foreground focus-visible:outline-2"
            >
              <span>
                Canceladas <span className="type-caption type-amount">({cancelled.length})</span>
              </span>
              <ChevronDown
                className={cn(
                  'size-4 transition-transform duration-(--duration-quick) ease-(--ease-ui) motion-reduce:transition-none',
                  showCancelled && 'rotate-180',
                )}
                aria-hidden="true"
              />
            </button>
            <ul
              id={cancelledId}
              hidden={!showCancelled}
              className="mt-1 divide-y divide-border rounded-xl border border-border bg-card"
            >
              {cancelled.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2.5 type-body">
                  <span className="w-12 shrink-0 type-caption text-muted-foreground type-amount">
                    {r.reservation_time_local.slice(0, 5)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground line-through">
                    {r.guest_name}
                  </span>
                  <span className="shrink-0 type-caption text-muted-foreground type-amount">
                    {r.estimated_guests}p
                  </span>
                  {r.cancelled_reason ? (
                    <span className="hidden max-w-[14rem] truncate type-caption text-muted-foreground sm:block">
                      {r.cancelled_reason}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  )
}
