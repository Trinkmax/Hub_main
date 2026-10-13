import Link from 'next/link'
import type { ReactNode } from 'react'
import { Amount } from '@/components/administracion/amount'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import {
  type Compliance,
  complianceOf,
  complianceText,
  type Projection,
  type ProjectionDay,
} from '@/lib/accounting/projection'
import type { DayEvents } from '@/lib/accounting/queries/projection'
import { formatDayLabel, formatDayMonth, weekdayName } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { NoteCell, TargetCell } from './day-cells'
import { TargetsImportDialog } from './targets-import-dialog'

/** Las columnas van juntas (como «Neto por medio»): son doce y tienen que entrar al lado del menú. */
const NUM = 'px-2.5 text-right'

function Dash() {
  return <span className="text-xs text-muted-foreground/60">—</span>
}

/** Un importe sin centavos, o «—» si no hay nada que mostrar. */
function Money({ cents, show = true }: { cents: number; show?: boolean }) {
  return show && cents !== 0 ? <Amount cents={cents} decimals={0} /> : <Dash />
}

/** «lunes 12/10», para lectores de pantalla. */
export function longDay(day: string): string {
  return `${weekdayName(day)} ${formatDayMonth(day)}`.trim()
}

function complianceTone(compliance: Compliance): string {
  if (compliance.kind !== 'value') return 'text-xs text-muted-foreground'
  return compliance.side === 'below' ? 'font-medium text-warning-text' : 'font-medium text-success'
}

function ComplianceCell({
  day,
  base,
  canWrite,
}: {
  day: ProjectionDay
  base: string
  canWrite: boolean
}) {
  const text = complianceText(day.compliance)
  if (text === null) return <Dash />
  const missingClose = day.compliance.kind === 'no_close' || day.compliance.kind === 'in_progress'
  return (
    <span className={cn('whitespace-nowrap tabular-nums', complianceTone(day.compliance))}>
      {text}
      {missingClose && canWrite ? (
        <>
          {' · '}
          <Link
            href={`${base}/ventas/cierre?fecha=${day.day}`}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Cargar cierre
          </Link>
        </>
      ) : null}
    </span>
  )
}

/** Los eventos del calendario de ese día y la nota («Evento y acciones» de la planilla). */
function EventCell({
  day,
  events,
  canWrite,
}: {
  day: ProjectionDay
  events: readonly string[]
  canWrite: boolean
}) {
  const names = events.join(' · ')
  if (!canWrite) {
    const parts = [names, day.note].filter(Boolean)
    return parts.length > 0 ? <span className="text-pretty">{parts.join(' · ')}</span> : <Dash />
  }
  return (
    <span className="flex flex-col items-start">
      {names ? <span className="text-pretty">{names}</span> : null}
      <NoteCell day={day.day} dayLabel={longDay(day.day)} note={day.note} />
    </span>
  )
}

function DayName({ day }: { day: ProjectionDay }) {
  return (
    <span
      className={cn('whitespace-nowrap tabular-nums', day.moment === 'today' && 'font-semibold')}
    >
      {formatDayLabel(day.day)}
      {day.moment === 'today' ? (
        <span className="ml-1 text-xs font-normal text-muted-foreground">Hoy</span>
      ) : null}
    </span>
  )
}

/** El cumplimiento del total: en un mes terminado, como el de un día; si no, cuánto del mes va. */
function totalCompliance(projection: Projection): ReactNode {
  const { summary, totals } = projection
  if (!summary.hasTargets || summary.monthPercent === null) {
    return <span className="text-xs font-normal text-muted-foreground">Sin objetivo</span>
  }
  if (summary.monthState === 'past') {
    return complianceText(complianceOf(totals.netCents, totals.targetCents))
  }
  return `${summary.monthPercent} % del objetivo del mes`
}

/**
 * La planilla de proyección de los socios (12/10/2026): un renglón por día con
 * el objetivo, lo vendido según los cierres, las comisiones estimadas, la
 * venta real y la neta, el cumplimiento en palabras y los acumulados. Quien
 * carga edita el objetivo y la nota en el lugar, o pega el mes entero con
 * «Cargar una lista». Un día que todavía no pasó muestra solo su objetivo.
 */
