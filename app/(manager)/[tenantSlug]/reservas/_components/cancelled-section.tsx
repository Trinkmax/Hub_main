'use client'

import { ChevronDown, XCircle } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { formatDayLabel } from '@/lib/salon/date-presets'
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

  if (totalCount === 0) return null

  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-card/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left transition-colors hover:bg-secondary/50"
      >
        <XCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium text-muted-foreground">
          {totalCount} {totalCount === 1 ? 'reserva cancelada' : 'reservas canceladas'}
        </span>
        <span className="text-xs text-muted-foreground">
          · no cuentan para cubiertos ni para armar mesas
        </span>
        <ChevronDown
          className={cn(
            'ml-auto size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <ul className="space-y-1 border-t border-border/50 px-3 py-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/${tenantSlug}/reservas/${r.id}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary"
              >
                {showDate ? (
                  <span className="font-mono text-xs tabular-nums">
                    {formatDayLabel(r.reservation_date)}
                  </span>
                ) : null}
                <span className="font-mono text-xs tabular-nums">
                  {hhmm(r.reservation_time_local)}
                </span>
                <span className="font-medium line-through">{r.guest_name}</span>
                <span className="text-xs tabular-nums">{r.estimated_guests}p</span>
                {r.cancelled_reason ? (
                  <span className="text-xs italic">· {r.cancelled_reason}</span>
                ) : null}
              </Link>
            </li>
          ))}
          {rows.length < totalCount ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              y {totalCount - rows.length} más. Filtrá por estado «Cancelada» para verlas todas.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
