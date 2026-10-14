import { ChevronDown, CircleAlert, Lock } from 'lucide-react'
import Link from 'next/link'
import { plural } from '@/components/administracion/format'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import type { FiscalYearRow, PeriodEventRow, PeriodRow } from '@/lib/accounting/queries'
import { formatDate, formatDateTime, formatIsoDay, formatMonthLabel, monthOf } from '@/lib/dates'
import { monthNoun, monthState } from '../../_lib/months'
import { ReopenFiscalYearMenu, ReopenMonthMenu } from './close-actions'

/**
 * «Cierres de mes: todos los meses»: el registro denso de cada ejercicio (qué
 * mes está cerrado, quién lo cerró, cuándo, cuántos asientos y con qué
 * numeración) y el historial de cierres y reaperturas. Es la vista de la
 * contadora: para el dueño va plegada (lo suyo son los tres pasos de arriba),
 * para ella, abierta.
 *
 * «Reabrir» sigue donde estaba: en la fila del último mes cerrado (y el del
 * ejercicio, en su encabezado), solo para quien carga. Server-safe.
 */

function yearLabel(year: FiscalYearRow): string {
  return `${formatIsoDay(year.startDate)} al ${formatIsoDay(year.endDate)}`
}

function periodLabel(period: PeriodRow): string {
  if (period.kind === 'fy_adjustments') return `Ajustes de cierre ${period.endsOn.slice(0, 4)}`
  if (period.kind === 'fy_opening') return `Apertura ${period.startsOn.slice(0, 4)}`
  return formatMonthLabel(period.month)
}

function StatePill({ period, today }: { period: PeriodRow; today: string }) {
  if (period.status === 'closed') {
    return (
      <StatusPill tone="ok" icon={Lock}>
        Cerrado
      </StatusPill>
    )
  }
  if (period.kind !== 'month') return <StatusPill tone="muted">Abierto</StatusPill>
  const state = monthState(period, today)
  if (state === 'to_close') return <StatusPill tone="warn">Falta cerrar</StatusPill>
  if (state === 'current') return <StatusPill tone="info">En curso</StatusPill>
  return <StatusPill tone="muted">No empezó</StatusPill>
}

function numbering(period: PeriodRow): string {
  return period.numberFrom !== null && period.numberTo !== null
    ? `${period.numberFrom}–${period.numberTo}`
    : '—'
}

const EVENT_VERB: Readonly<Record<PeriodEventRow['action'], string>> = {
  closed: 'cerró',
  reopened: 'reabrió',
  fy_closed: 'cerró el ejercicio',
  fy_reopened: 'reabrió el ejercicio',
}

