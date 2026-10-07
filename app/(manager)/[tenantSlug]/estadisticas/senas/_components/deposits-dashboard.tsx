'use client'

import { Banknote, CalendarCheck, CircleSlash, TrendingUp } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useOptimistic, useTransition } from 'react'
import { Amount } from '@/components/ui/amount'
import { Callout } from '@/components/ui/callout'
import { Card } from '@/components/ui/card'
import { DataTable, DataTableToolbar, ExportButton } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { KPI, KPIGroup } from '@/components/ui/kpi'
import { PeriodPicker } from '@/components/ui/period-picker'
import { Section } from '@/components/ui/section'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { formatIsoDay } from '@/lib/dates/format'
import { formatNumber } from '@/lib/format/number-kind'
import { formatCents } from '@/lib/money/format'
import type { DepositsReport } from '@/lib/salon/deposits'
import { cn } from '@/lib/utils'
import { DepositsBarChart, dayLabel } from './deposits-bar-chart'

/** Sin centavos, como el resto del tablero (KPIs y tableros: 0 decimales). */
function money(cents: number): string {
  return formatCents(cents, { decimals: 0 })
}

type Basis = 'reserva' | 'carga'
type Scope = 'mes' | 'todo'

export function DepositsDashboard({
  tenantSlug,
  report,
  currentYM,
  period,
}: {
  tenantSlug: string
  report: DepositsReport
  currentYM: string
  period: Scope
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  // Lo elegido se ve al toque (optimista) y vuelve a lo que diga el server
  // cuando llega la página nueva.
  const [shownYM, setShownYM] = useOptimistic(currentYM)

  const { totals, basis } = report
  const porCarga = basis === 'created'
  const [shownBasis, setShownBasis] = useOptimistic<Basis>(porCarga ? 'carga' : 'reserva')
  const [shownScope, setShownScope] = useOptimistic<Scope>(period)

  // El link del CSV se arma con el MISMO rango y criterio que está en pantalla:
  // si saliera de los searchParams crudos, un default implícito haría que la
  // planilla trajera otros números que los de arriba.
  const exportHref =
    `/api/senas/export?slug=${encodeURIComponent(tenantSlug)}` +
    `&from=${report.from}&to=${report.to}&fecha=${porCarga ? 'carga' : 'reserva'}`

  // `replace` para los segmentados: son radiogroups y las flechas eligen en
  // cada tecla, así que con push cada una dejaba una entrada en el historial
  // (kit §3.3). El mes sigue con push: «atrás» vuelve al mes anterior.
  function push(
    next: Record<string, string>,
    mode: 'push' | 'replace' = 'push',
    optimistic?: () => void,
  ) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(next)) params.set(key, value)
    const href = `?${params.toString()}`
    startTransition(() => {
      optimistic?.()
      if (mode === 'replace') router.replace(href, { scroll: false })
      else router.push(href, { scroll: false })
    })
  }

  const periodLabel = period === 'todo' ? 'Total histórico' : 'Total del mes'
  const withMoneyDays = report.days.filter((d) => d.total_cents > 0)

  return (
    <div
      aria-busy={pending || undefined}
      className={cn('flex flex-col gap-8', pending && 'opacity-60 transition-opacity')}
    >
      {/* Barra de control: qué período y con qué criterio se lee el día. */}
      <div className="flex flex-col gap-3">
        <DataTableToolbar>
          <SegmentedControl<Scope>
            aria-label="Período"
            items={[
              { value: 'mes', label: 'Por mes' },
              { value: 'todo', label: 'Todo el histórico' },
            ]}
            value={shownScope}
            onValueChange={(value) =>
              push({ periodo: value }, 'replace', () => setShownScope(value))
            }
          />
          {period === 'todo' ? (
            <span className="type-small text-muted-foreground">
              <span className="type-amount">{formatIsoDay(report.from)}</span> al{' '}
              <span className="type-amount">{formatIsoDay(report.to)}</span>
            </span>
          ) : (
            <PeriodPicker
              aria-label="Mes"
              kinds={['month']}
              value={{ kind: 'month', month: shownYM }}
              onValueChange={(next) => {
                if (next.kind !== 'month') return
                push({ month: next.month }, 'push', () => setShownYM(next.month))
              }}
            />
          )}
          <SegmentedControl<Basis>
            aria-label="Contar cada seña por"
            items={[
              { value: 'reserva', label: 'Día de la reserva' },
              { value: 'carga', label: 'Día de carga' },
            ]}
            value={shownBasis}
            onValueChange={(value) => push({ fecha: value }, 'replace', () => setShownBasis(value))}
          />
          <ExportButton href={exportHref} title="Descargar planilla (Excel / Sheets)" />
        </DataTableToolbar>

        <p className="max-w-prose text-pretty type-small text-muted-foreground">
          {porCarga
            ? 'Cada seña cuenta el día en que se cargó la reserva en el sistema: es la plata que entró ese día.'
            : 'Cada seña cuenta el día en que la gente viene: es la plata que respalda cada fecha de servicio.'}
        </p>

        {porCarga ? (
          <Callout tone="warning">
            No se guarda la fecha en que se cobró la seña. Si una reserva se cargó tarde o se migró
            de otro sistema, cae el día de la carga, no el del cobro.
          </Callout>
        ) : null}

        {report.truncated ? (
          <Callout tone="warning" title="El total puede estar incompleto">
            Hay más reservas de las que entran en una sola lectura. Elegí un período más corto.
          </Callout>
        ) : null}
      </div>

      {totals.reservations === 0 ? (
        <EmptyState
          icon={Banknote}
          title="Sin reservas en este período"
          description="Cuando cargues reservas con seña, vas a ver acá cuánta plata entró día por día."
        />
      ) : (
        <>
          <KPIGroup columns={4}>
            <KPI
              label={periodLabel}
              value={<Amount cents={totals.total_cents} decimals={0} />}
              hint={`${formatNumber(totals.with_deposit)} de ${formatNumber(totals.reservations)} reservas dejaron seña`}
            />
            <KPI
              icon={CalendarCheck}
              label="Seña vigente"
              value={<Amount cents={totals.active_cents} decimals={0} />}
              hint="Reservas en pie"
            />
            <KPI
              icon={CircleSlash}
              label="Canceladas / No vino"
              value={<Amount cents={totals.fallen_cents} decimals={0} />}
              hint={
                totals.fallen_cents > 0
                  ? `Canceladas ${money(totals.cancelled_cents)} · No vino ${money(totals.no_show_cents)}`
                  : 'No se cayó ninguna'
              }
            />
            <KPI
              icon={TrendingUp}
              label="Día más alto"
              value={
                totals.top_day ? <Amount cents={totals.top_day.total_cents} decimals={0} /> : '—'
              }
              hint={totals.top_day ? dayLabel(totals.top_day.day) : 'Sin señas todavía'}
            />
          </KPIGroup>

          <Section
            title="Señas por día"
            actions={
              <ul className="flex items-center gap-3 type-caption text-muted-foreground">
                <li className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary" />
                  Vigente
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full bg-destructive/55"
                  />
                  Canceladas / No vino
                </li>
              </ul>
            }
          >
            <Card>
              <DepositsBarChart
                days={report.days}
                median={totals.median_day_cents}
                avg={totals.avg_day_cents}
                daysWithDeposit={totals.days_with_deposit}
              />
            </Card>
          </Section>

          <Section
            title="Detalle por día"
            description="Solo los días que dejaron plata. Los días sin seña están en el gráfico y en la planilla."
          >
            <DataTable
              caption="Señas por día"
              rows={withMoneyDays}
              getRowId={(d) => d.day}
              // Planilla de cifras: en el celular se desliza de costado con el
              // día fijo, así cada número sigue debajo de su encabezado.
              mobile="scroll"
              columns={[
                {
                  id: 'dia',
                  header: 'Día',
                  cell: (d) => dayLabel(d.day),
                  // El total del período (no la suma de las filas: los días sin
                  // seña también cuentan reservas).
                  footer: <span className="type-label">{periodLabel}</span>,
                },
                {
                  id: 'reservas',
                  header: 'Reservas',
                  numeric: true,
                  cell: (d) => (
                    <span className="text-muted-foreground">{formatNumber(d.reservations)}</span>
                  ),
                  footer: formatNumber(totals.reservations),
                },
                {
                  id: 'con-sena',
                  header: 'Con seña',
                  numeric: true,
                  cell: (d) => (
                    <span className="text-muted-foreground">{formatNumber(d.with_deposit)}</span>
                  ),
                  footer: formatNumber(totals.with_deposit),
                },
                {
                  id: 'vigente',
                  header: 'Vigente $',
                  numeric: true,
                  cell: (d) => <Amount cents={d.active_cents} decimals={0} currency={false} />,
                  footer: <Amount cents={totals.active_cents} decimals={0} currency={false} />,
                },
                {
                  id: 'caidas',
                  header: 'Canceladas / No vino $',
                  numeric: true,
                  cell: (d) =>
                    d.fallen_cents > 0 ? (
                      <Amount
                        cents={d.fallen_cents}
                        decimals={0}
                        currency={false}
                        className="text-destructive-text"
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    ),
                  footer: <Amount cents={totals.fallen_cents} decimals={0} currency={false} />,
                },
                {
                  id: 'total',
                  header: 'Total $',
                  numeric: true,
                  cell: (d) => (
                    <Amount
                      cents={d.total_cents}
                      decimals={0}
                      currency={false}
                      className="font-semibold"
                    />
                  ),
                  footer: <Amount cents={totals.total_cents} decimals={0} currency={false} />,
                },
              ]}
              empty={
                <EmptyState
                  size="sm"
                  title="Ninguna reserva dejó seña"
                  description={`Hubo ${formatNumber(totals.reservations)} ${totals.reservations === 1 ? 'reserva' : 'reservas'} en el período, pero ninguna con seña cargada.`}
                />
              }
            />
          </Section>
        </>
      )}
    </div>
  )
}
