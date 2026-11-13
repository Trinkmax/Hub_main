'use client'

import { Cake, Loader2, Minus, Plus, Star } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatCentsShort } from '@/lib/money/format'
import { openTable } from '@/lib/pos/actions'
import { posFont } from '@/lib/pos/font'
import { serviceMinutesOf, type TableState, tablesOfLabel } from '@/lib/pos/table-state'
import type { FloorReservation } from '@/lib/pos/types'
import { cn } from '@/lib/utils'

/**
 * Abrir una mesa: dos toques. El primero fue la mesa; el segundo es cuántos son
 * (cada número abre directo) o, si hay una reserva por llegar, quiénes son: en
 * ese caso el nombre, la seña, las notas y el socio vienen con ella.
 */

type Props = {
  slug: string
  table: { tableId: string; label: string; capacity: number | null; state: TableState } | null
  reservations: readonly FloorReservation[]
  nowService: number
  onClose: () => void
  onOpened: (sessionId: string) => void
}

const QUICK = [1, 2, 3, 4, 5, 6, 7, 8]

export function OpenTableSheet({
  slug,
  table,
  reservations,
  nowService,
  onClose,
  onOpened,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [count, setCount] = useState(9)

  useEffect(() => {
    if (table) {
      setBusy(null)
      setMore(false)
      setCount(Math.max(9, table.capacity ?? 9))
    }
  }, [table])

  // Primero la reserva de ESTA mesa; después las que están por llegar sin mesa (o con otra), por cercanía.
  const suggestions = useMemo(() => {
    if (!table) return []
    const wanted = table.label.trim().toLowerCase()
    return reservations
      .map((r) => {
        const at = serviceMinutesOf(r.time)
        const away = at === null ? 9999 : at - nowService
        const mine = tablesOfLabel(r.table_label).includes(wanted)
        return { r, away, mine }
      })
      .filter(({ away, mine, r }) => mine || r.status === 'arrived' || (away <= 60 && away >= -90))
      .sort(
        (a, b) =>
          Number(b.mine) - Number(a.mine) ||
          Number(b.r.status === 'arrived') - Number(a.r.status === 'arrived') ||
          Math.abs(a.away) - Math.abs(b.away),
      )
      .slice(0, 4)
  }, [table, reservations, nowService])

  const open = async (key: string, partySize: number, reservationId?: string) => {
    if (!table || busy) return
    setBusy(key)
    const result = await openTable(slug, { tableId: table.tableId, partySize, reservationId })
    if (!result.ok) {
      setBusy(null)
      toast.error(result.message)
      return
    }
    onOpened(result.data.sessionId)
  }

  return (
    <Sheet open={table !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        showClose={false}
        className={cn('pos pos-sheet', posFont.variable)}
      >
        <SheetGrabber />
        {table ? (
          <div className="pos-sheet-body">
            <div className="flex items-baseline gap-3">
              <SheetTitle className="pos-sheet-title">Mesa {table.label}</SheetTitle>
              {table.capacity ? (
                <span className="pos-sheet-hint">entran {table.capacity}</span>
              ) : null}
            </div>
            <SheetDescription className="sr-only">
              Elegí la reserva que llegó o cuántas personas son para abrir la mesa.
            </SheetDescription>

            {suggestions.length > 0 ? (
              <section className="mt-4">
                <h3 className="pos-sheet-q">¿Son ellos?</h3>
                <ul className="mt-2 grid gap-2">
                  {suggestions.map(({ r, away, mine }) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className={cn('pos-res', mine && 'is-mine')}
                        disabled={busy !== null}
                        onClick={() => open(`r:${r.id}`, r.guests, r.id)}
                      >
                        <span className="pos-res-time">{r.time}</span>
                        <span className="min-w-0 flex-1 text-left">
                          <span className="pos-res-name">
                            {r.name}
                            <em> ×{r.guests}</em>
                          </span>
                          <span className="pos-res-meta">
                            {r.status === 'arrived'
                              ? 'Ya llegaron'
                              : away > 0
                                ? `En ${away} min`
                                : away < 0
                                  ? `Hace ${-away} min`
                                  : 'Ahora'}
                            {mine
                              ? ' · reservó esta mesa'
                              : r.table_label
                                ? ` · mesa ${r.table_label}`
                                : ''}
                            {r.deposit_cents > 0
                              ? ` · seña ${formatCentsShort(r.deposit_cents)}`
                              : ''}
                            {r.event ? ` · ${r.event}` : ''}
                          </span>
                        </span>
                        {r.kind === 'birthday' ? (
                          <Cake className="size-5 shrink-0 opacity-70" aria-label="Cumpleaños" />
                        ) : null}
                        {r.customer_id ? (
                          <Star
                            className="size-5 shrink-0 opacity-70"
                            aria-label="Socio del club"
                          />
                        ) : null}
                        {busy === `r:${r.id}` ? (
                          <Loader2 className="size-5 shrink-0 animate-spin" aria-hidden />
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="mt-5">
              <h3 className="pos-sheet-q">
                {suggestions.length > 0 ? 'Sin reserva: ¿cuántos son?' : '¿Cuántos son?'}
              </h3>
              <div className="pos-count-grid mt-2">
                {QUICK.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={cn('pos-count', table.capacity && n > table.capacity && 'is-over')}
                    disabled={busy !== null}
                    onClick={() => open(`n:${n}`, n)}
                    aria-label={`${n} ${n === 1 ? 'persona' : 'personas'}`}
                  >
                    {busy === `n:${n}` ? (
                      <Loader2 className="size-6 animate-spin" aria-hidden />
                    ) : (
                      n
                    )}
                  </button>
                ))}
              </div>

              {more ? (
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    className="pos-step"
                    onClick={() => setCount((c) => Math.max(9, c - 1))}
                    aria-label="Uno menos"
                  >
                    <Minus className="size-5" aria-hidden />
                  </button>
                  <span className="pos-step-value" aria-live="polite">
                    {count}
                  </span>
                  <button
                    type="button"
                    className="pos-step"
                    onClick={() => setCount((c) => Math.min(100, c + 1))}
                    aria-label="Uno más"
                  >
                    <Plus className="size-5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="pos-btn pos-btn-primary ml-auto"
                    disabled={busy !== null}
                    onClick={() => open(`n:${count}`, count)}
                  >
                    {busy === `n:${count}` ? (
                      <Loader2 className="size-5 animate-spin" aria-hidden />
                    ) : null}
                    Abrir para {count}
                  </button>
                </div>
              ) : (
                <button type="button" className="pos-link mt-3" onClick={() => setMore(true)}>
                  Son más de 8
                </button>
              )}
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