export function ProjectionTable({
  projection,
  events,
  month,
  monthLabel,
  base,
  canWrite,
}: {
  projection: Projection
  /** Eventos del calendario por día; `null` si quien mira no los puede leer. */
  events: DayEvents | null
  /** `yyyy-MM`. */
  month: string
  monthLabel: string
  base: string
  canWrite: boolean
}) {
  const { days, totals } = projection
  const eventsOf = (day: string) => events?.[day] ?? []

  return (
    <DataTableShell>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="max-w-2xl">
          <h2 className="font-serif text-lg font-semibold tracking-tight">Proyección de ventas</h2>
          <p className="text-xs text-muted-foreground text-pretty">
            {monthLabel} · El objetivo de cada día contra lo vendido según los cierres del día.
            {canWrite ? ' Tocá un objetivo para cambiarlo.' : ''}
          </p>
        </div>
        {canWrite ? <TargetsImportDialog month={month} monthLabel={monthLabel} /> : null}
      </header>

      {/* Compu y tablet: la planilla completa. */}
      <div className="hidden sm:block">
        <DataTableScroll>
          <DataTableRoot>
            <caption className="sr-only">Proyección de ventas por día, {monthLabel}</caption>
            <DataTableHead>
              <tr>
                <DataTableHeader>Día</DataTableHeader>
                <DataTableHeader className={NUM}>Objetivo</DataTableHeader>
                <DataTableHeader className={NUM}>Venta bar</DataTableHeader>
                <DataTableHeader className={NUM}>Venta delivery</DataTableHeader>
                <DataTableHeader className={NUM}>Comisión delivery</DataTableHeader>
                <DataTableHeader className={NUM}>Comisiones posnet</DataTableHeader>
                <DataTableHeader className={NUM}>Venta real</DataTableHeader>
                <DataTableHeader className={NUM}>Venta neta</DataTableHeader>
                <DataTableHeader className="px-2.5">Cumplimiento</DataTableHeader>
                <DataTableHeader className={NUM}>Objetivo acumulado</DataTableHeader>
                <DataTableHeader className={NUM}>Venta acumulada</DataTableHeader>
                <DataTableHeader className="px-2.5">Evento</DataTableHeader>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {days.map((d) => (
                <tr
                  key={d.day}
                  className={cn(
                    'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint',
                    d.moment === 'future' && 'text-muted-foreground',
                  )}
                >
                  <DataTableCell className="py-1.5">
                    <DayName day={d} />
                  </DataTableCell>
                  <DataTableCell className={cn(NUM, 'py-1.5')}>
                    {canWrite ? (
                      <TargetCell
                        day={d.day}
                        dayLabel={longDay(d.day)}
                        targetCents={d.targetCents}
                      />
                    ) : (
                      <Money cents={d.targetCents ?? 0} />
                    )}
                  </DataTableCell>
                  <DataTableCell className={cn(NUM, 'py-1.5')}>
                    <Money cents={d.barCents} show={d.hasClose} />
                  </DataTableCell>
                  <DataTableCell className={cn(NUM, 'py-1.5')}>
                    <Money cents={d.deliveryCents} show={d.hasClose} />
                  </DataTableCell>
                  <DataTableCell className={cn(NUM, 'py-1.5')}>
                    <Money cents={d.deliveryCommissionCents} show={d.hasClose} />
                  </DataTableCell>
                  <DataTableCell className={cn(NUM, 'py-1.5')}>
                    <Money cents={d.posnetCommissionCents} show={d.hasClose} />
                  </DataTableCell>
                  <DataTableCell className={cn(NUM, 'py-1.5')}>
                    <Money cents={d.realCents} show={d.hasClose} />
                  </DataTableCell>
                  <DataTableCell className={cn(NUM, 'py-1.5 font-medium')}>
                    <Money cents={d.netCents} show={d.hasClose} />
                  </DataTableCell>
                  <DataTableCell className="px-2.5 py-1.5">
                    <ComplianceCell day={d} base={base} canWrite={canWrite} />
                  </DataTableCell>
                  <DataTableCell className={cn(NUM, 'py-1.5')}>
                    <Money cents={d.targetAccumCents} />
                  </DataTableCell>
                  <DataTableCell className={cn(NUM, 'py-1.5')}>
                    <Money cents={d.netAccumCents} show={d.moment !== 'future'} />
                  </DataTableCell>
                  <DataTableCell className="min-w-40 px-2.5 py-1.5">
                    <EventCell day={d} events={eventsOf(d.day)} canWrite={canWrite} />
                  </DataTableCell>
                </tr>
              ))}
            </DataTableBody>
            <tfoot className="border-t border-border bg-secondary/30 font-semibold">
              <tr>
                <DataTableCell>Total del mes</DataTableCell>
                <DataTableCell className={NUM}>
                  <Money cents={totals.targetCents} />
                </DataTableCell>
                <DataTableCell className={NUM}>
                  <Money cents={totals.barCents} />
                </DataTableCell>
                <DataTableCell className={NUM}>
                  <Money cents={totals.deliveryCents} />
                </DataTableCell>
                <DataTableCell className={NUM}>
                  <Money cents={totals.deliveryCommissionCents} />
                </DataTableCell>
                <DataTableCell className={NUM}>
                  <Money cents={totals.posnetCommissionCents} />
                </DataTableCell>
                <DataTableCell className={NUM}>
                  <Money cents={totals.realCents} />
                </DataTableCell>
                <DataTableCell className={NUM}>
                  <Money cents={totals.netCents} />
                </DataTableCell>
                <DataTableCell className="whitespace-nowrap px-2.5 tabular-nums" colSpan={4}>
                  {totalCompliance(projection)}
                </DataTableCell>
              </tr>
            </tfoot>
          </DataTableRoot>
        </DataTableScroll>
      </div>

      {/* Celular: cada día con su objetivo, la venta neta y el cumplimiento; el detalle, debajo. */}
      <ul
        aria-label={`Proyección de ventas por día, ${monthLabel}`}
        className="divide-y divide-border/60 sm:hidden"
      >
        {days.map((d) => {
          const text = complianceText(d.compliance)
          const names = eventsOf(d.day)
          return (
            <li key={d.day} className="space-y-1 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">
                  <DayName day={d} />
                </span>
                {d.hasClose ? (
                  <span className="shrink-0 text-right">
                    <Amount cents={d.netCents} decimals={0} className="block text-sm font-medium" />
                    <span className="block text-[11px] text-muted-foreground">Venta neta</span>
                  </span>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  Objetivo
                  {canWrite ? (
                    <TargetCell
                      day={d.day}
                      dayLabel={longDay(d.day)}
                      targetCents={d.targetCents}
                      align="start"
                    />
                  ) : (
                    <span className="tabular-nums text-foreground">
                      {d.targetCents === null ? '—' : formatCentsShort(d.targetCents)}
                    </span>
                  )}
                </span>
                {text ? <ComplianceCell day={d} base={base} canWrite={canWrite} /> : null}
              </div>
              {d.hasClose ? (
                <p className="text-xs tabular-nums text-muted-foreground">
                  Bar {formatCentsShort(d.barCents)} · Delivery {formatCentsShort(d.deliveryCents)}{' '}
                  · Comisiones{' '}
                  {formatCentsShort(d.posnetCommissionCents + d.deliveryCommissionCents)}
                </p>
              ) : null}
              {d.targetAccumCents > 0 || d.netAccumCents !== 0 ? (
                <p className="text-xs tabular-nums text-muted-foreground">
                  Acumulado: objetivo {formatCentsShort(d.targetAccumCents)}
                  {d.moment === 'future' ? '' : ` · venta ${formatCentsShort(d.netAccumCents)}`}
                </p>
              ) : null}
              {canWrite || names.length > 0 || d.note ? (
                <div className="text-xs">
                  <EventCell day={d} events={names} canWrite={canWrite} />
                </div>
              ) : null}
            </li>
          )
        })}
        <li className="space-y-1 bg-secondary/30 px-4 py-3 text-sm">
          <div className="flex items-center justify-between gap-3 font-semibold">
            <span>Total del mes</span>
            <Amount cents={totals.netCents} decimals={0} />
          </div>
          <p className="text-xs tabular-nums text-muted-foreground">
            Objetivo {formatCentsShort(totals.targetCents)} · {totalCompliance(projection)}
          </p>
        </li>
      </ul>

      <p className="border-t border-border/60 px-5 py-3 text-xs text-muted-foreground text-pretty">
        Comisiones estimadas con los porcentajes de{' '}
        <Link
          href={`${base}/ajustes?tab=participes`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Ajustes
        </Link>
        : lo que descontaron de verdad está en «Neto por medio».
        {totals.eventsCents > 0 ? ' La venta bar incluye lo vendido por el canal Eventos.' : ''}
      </p>
    </DataTableShell>
  )
}