export function AllMonths({
  years,
  events,
  tenantSlug,
  path,
  today,
  canWrite,
  lastClosedId,
  changed,
  open,
}: {
  years: readonly FiscalYearRow[]
  events: readonly PeriodEventRow[]
  tenantSlug: string
  /** `/<bar>/administracion/libros/cierres`. */
  path: string
  today: string
  canWrite: boolean
  /** El último mes cerrado: el único que se puede reabrir. */
  lastClosedId: string | null
  /** Los períodos que cambiaron después de cerrarse. */
  changed: ReadonlySet<string>
  /** Abierto de entrada (la contadora). */
  open: boolean
}) {
  const periods = new Map(years.flatMap((y) => y.periods.map((p) => [p.id, p] as const)))
  const yearsById = new Map(years.map((y) => [y.id, y] as const))

  return (
    <details open={open} className="group/all card-hairline rounded-2xl border bg-card shadow-xs">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform duration-(--duration-fast) group-open/all:rotate-0 motion-reduce:transition-none"
        />
        <h2 className="font-serif text-lg font-semibold leading-snug tracking-tight">
          Cierres de mes: todos los meses
        </h2>
      </summary>

      <div className="space-y-6 px-4 pb-5 sm:px-5">
        {[...years].reverse().map((year) => {
          const next = years.find((y) => y.startDate > year.endDate) ?? null
          const allMonthsClosed = year.periods.every(
            (p) => p.kind !== 'month' || p.status === 'closed',
          )
          const rows = year.periods.filter(
            (p) =>
              p.kind === 'month' ||
              p.status === 'closed' ||
              (p.kind === 'fy_adjustments' && allMonthsClosed),
          )
          const canReopenYear = canWrite && year.status === 'closed' && next?.status !== 'closed'
          const reopenFor = (p: PeriodRow) =>
            canWrite && p.id === lastClosedId && year.status === 'open' ? (
              <ReopenMonthMenu
                tenantSlug={tenantSlug}
                month={p.month}
                monthNoun={monthNoun(p.month)}
              />
            ) : null
          const nameOf = (p: PeriodRow) =>
            p.kind === 'month' && p.startsOn <= today ? (
              <Link
                href={`${path}?mes=${monthOf(p.month)}`}
                // En la lista del celular el nombre es lo que se toca: 44 px de alto.
                className="rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring max-sm:inline-flex max-sm:min-h-11 max-sm:items-center"
              >
                {periodLabel(p)}
              </Link>
            ) : (
              <span className="font-medium">{periodLabel(p)}</span>
            )

          return (
            <section
              key={year.id}
              aria-label={`Ejercicio ${yearLabel(year)}`}
              className="space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  <span className="font-semibold">Ejercicio {yearLabel(year)}</span>
                  <span className="text-muted-foreground">
                    {' · '}
                    {year.status === 'closed'
                      ? `Cerrado${year.closedAt ? ` el ${formatDate(year.closedAt)}` : ''}${
                          year.closedByName ? ` por ${year.closedByName}` : ''
                        }`
                      : 'Abierto'}
                  </span>
                </p>
                {canReopenYear ? (
                  <ReopenFiscalYearMenu
                    tenantSlug={tenantSlug}
                    fiscalYearId={year.id}
                    label={year.endDate.slice(0, 4)}
                  />
                ) : null}
              </div>

              {/* Compu y tablet: la tabla densa. */}
              <DataTableShell className="hidden sm:block">
                <DataTableScroll>
                  <DataTableRoot>
                    <caption className="sr-only">Meses del ejercicio {yearLabel(year)}</caption>
                    <DataTableHead>
                      <tr>
                        <DataTableHeader>Mes</DataTableHeader>
                        <DataTableHeader>Estado</DataTableHeader>
                        <DataTableHeader className="whitespace-nowrap">Cerrado el</DataTableHeader>
                        <DataTableHeader>Por</DataTableHeader>
                        <DataTableHeader className="text-right">Asientos</DataTableHeader>
                        <DataTableHeader className="text-right">Numeración</DataTableHeader>
                        <DataTableHeader className="w-12">
                          <span className="sr-only">Acciones</span>
                        </DataTableHeader>
                      </tr>
                    </DataTableHead>
                    <DataTableBody>
                      {rows.map((p) => (
                        <tr key={p.id} className="transition-colors hover:bg-cream-tint">
                          <DataTableCell className="py-2">
                            {nameOf(p)}
                            {changed.has(p.id) ? <ChangedNote /> : null}
                          </DataTableCell>
                          <DataTableCell className="py-2">
                            <StatePill period={p} today={today} />
                          </DataTableCell>
                          <DataTableCell className="whitespace-nowrap py-2 tabular-nums text-muted-foreground">
                            {p.closedAt ? formatDate(p.closedAt) : '—'}
                          </DataTableCell>
                          <DataTableCell className="py-2 text-muted-foreground">
                            <span className="line-clamp-1" title={p.closedByName ?? undefined}>
                              {p.closedByName ?? '—'}
                            </span>
                          </DataTableCell>
                          <DataTableCell className="py-2 text-right tabular-nums">
                            {p.status === 'closed' && p.entriesCount !== null
                              ? p.entriesCount
                              : '—'}
                          </DataTableCell>
                          <DataTableCell className="whitespace-nowrap py-2 text-right tabular-nums">
                            {p.status === 'closed' ? numbering(p) : '—'}
                          </DataTableCell>
                          <DataTableCell className="py-1 text-right">{reopenFor(p)}</DataTableCell>
                        </tr>
                      ))}
                    </DataTableBody>
                  </DataTableRoot>
                </DataTableScroll>
              </DataTableShell>

              {/* Celular: dos líneas por mes. */}
              <ul className="divide-y divide-border/60 rounded-xl border border-border/70 sm:hidden">
                {rows.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm">{nameOf(p)}</p>
                      <p className="text-xs text-muted-foreground text-pretty">
                        {p.status === 'closed'
                          ? [
                              p.closedAt ? `Cerrado el ${formatDate(p.closedAt)}` : 'Cerrado',
                              p.closedByName ? `por ${p.closedByName}` : null,
                              p.entriesCount !== null
                                ? `${plural(p.entriesCount, 'asiento', 'asientos')} (${numbering(p)})`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : 'Sin cerrar'}
                      </p>
                      {changed.has(p.id) ? <ChangedNote /> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <StatePill period={p} today={today} />
                      {reopenFor(p)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}

        {events.length > 0 ? (
          <section aria-labelledby="historial-de-cierres" className="space-y-2">
            <div>
              <h3 id="historial-de-cierres" className="text-sm font-semibold">
                Historial de cierres
              </h3>
              <p className="text-xs text-muted-foreground">
                Quién cerró o reabrió qué, cuándo y por qué.
              </p>
            </div>
            <ul className="divide-y divide-border/60 rounded-xl border border-border/70">
              {events.map((e) => {
                const period = e.periodId ? periods.get(e.periodId) : undefined
                const year = e.fiscalYearId ? yearsById.get(e.fiscalYearId) : undefined
                const what =
                  e.action === 'fy_closed' || e.action === 'fy_reopened'
                    ? year
                      ? ` ${yearLabel(year)}`
                      : ''
                    : period
                      ? ` ${periodLabel(period)}`
                      : ' un mes'
                return (
                  <li key={e.id} className="space-y-0.5 px-3 py-2.5 text-sm">
                    <p className="text-pretty">
                      <span className="font-medium">{e.actorName || 'Alguien del equipo'}</span>{' '}
                      {EVENT_VERB[e.action]}
                      {what}
                      {e.reason ? (
                        <span className="text-muted-foreground">: «{e.reason}»</span>
                      ) : null}
                    </p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(e.createdAt)}
                    </p>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </details>
  )
}

function ChangedNote() {
  return (
    <span className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-destructive">
      <CircleAlert className="size-3.5 shrink-0" aria-hidden />
      Cambió después de cerrarse: avisanos.
    </span>
  )
}
