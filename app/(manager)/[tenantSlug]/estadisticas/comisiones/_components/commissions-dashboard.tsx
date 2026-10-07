'use client'

import { Coins } from 'lucide-react'
import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { CommissionPeriodFilter } from '@/components/commissions/period-filter'
import { Amount } from '@/components/ui/amount'
import { Callout } from '@/components/ui/callout'
import { Card, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { KPI, KPIGroup } from '@/components/ui/kpi'
import { Section } from '@/components/ui/section'
import type { CommissionPeriod } from '@/lib/commissions/period'
import { formatNumber } from '@/lib/format/number-kind'
import { formatCents } from '@/lib/money/format'
import type { CommissionSummaryRow } from '@/lib/salon/queries'

const COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

/** Sin centavos, como el resto del tablero (KPIs y tableros: 0 decimales). */
function money(cents: number): string {
  return formatCents(cents, { decimals: 0 })
}

export function CommissionsDashboard({
  tenantSlug,
  period,
  summary,
  truncated,
}: {
  tenantSlug: string
  period: CommissionPeriod
  summary: CommissionSummaryRow[]
  /** La lectura tocó el techo de filas: los totales de abajo están incompletos. */
  truncated: boolean
}) {
  const totals = useMemo(
    () =>
      summary.reduce(
        (acc, s) => {
          acc.payable += s.payable_cents
          acc.paid += s.paid_cents
          acc.pending += s.pending_cents
          acc.guests += s.guests_total
          acc.reservations += s.reservations_count
          return acc
        },
        { payable: 0, paid: 0, pending: 0, guests: 0, reservations: 0 },
      ),
    [summary],
  )

  const chartData = summary
    .filter((s) => s.payable_cents > 0)
    .map((s, i) => ({
      name: s.manager.display_name,
      value: s.payable_cents,
      color: COLORS[i % COLORS.length],
    }))

  // El detalle abre con el MISMO rango que está en pantalla: si el link llevara
  // al mes calendario, el botón de marcar todo pagaría otra cosa.
  const detailHref = (managerId: string) =>
    `/${tenantSlug}/estadisticas/comisiones/${managerId}?from=${period.from}&to=${period.to}`

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        {/* Período a liquidar. Reemplaza al viejo "mes anterior / mes siguiente":
            el ciclo de pago no es un mes calendario y se corre. */}
        <CommissionPeriodFilter period={period} />

        {/* Un total de plata truncado no tiene ningún síntoma: se ve igual de
            prolijo, solo que con menos plata. Antes no se llegaba (el período era
            un mes); con el rango libre sí, así que lo decimos. */}
        {truncated ? (
          <Callout tone="warning" title="Los totales pueden estar incompletos">
            Hay más comisiones de las que entran en una sola lectura. Elegí un rango más corto.
          </Callout>
        ) : null}
      </div>

      {summary.length === 0 ? (
        <EmptyState
          icon={Coins}
          title="Sin comisiones en este período"
          description="Las comisiones se generan cuando las reservas se cierran con la cantidad real de personas cargada. Probá con otro período."
        />
      ) : (
        <>
          <KPIGroup columns={3}>
            <KPI label="Total a liquidar" value={<Amount cents={totals.payable} decimals={0} />} />
            <KPI label="Ya cobrado" value={<Amount cents={totals.paid} decimals={0} />} />
            <KPI
              label="Pendiente"
              value={<Amount cents={totals.pending} decimals={0} />}
              hint={totals.pending > 0 ? 'Falta cobrar' : 'No queda nada por cobrar'}
            />
          </KPIGroup>

          <Section
            title="Por gestor"
            description="Tocá un gestor para ver sus reservas una por una y marcar los pagos."
          >
            <div className="grid items-start gap-6 lg:grid-cols-[17.5rem_minmax(0,1fr)]">
              <Card padding="sm" className="gap-2">
                <CardTitle className="type-label font-medium text-muted-foreground">
                  Distribución
                </CardTitle>
                <div aria-hidden="true">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart accessibilityLayer={false}>
                      <Pie
                        data={chartData}
                        dataKey="value"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={85}
                        paddingAngle={2}
                        isAnimationActive={false}
                      >
                        {chartData.map((d) => (
                          <Cell key={d.name} fill={d.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => money(Number(value ?? 0))}
                        contentStyle={{
                          background: 'var(--popover)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-md)',
                          boxShadow: 'var(--elevation-1)',
                          color: 'var(--popover-foreground)',
                          fontSize: 13,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* La leyenda es la versión accesible del gráfico: nombre y monto. */}
                <ul aria-label="Distribución por gestor" className="flex flex-col gap-1 type-small">
                  {chartData.map((d) => (
                    <li key={d.name} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: d.color }}
                        />
                        <span className="truncate">{d.name}</span>
                      </span>
                      <Amount cents={d.value} decimals={0} />
                    </li>
                  ))}
                </ul>
              </Card>

              <DataTable
                caption="Comisiones por gestor"
                rows={summary}
                getRowId={(s) => s.manager.id}
                rowHref={(s) => detailHref(s.manager.id)}
                rowLabel={(s) => `Ver el detalle de ${s.manager.display_name}`}
                // Planilla de cifras: en el celular se desliza de costado con el
                // gestor fijo, así cada número sigue debajo de su encabezado.
                mobile="scroll"
                columns={[
                  { id: 'gestor', header: 'Gestor', cell: (s) => s.manager.display_name },
                  {
                    id: 'reservas',
                    header: 'Reservas',
                    numeric: true,
                    cell: (s) => formatNumber(s.reservations_count),
                  },
                  {
                    id: 'reservado',
                    header: 'Reservado',
                    numeric: true,
                    cell: (s) => (
                      <span className="text-muted-foreground">{formatNumber(s.booked_total)}</span>
                    ),
                  },
                  {
                    id: 'asistio',
                    header: 'Asistió',
                    numeric: true,
                    cell: (s) => (
                      <span className="inline-flex flex-col items-end">
                        {formatNumber(s.attended_total)}
                        {/* Sin esto el reporte mezclaría conteos reales con
                            estimados en una sola cifra, y los dueños estarían
                            aprobando plata sobre algo que nadie midió. */}
                        {s.uncounted_count > 0 ? (
                          <span
                            className="type-caption text-warning-text"
                            title={`${s.uncounted_count} ${s.uncounted_count === 1 ? 'reserva' : 'reservas'} sin contar: se cobran por lo reservado`}
                          >
                            +{formatNumber(s.uncounted_count)} sin contar
                          </span>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    id: 'se-cobra',
                    header: 'Se cobra',
                    numeric: true,
                    cell: (s) => (
                      <span className="font-semibold">{formatNumber(s.guests_total)}</span>
                    ),
                  },
                  {
                    id: 'base',
                    header: 'Base $',
                    numeric: true,
                    cell: (s) => <Amount cents={s.base_cents} decimals={0} currency={false} />,
                  },
                  {
                    id: 'bonus',
                    header: 'Bonus $',
                    numeric: true,
                    cell: (s) =>
                      s.bonus_cents > 0 ? (
                        <Amount
                          cents={s.bonus_cents}
                          decimals={0}
                          currency={false}
                          className="text-warning-text"
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      ),
                  },
                  {
                    id: 'total',
                    header: 'Total $',
                    numeric: true,
                    cell: (s) => (
                      <Amount
                        cents={s.payable_cents}
                        decimals={0}
                        currency={false}
                        className="font-semibold"
                      />
                    ),
                  },
                  {
                    id: 'cobrado',
                    header: 'Cobrado $',
                    numeric: true,
                    cell: (s) => (
                      <Amount cents={s.paid_cents} decimals={0} currency={false} tone="muted" />
                    ),
                  },
                  {
                    id: 'pendiente',
                    header: 'Pendiente $',
                    numeric: true,
                    cell: (s) =>
                      s.pending_cents > 0 ? (
                        <Amount
                          cents={s.pending_cents}
                          decimals={0}
                          currency={false}
                          className="text-warning-text"
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      ),
                  },
                ]}
              />
            </div>
          </Section>
        </>
      )}
    </div>
  )
}
