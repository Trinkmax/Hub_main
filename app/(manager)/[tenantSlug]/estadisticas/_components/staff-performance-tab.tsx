'use client'

import { Banknote, Package, UsersRound } from 'lucide-react'
import { useState } from 'react'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { StatCard } from '@/components/ui/stat-card'
import type { DateRangePreset } from '@/lib/staff-performance/date-range'
import type { StaffSummaryRow } from '@/lib/staff-performance/queries'
import { StaffDrawer } from './staff-drawer'
import { StaffRangePicker } from './staff-range-picker'

function fmt(cents: number): string {
  return `$${(cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

const numberFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg font-semibold tracking-tight">Rendimiento de mozos</h2>
          <p className="text-xs text-muted-foreground">
            Atribución equitativa entre todos los mozos que tuvieron acción en la mesa.
          </p>
        </div>
        <StaffRangePicker currentPreset={preset} />
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={UsersRound}
          label="Mozos activos"
          value={numberFmt.format(summaries.length)}
          hint={`Con actividad en el rango`}
        />
        <StatCard
          label="Mesas totales"
          value={numberFmt.format(totals.sessions)}
          hint="Suma de la atribución"
        />
        <StatCard icon={Banknote} label="Ventas atribuidas" value={fmt(totals.revenue)} />
        <StatCard
          icon={Package}
          label="Ítems atribuidos"
          value={numberFmt.format(Math.round(totals.items))}
        />
      </section>

      <DataTableShell>
        <header className="border-b border-border/60 px-5 py-4">
          <h3 className="font-serif text-lg font-semibold tracking-tight">Ranking del rango</h3>
          <p className="text-xs text-muted-foreground">
            Apretá un mozo para ver sus mesas atendidas y el detalle de cada una.
          </p>
        </header>
        {summaries.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title="Sin actividad de mozos en el rango"
            description="Cuando un mozo active y cobre mesas en este período, va a aparecer acá."
            className="m-3 border-0 bg-transparent"
          />
        ) : (
          <DataTableScroll>
            <DataTableRoot>
              <DataTableHead>
                <tr>
                  <DataTableHeader>Mozo</DataTableHeader>
                  <DataTableHeader className="text-right">Mesas</DataTableHeader>
                  <DataTableHeader className="text-right">Comensales</DataTableHeader>
                  <DataTableHeader className="text-right">Ventas</DataTableHeader>
                  <DataTableHeader className="text-right">Ítems</DataTableHeader>
                </tr>
              </DataTableHead>
              <DataTableBody>
                {summaries.map((s) => (
                  <tr
                    key={s.user_id}
                    onClick={() => setSelected(s)}
                    className="cursor-pointer transition-colors hover:bg-secondary/40"
                  >
                    <DataTableCell>
                      <div>
                        <p className="font-medium">{s.full_name ?? s.email}</p>
                        {s.full_name ? (
                          <p className="text-xs text-muted-foreground">{s.email}</p>
                        ) : null}
                      </div>
                    </DataTableCell>
                    <DataTableCell className="text-right tabular-nums">
                      {s.sessions_count}
                    </DataTableCell>
                    <DataTableCell className="text-right tabular-nums">
                      {Math.round(s.party_size_share)}
                    </DataTableCell>
                    <DataTableCell className="text-right font-display font-semibold tabular-nums">
                      {fmt(s.revenue_share_cents)}
                    </DataTableCell>
                    <DataTableCell className="text-right tabular-nums text-muted-foreground">
                      {Math.round(s.items_share)}
                    </DataTableCell>
                  </tr>
                ))}
              </DataTableBody>
            </DataTableRoot>
          </DataTableScroll>
        )}
      </DataTableShell>

      <StaffDrawer
        open={selected !== null}
        onOpenChange={(next) => {
          if (!next) setSelected(null)
        }}
        staff={selected}
        tenantId={tenantId}
        preset={preset}
      />
    </div>
  )
}
