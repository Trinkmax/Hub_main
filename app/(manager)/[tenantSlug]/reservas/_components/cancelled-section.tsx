'use client'

import { ChevronDown, XCircle } from 'lucide-react'
import Link from 'next/link'
import { useId, useState } from 'react'
import { dayLabel } from '@/components/reservations/day-labels'
import { editReservationHref } from '@/lib/salon/calendar-links'
import { hhmm } from '@/lib/salon/format'
import type { ReservationWithJoins } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/**
 * Las reservas canceladas del período, aparte del listado activo.
 *
 * El dueño: "aparece junto a las activas y puede confundir, algún día van a
 * errarle y armarla igual". Una fila tachada no alcanza — en medio del servicio
 * nadie lee el estado, lee el nombre y la hora.
 *
 * Por eso no están apagadas dentro de la lista sino FUERA, en un bloque cerrado
 * que hay que abrir a propósito. Que siga estando es importante (alguien va a
 * preguntar "¿esta no había reservado?"), pero cuesta un toque llegar y ya no se
 * puede confundir con la agenda del día.
 *
 * Deliberadamente compacto y sin las columnas de trabajo (asistencia, seña,
 * gestor): no hay nada que operar en una reserva que no va a existir.
 */
export function CancelledSection({
  tenantSlug,
  rows,
  totalCount,
  showDate,
}: {
  tenantSlug: string
  rows: ReservationWithJoins[]
  /** Cuántas hay en total; `rows` puede venir recortado. */
  totalCount: number
  /** Modo rango: la fecha cambia entre filas y hay que mostrarla. */
  showDate: boolean
}) {
  const [open, setOpen] = useState(false)
  const listId = useId()

  if (totalCount === 0) return null

  return (
    <section
      aria-label="Reservas canceladas"
      className="overflow-clip rounded-xl border border-dashed border-border-strong"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={listId}
        className="flex min-h-12 w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-3 text-left outline-(--ring) -outline-offset-2 hover:bg-hover focus-visible:outline-2"
      >
        <XCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="type-label text-foreground">
          {totalCount} {totalCount === 1 ? 'reserva cancelada' : 'reservas canceladas'}
        </span>
        <span className="type-caption text-muted-foreground">
          · no cuentan para cubiertos ni para armar mesas
        </span>
        <ChevronDown
          className={cn('ml-auto size-4 shrink-0 text-muted-foreground', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open ? (
        <ul id={listId} className="divide-y divide-border border-t border-border">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={editReservationHref(tenantSlug, r.id)}
                className="flex min-h-11 flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 type-body text-muted-foreground outline-(--ring) -outline-offset-2 hover:bg-hover hover:text-foreground focus-visible:outline-2"
              >
                {showDate ? (
                  <span className="type-caption tabular-nums">{dayLabel(r.reservation_date)}</span>
                ) : null}
                <span className="type-caption tabular-nums">{hhmm(r.reservation_time_local)}</span>
                <span className="font-medium line-through">{r.guest_name}</span>
                <span className="type-caption tabular-nums">
                  {r.estimated_guests} {r.estimated_guests === 1 ? 'persona' : 'personas'}
                </span>
                {r.cancelled_reason ? (
                  <span className="type-caption italic">· {r.cancelled_reason}</span>
                ) : null}
              </Link>
            </li>
          ))}
          {rows.length < totalCount ? (
            <li className="px-4 py-2 type-caption text-muted-foreground">
              y {totalCount - rows.length} más. Filtrá por estado «Cancelada» para verlas todas.
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  )
}
