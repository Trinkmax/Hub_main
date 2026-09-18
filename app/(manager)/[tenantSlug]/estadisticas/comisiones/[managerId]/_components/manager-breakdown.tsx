'use client'

import { Check, Wallet } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { formatARS } from '@/lib/commissions/calculate'
import type { CommissionPeriod } from '@/lib/commissions/period'
import { markCommissionPaid, markCommissionRangePaid } from '@/lib/salon/actions'
import type { CommissionBreakdownEntry } from '@/lib/salon/queries'
import { cn } from '@/lib/utils'

export function ManagerCommissionsBreakdown({
  tenantSlug,
  managerId,
  period,
  entries,
  truncated,
}: {
  tenantSlug: string
  managerId: string
  period: CommissionPeriod
  entries: CommissionBreakdownEntry[]
  /** La lectura tocó el techo de filas: faltan reservas en la tabla y en los totales. */
  truncated: boolean
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmPayAll, setConfirmPayAll] = useState(false)
  const [pending, startTransition] = useTransition()

  const unpaid = useMemo(() => entries.filter((e) => !e.paid_at), [entries])

  // `pending` se deriva de `unpaid`, no de un segundo recorrido con otro
  // criterio: el diálogo de liquidar todo dice "N reservas por $X" y las dos
  // cifras tienen que salir de la MISMA lista, o algún día va a decir
  // "3 reservas por $0".
  const totals = useMemo(() => {
    const payable = entries.reduce((acc, e) => acc + e.payable_cents, 0)
    const pending = unpaid.reduce((acc, e) => acc + e.payable_cents, 0)
    return { payable, paid: payable - pending, pending }
  }, [entries, unpaid])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    if (selected.size === unpaid.length) setSelected(new Set())
    else setSelected(new Set(unpaid.map((e) => e.id)))
  }

  function payNow() {
    if (selected.size === 0) return
    startTransition(async () => {
      const r = await markCommissionPaid(tenantSlug, {
        ledger_ids: Array.from(selected),
      } as Record<string, unknown>)
      if (r.ok) {
        toast.success(r.message ?? 'Marcadas como pagadas.')
        setSelected(new Set())
      } else {
        toast.error(r.message)
      }
    })
  }

  /**
   * Liquidación completa del período. No manda ids: el servidor vuelve a
   * preguntar quién está impago en ese rango (ver `markCommissionRangePaid`),
   * así que el número del diálogo es informativo y el pago sale de la DB.
   */
  function payAllPending() {
    startTransition(async () => {
      const r = await markCommissionRangePaid(tenantSlug, {
        manager_id: managerId,
        from: period.from,
        to: period.to,
      } as Record<string, unknown>)
      if (r.ok) {
        // El mensaje puede avisar que quedaron pendientes: duración larga para
        // que no se lo lleve el toast antes de leerlo.
        toast.success(r.message ?? 'Listo.', { duration: 8000 })
        setConfirmPayAll(false)
        setSelected(new Set())
      } else {
        toast.error(r.message, { duration: 8000 })
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Total" value={formatARS(totals.payable)} />
        <Stat label="Cobrado" value={formatARS(totals.paid)} tone="muted" />
        <Stat label="Pendiente" value={formatARS(totals.pending)} tone="amber" />
      </div>

      {/* Con el rango libre se puede pedir más de un año de una: si la lectura
          tocó el techo, los totales y el botón de liquidar de abajo están
          contando de menos. Avisarlo importa más acá que en cualquier otra
          pantalla, porque desde acá se paga. */}
      {truncated ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-text">
          Hay más comisiones de las que entran en una sola lectura: faltan reservas en la tabla y en
          los totales. Elegí un rango más corto antes de liquidar.
        </p>
      ) : null}

      {/* Liquidar todo el período. Se esconde mientras hay entries tildadas:
          dos botones de pagar juntos, uno "las 3 que elegí" y otro "las 47 del
          período", es exactamente la confusión que no se puede permitir con
          plata. Primero se resuelve la selección; si no hay, aparece este. */}
      {unpaid.length > 0 && selected.size === 0 ? (
        <div className="card-hairline flex flex-col gap-3 rounded-xl border bg-card/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Quedan{' '}
            <span className="font-medium text-foreground">
              {unpaid.length} {unpaid.length === 1 ? 'reserva' : 'reservas'}
            </span>{' '}
            sin pagar en este período, por{' '}
            <span className="font-mono font-medium tabular-nums text-foreground">
              {formatARS(totals.pending)}
            </span>
            .
          </p>
          <Button
            onClick={() => setConfirmPayAll(true)}
            disabled={pending}
            className="h-10 w-full gap-2 sm:w-auto"
          >
            <Wallet className="size-4" aria-hidden />
            Marcar todo lo pendiente como pagado
          </Button>
        </div>
      ) : null}

      <AlertDialog
        open={confirmPayAll}
        onOpenChange={(next) => {
          if (!next && !pending) setConfirmPayAll(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Marcar {unpaid.length} {unpaid.length === 1 ? 'reserva' : 'reservas'} como pagadas?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se van a marcar como pagadas todas las comisiones pendientes de {period.label}:{' '}
              {unpaid.length} {unpaid.length === 1 ? 'reserva' : 'reservas'} por{' '}
              {formatARS(totals.pending)}. Las que ya figuran cobradas no se tocan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Sin esto Radix cierra el diálogo antes de que termine la
                // acción y el dueño no ve si salió bien.
                e.preventDefault()
                payAllPending()
              }}
              disabled={pending}
            >
              {pending ? 'Marcando…' : 'Sí, marcar como pagadas'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selected.size > 0 ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-amber-50/80 px-3 py-2 text-sm backdrop-blur dark:bg-amber-950/30">
          {/* "reservas", no "entries": en este período hay una entry de ledger
              por reserva del gestor, y es el idioma del dueño — el diálogo de
              liquidar todo y el toast dicen lo mismo. */}
          <span>
            {selected.size}{' '}
            {selected.size === 1 ? 'reserva seleccionada' : 'reservas seleccionadas'}
          </span>
          <Button size="sm" onClick={payNow} disabled={pending} className="gap-2">
            <Check className="size-4" />
            Marcar como cobradas
          </Button>
        </div>
      ) : null}

      <div className="card-hairline overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border/60 bg-secondary/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2">
                <Checkbox
                  checked={selected.size > 0 && selected.size === unpaid.length}
                  onCheckedChange={selectAll}
                  aria-label="Seleccionar todas"
                />
              </th>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2 text-right">Reservó → vino</th>
              <th className="px-3 py-2 text-right">Tarifa</th>
              <th className="px-3 py-2 text-right">Base</th>
              <th className="px-3 py-2 text-right">Bonus</th>
              <th className="px-3 py-2 text-right">Cobra</th>
              <th className="px-3 py-2 text-right">Split</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {entries.map((e) => {
              const isPaid = !!e.paid_at
              const noActual = e.reservation.actual_guests === null
              return (
                <tr key={e.id} className={isPaid ? 'opacity-70' : ''}>
                  <td className="px-3 py-2 align-middle">
                    {!isPaid ? (
                      <Checkbox checked={selected.has(e.id)} onCheckedChange={() => toggle(e.id)} />
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {e.reservation.reservation_date}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/${tenantSlug}/reservas/${e.reservation.id}`}
                      className="hover:underline"
                    >
                      {e.reservation.guest_name}
                    </Link>
                  </td>
                  {/* Las dos cifras, no una: es la revisión que los dueños
                      hacen antes de aprobar el pago. Un solo número no deja ver
                      si vinieron menos ni si el conteo existe. */}
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    <span className="text-muted-foreground">{e.reservation.estimated_guests}</span>
                    <span className="mx-1 text-muted-foreground">→</span>
                    {noActual ? (
                      <span
                        className="rounded bg-warning/20 px-1 text-[10px] uppercase tracking-wide text-foreground"
                        title="Nadie contó esta reserva: se cobra por lo reservado"
                      >
                        sin contar
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'font-semibold',
                          e.reservation.actual_guests !== e.reservation.estimated_guests &&
                            'text-warning',
                        )}
                      >
                        {e.reservation.actual_guests}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatARS(e.base_rate_per_guest_cents)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatARS(e.base_total_cents)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {e.bonus_total_cents > 0 ? (
                      <span className="text-amber-700 dark:text-amber-300">
                        +{formatARS(e.bonus_total_cents)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold">
                    {formatARS(e.payable_cents)}
                  </td>
                  <td className="px-3 py-2 text-right text-[11px] text-muted-foreground">
                    {e.split_factor_denominator === 1
                      ? '100%'
                      : `${e.split_factor_numerator}/${e.split_factor_denominator}`}
                  </td>
                  <td className="px-3 py-2">
                    {isPaid ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                        <Check className="size-3" />
                        Cobrada
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                        Pendiente
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'muted' | 'amber' }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        tone === 'amber'
          ? 'border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20'
          : 'border-border/60 bg-card/60'
      }`}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}
