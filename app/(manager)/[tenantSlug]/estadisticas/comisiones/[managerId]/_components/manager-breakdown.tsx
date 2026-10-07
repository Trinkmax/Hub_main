'use client'

import { ArrowRight, Check, Wallet } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  COMMISSION_STATUS_OWNER,
  commissionStatusOf,
} from '@/components/commissions/commission-status'
import { Amount } from '@/components/ui/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableRow,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { KPI, KPIGroup } from '@/components/ui/kpi'
import { StatusBadge } from '@/components/ui/status-badge'
import type { CommissionPeriod } from '@/lib/commissions/period'
import { formatIsoDay } from '@/lib/dates/format'
import { formatNumber } from '@/lib/format/number-kind'
import { formatCents } from '@/lib/money/format'
import { markCommissionPaid, markCommissionRangePaid } from '@/lib/salon/actions'
import type { CommissionBreakdownEntry } from '@/lib/salon/queries'
import { cn } from '@/lib/utils'

/** Sin centavos, como el resto de la liquidación. */
function money(cents: number): string {
  return formatCents(cents, { decimals: 0 })
}

function reservasLabel(n: number): string {
  return `${formatNumber(n)} ${n === 1 ? 'reserva' : 'reservas'}`
}

export function ManagerCommissionsBreakdown({
  tenantSlug,
  managerId,
  period,
  entries,
  truncated,
  today,
}: {
  tenantSlug: string
  managerId: string
  period: CommissionPeriod
  entries: CommissionBreakdownEntry[]
  /** La lectura tocó el techo de filas: faltan reservas en la tabla y en los totales. */
  truncated: boolean
  /**
   * Hoy según el calendario del bar (`todayInCordoba()`), bajado desde la page.
   * No se calcula acá: el TZ del browser puede estar en otro día y encima
   * rompería la hidratación.
   */
  today: string
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmPayAll, setConfirmPayAll] = useState(false)
  const [pending, startTransition] = useTransition()

  // Impagas del período: es lo que la gestora tiene por cobrar, futuro incluido.
  const unpaid = useMemo(() => entries.filter((e) => !e.paid_at), [entries])

  // Liquidable HOY = impaga y ya ocurrida. El período por defecto llega a fin
  // de mes, así que sin este corte el recuadro y el diálogo contarían reservas
  // que todavía no pasaron y que el server (que topea el borde contra hoy) no
  // va a marcar. Se siguen viendo en la tabla, con su badge de "futura": no
  // desaparecen, solo no se pagan por adelantado.
  const payableNow = useMemo(
    () => unpaid.filter((e) => e.reservation.reservation_date <= today),
    [unpaid, today],
  )
  const futureCount = unpaid.length - payableNow.length
  const allPayableSelected = useMemo(
    () => payableNow.length > 0 && payableNow.every((e) => selected.has(e.id)),
    [payableNow, selected],
  )
  const somePayableSelected = payableNow.some((e) => selected.has(e.id))

  // Cada cifra sale de la MISMA lista que la acompaña: el diálogo de liquidar
  // todo dice "N reservas por $X" y las dos salen de `payableNow`, o algún día
  // va a decir "3 reservas por $0".
  const totals = useMemo(() => {
    const payable = entries.reduce((acc, e) => acc + e.payable_cents, 0)
    const pending = unpaid.reduce((acc, e) => acc + e.payable_cents, 0)
    const payableNowCents = payableNow.reduce((acc, e) => acc + e.payable_cents, 0)
    return { payable, paid: payable - pending, pending, payableNow: payableNowCents }
  }, [entries, unpaid, payableNow])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    if (allPayableSelected) setSelected(new Set())
    else setSelected(new Set(payableNow.map((e) => e.id)))
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
   * así que el número del diálogo es informativo y el pago sale de la DB. Si
   * falla, el diálogo queda abierto con el error adentro.
   */
  async function payAllPending() {
    const r = await markCommissionRangePaid(tenantSlug, {
      manager_id: managerId,
      from: period.from,
      to: period.to,
    } as Record<string, unknown>)
    if (!r.ok) return { ok: false as const, error: r.message }
    // El mensaje puede avisar que quedaron pendientes: duración larga para
    // que no se lo lleve el toast antes de leerlo.
    toast.success(r.message ?? 'Listo.', { duration: 8000 })
    setSelected(new Set())
    return { ok: true as const }
  }

  return (
    <div className="flex flex-col gap-6">
      <KPIGroup columns={3}>
        <KPI label="Total" value={<Amount cents={totals.payable} decimals={0} />} />
        <KPI label="Cobrado" value={<Amount cents={totals.paid} decimals={0} />} />
        <KPI
          label="Pendiente"
          value={<Amount cents={totals.pending} decimals={0} />}
          hint={totals.pending > 0 ? 'Falta pagarle' : 'No queda nada por pagar'}
        />
      </KPIGroup>

      {/* Con el rango libre se puede pedir más de un año de una: si la lectura
          tocó el techo, los totales y el botón de liquidar de abajo están
          contando de menos. Avisarlo importa más acá que en cualquier otra
          pantalla, porque desde acá se paga. */}
      {truncated ? (
        <Callout tone="warning" title="Faltan reservas en la tabla y en los totales">
          Hay más comisiones de las que entran en una sola lectura. Por eso no está el botón de
          liquidar todo el período: diría un total que no es el que se marcaría. Elegí un rango más
          corto y volvé a intentar.
        </Callout>
      ) : null}

      {/* Liquidar todo el período. Se esconde mientras hay entries tildadas:
          dos botones de pagar juntos, uno "las 3 que elegí" y otro "las 47 del
          período", es exactamente la confusión que no se puede permitir con
          plata. Primero se resuelve la selección; si no hay, aparece este.

          Y se esconde si la lectura truncó: la pantalla cuenta las 1000 filas
          que entraron y el server resuelve el rango de nuevo, así que el número
          del diálogo —el último cartel antes de tocar plata— prometería un
          conjunto distinto del que se va a marcar. Tildar de a una sigue
          andando: ahí se pagan ids que el dueño vio en la tabla. */}
      {payableNow.length > 0 && selected.size === 0 && !truncated ? (
        <Card padding="sm" className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-prose text-pretty type-body text-muted-foreground">
            Quedan{' '}
            <span className="font-medium text-foreground">{reservasLabel(payableNow.length)}</span>{' '}
            sin pagar en este período, por{' '}
            <Amount
              cents={totals.payableNow}
              decimals={0}
              className="font-medium text-foreground"
            />
            .
            {futureCount > 0 ? (
              <>
                {' '}
                {futureCount === 1 ? 'Hay 1 reserva' : `Hay ${formatNumber(futureCount)} reservas`}{' '}
                más adelante en el calendario: no entran en la liquidación hasta que ocurran.
              </>
            ) : null}
          </p>
          <Button
            onClick={() => setConfirmPayAll(true)}
            disabled={pending}
            className="max-sm:w-full sm:shrink-0"
          >
            <Wallet aria-hidden />
            Marcar todo lo pendiente como pagado
          </Button>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmPayAll}
        onOpenChange={setConfirmPayAll}
        title={`¿Marcar ${reservasLabel(payableNow.length)} como pagadas?`}
        description={
          <>
            Se van a marcar como pagadas todas las comisiones pendientes de {period.label} que ya
            ocurrieron: {reservasLabel(payableNow.length)} por {money(totals.payableNow)}. Las que
            ya figuran cobradas no se tocan
            {futureCount > 0 ? ', y las del futuro tampoco' : ''}.
          </>
        }
        confirmLabel="Marcar como pagadas"
        pendingLabel="Marcando…"
        icon={Wallet}
        onConfirm={payAllPending}
      />

      {selected.size > 0 ? (
        // Misma barra que la selección del kit: arriba de la tabla en
        // escritorio (pegada debajo del topbar) y fija abajo en el celular.
        <div
          className={cn(
            'z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-4 py-2',
            'sm:sticky sm:top-[calc(var(--topbar-h)+0.5rem)]',
            'max-sm:fixed max-sm:inset-x-4 max-sm:bottom-[calc(1rem+env(safe-area-inset-bottom))] max-sm:z-40 max-sm:shadow-float',
          )}
        >
          {/* "reservas", no "entries": en este período hay una entry de ledger
              por reserva del gestor, y es el idioma del dueño — el diálogo de
              liquidar todo y el toast dicen lo mismo. */}
          <span role="status" className="type-label tabular-nums text-foreground">
            {formatNumber(selected.size)}{' '}
            {selected.size === 1 ? 'reserva seleccionada' : 'reservas seleccionadas'}
          </span>
          <div className="ms-auto flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
              disabled={pending}
            >
              Limpiar
            </Button>
            <Button size="sm" onClick={payNow} loading={pending} loadingText="Marcando…">
              <Check aria-hidden />
              Marcar como cobradas
            </Button>
          </div>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Sin reservas liquidadas en este período"
          description="Cuando sus reservas se cierren con la cantidad real de personas, van a aparecer acá con lo que le corresponde."
        />
      ) : (
        <DataTableShell className={cn(selected.size > 0 && 'max-sm:mb-20')}>
          {/* Con casillas en las filas va con scroll de costado en el celular
              (no tarjetas): cada casilla tiene que ser una sola. */}
          <DataTableScroll>
            <DataTableRoot caption={`Comisiones de ${period.label}`} className="min-w-[56rem]">
              <DataTableHead>
                <tr>
                  <DataTableHeader className="w-10 px-3">
                    <Checkbox
                      checked={
                        allPayableSelected ? true : somePayableSelected ? 'indeterminate' : false
                      }
                      onCheckedChange={selectAll}
                      disabled={payableNow.length === 0}
                      aria-label="Elegir todas las que se pueden liquidar hoy"
                    />
                  </DataTableHeader>
                  <DataTableHeader>Fecha</DataTableHeader>
                  <DataTableHeader>Cliente</DataTableHeader>
                  <DataTableHeader numeric>Reservó → vino</DataTableHeader>
                  <DataTableHeader numeric>Tarifa $</DataTableHeader>
                  <DataTableHeader numeric>Base $</DataTableHeader>
                  <DataTableHeader numeric>Bonus $</DataTableHeader>
                  <DataTableHeader numeric>Cobra $</DataTableHeader>
                  <DataTableHeader numeric>Parte</DataTableHeader>
                  <DataTableHeader>Estado</DataTableHeader>
                </tr>
              </DataTableHead>
              <DataTableBody>
                {entries.map((e) => {
                  const isPaid = !!e.paid_at
                  const noActual = e.reservation.actual_guests === null
                  // Todavía no ocurrió: está en la tabla porque el período la
                  // abarca, pero no se liquida (el monto puede cambiar o la reserva
                  // caerse, y una comisión pagada ya no se corrige).
                  const isFuture = !isPaid && e.reservation.reservation_date > today
                  return (
                    <DataTableRow
                      key={e.id}
                      selected={selected.has(e.id)}
                      interactive={!isPaid}
                      className={cn(isPaid && '[&>td]:text-muted-foreground')}
                    >
                      <DataTableCell className="w-10 px-3">
                        {!isPaid ? (
                          <Checkbox
                            checked={selected.has(e.id)}
                            onCheckedChange={() => toggle(e.id)}
                            aria-label={`Elegir la reserva de ${e.reservation.guest_name}`}
                          />
                        ) : null}
                      </DataTableCell>
                      <DataTableCell>
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span className="type-amount">
                            {formatIsoDay(e.reservation.reservation_date)}
                          </span>
                          {isFuture ? (
                            <Badge title="Todavía no ocurrió: no entra en la liquidación del período">
                              futura
                            </Badge>
                          ) : null}
                        </span>
                      </DataTableCell>
                      <DataTableCell primary>
                        <Link
                          href={`/${tenantSlug}/reservas/${e.reservation.id}`}
                          className="underline-offset-[3px] hover:underline focus-visible:underline"
                        >
                          {e.reservation.guest_name}
                        </Link>
                      </DataTableCell>
                      {/* Las dos cifras, no una: es la revisión que los dueños
                          hacen antes de aprobar el pago. Un solo número no deja ver
                          si vinieron menos ni si el conteo existe. */}
                      <DataTableCell numeric>
                        <span className="inline-flex items-center justify-end gap-1">
                          <span className="text-muted-foreground">
                            {formatNumber(e.reservation.estimated_guests)}
                          </span>
                          <ArrowRight aria-hidden className="size-3.5 text-muted-foreground" />
                          <span className="sr-only">vinieron</span>
                          {noActual ? (
                            <Badge
                              tone="warning"
                              title="Nadie contó esta reserva: se cobra por lo reservado"
                            >
                              sin contar
                            </Badge>
                          ) : (
                            <span
                              className={cn(
                                'font-semibold',
                                e.reservation.actual_guests !== e.reservation.estimated_guests &&
                                  'text-warning-text',
                              )}
                            >
                              {formatNumber(e.reservation.actual_guests)}
                            </span>
                          )}
                        </span>
                      </DataTableCell>
                      <DataTableCell numeric>
                        <Amount cents={e.base_rate_per_guest_cents} decimals={0} currency={false} />
                      </DataTableCell>
                      <DataTableCell numeric>
                        <Amount cents={e.base_total_cents} decimals={0} currency={false} />
                      </DataTableCell>
                      <DataTableCell numeric>
                        {e.bonus_total_cents > 0 ? (
                          <span className="text-warning-text">
                            +<Amount cents={e.bonus_total_cents} decimals={0} currency={false} />
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </DataTableCell>
                      <DataTableCell numeric className="font-semibold">
                        <Amount cents={e.payable_cents} decimals={0} currency={false} />
                      </DataTableCell>
                      <DataTableCell numeric className="type-small text-muted-foreground">
                        {e.split_factor_denominator === 1
                          ? '100 %'
                          : `${e.split_factor_numerator}/${e.split_factor_denominator}`}
                      </DataTableCell>
                      <DataTableCell>
                        <StatusBadge
                          status={commissionStatusOf(e.paid_at)}
                          map={COMMISSION_STATUS_OWNER}
                        />
                      </DataTableCell>
                    </DataTableRow>
                  )
                })}
              </DataTableBody>
            </DataTableRoot>
          </DataTableScroll>
        </DataTableShell>
      )}
    </div>
  )
}
