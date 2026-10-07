'use client'

import { Banknote, Package, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { Amount } from '@/components/ui/amount'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { KPI, KPIGroup } from '@/components/ui/kpi'
import { Section } from '@/components/ui/section'
import { formatNumber } from '@/lib/format/number-kind'
import type { DateRangePreset } from '@/lib/staff-performance/date-range'
import type { StaffSummaryRow } from '@/lib/staff-performance/queries'
import { StaffDrawer } from './staff-drawer'
import { StaffRangePicker } from './staff-range-picker'

export function StaffPerformanceTab({
  tenantId,
  summaries,
  preset,
}: {
  tenantId: string
  summaries: StaffSummaryRow[]
  preset: DateRangePreset
}) {
  const [selected, setSelected] = useState<StaffSummaryRow | null>(null)

  const totals = summaries.reduce(
    (acc, s) => {
      acc.sessions += s.sessions_count
      acc.party += s.party_size_share
      acc.revenue += s.revenue_share_cents
      acc.items += s.items_share
      return acc
    },
    { sessions: 0, party: 0, revenue: 0, items: 0 },
  )

  return (
    <>
      <Section
        title="Rendimiento de mozos"
        description="Cada mesa se reparte en partes iguales entre los mozos que la atendieron."
        actions={<StaffRangePicker currentPreset={preset} />}
      >
        <KPIGroup columns={4}>
          <KPI
            icon={UsersRound}
            label="Mozos activos"
            value={formatNumber(summaries.length)}
            hint="Con actividad en el período"
          />
          <KPI
            label="Mesas"
            value={formatNumber(totals.sessions)}
            hint="Suma de la parte de cada mozo"
          />
          <KPI
            icon={Banknote}
            label="Ventas atribuidas"
            value={<Amount cents={totals.revenue} decimals={0} />}
          />
          <KPI
            icon={Package}
            label="Ítems atribuidos"
            value={formatNumber(Math.round(totals.items))}
          />
        </KPIGroup>
      </Section>

      <Section
        title="Ranking del período"
        description="Tocá un mozo para ver sus mesas y el detalle de cada una."
      >
        <DataTable
          caption="Ranking de mozos del período"
          rows={summaries}
          getRowId={(s) => s.user_id}
          rowLabel={(s) => s.full_name ?? s.email}
          // Toda la fila abre el cajón del mozo: un botón estirado, no un link.
          onRowAction={(s) => setSelected(s)}
          rowActionLabel={(s) => `Ver las mesas de ${s.full_name ?? s.email}`}
          columns={[
            {
              id: 'mozo',
              header: 'Mozo',
              cell: (s) => (
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium text-foreground">{s.full_name ?? s.email}</span>
                  {s.full_name ? (
                    <span className="type-small font-normal text-muted-foreground">{s.email}</span>
                  ) : null}
                  {/* En el celular (tarjetas) las columnas de cifras no se ven:
                      las mesas y los comensales van acá, con su palabra. */}
                  <span className="type-small font-normal text-muted-foreground md:hidden">
                    {formatNumber(s.sessions_count)} {s.sessions_count === 1 ? 'mesa' : 'mesas'} ·{' '}
                    {formatNumber(Math.round(s.party_size_share))} comensales
                  </span>
                </span>
              ),
            },
            {
              id: 'mesas',
              header: 'Mesas',
              numeric: true,
              mobile: 'hidden',
              cell: (s) => formatNumber(s.sessions_count),
            },
            {
              id: 'comensales',
              header: 'Comensales',
              numeric: true,
              mobile: 'hidden',
              cell: (s) => formatNumber(Math.round(s.party_size_share)),
            },
            // Con su `$`: en el celular la lista pasa a tarjetas y el encabezado no se ve.
            {
              id: 'ventas',
              header: 'Ventas',
              numeric: true,
              cell: (s) => <Amount cents={s.revenue_share_cents} decimals={0} />,
            },
            {
              id: 'items',
              header: 'Ítems',
              numeric: true,
              mobile: 'hidden',
              cell: (s) => (
                <span className="text-muted-foreground">
                  {formatNumber(Math.round(s.items_share))}
                </span>
              ),
            },
          ]}
          empty={
            <EmptyState
              size="sm"
              icon={UsersRound}
              title="Ningún mozo tuvo mesas en este período"
              description="Cuando un mozo abra y cobre mesas, va a aparecer acá. Probá con un período más largo."
            />
          }
        />
      </Section>

      <StaffDrawer
        open={selected !== null}
        onOpenChange={(next) => {
          if (!next) setSelected(null)
        }}
        staff={selected}
        tenantId={tenantId}
        preset={preset}
      />
    </>
  )
}
