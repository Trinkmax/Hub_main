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
import { cashDiffText, type Projection, type ProjectionDay } from '@/lib/accounting/projection'
import type { CashCountTreasury, DailyCashCounts } from '@/lib/accounting/queries/projection'
import { formatDayLabel } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { CashCountDialog } from './cash-count-dialog'
import { BareShell, longDay } from './projection-table'

function Dash() {
  return <span className="text-xs text-muted-foreground/60">—</span>
}

/** Lo que falta para poder comparar, una oración por motivo. */
export function cashPending(
  cash: Pick<Projection['cash'], 'missingCountDays' | 'missingCloseDays'>,
): string[] {
  const out: string[] = []
  if (cash.missingCountDays > 0) {
    out.push(
      cash.missingCountDays === 1
        ? 'A 1 día con cierre le falta cargar lo que entró.'
        : `A ${cash.missingCountDays} días con cierre les falta cargar lo que entró.`,
    )
  }
  if (cash.missingCloseDays > 0) {
    out.push(
      cash.missingCloseDays === 1
        ? 'A 1 día con lo que entró le falta el cierre.'
        : `A ${cash.missingCloseDays} días con lo que entró les falta el cierre.`,
    )
  }
  return out
}

/** La diferencia en palabras («Faltan $ X», «Sobran $ X», «Coincide») o qué punta falta. */
function Difference({ day }: { day: ProjectionDay }) {
  switch (day.cash.kind) {
    case 'compared': {
      const diff = day.cash.diffCents
      return (
        <span
          className={cn(
            'whitespace-nowrap font-medium tabular-nums',
            diff === 0 ? 'text-success' : diff < 0 ? 'text-warning-text' : 'text-foreground',
          )}
        >
          {cashDiffText(diff)}
        </span>
      )
    }
    case 'missing_count':
      return <span className="text-xs text-muted-foreground">Falta cargar lo que entró</span>
    case 'missing_close':
      return <span className="text-xs text-muted-foreground">Falta el cierre</span>
    default:
      return <Dash />
  }
}

/**
 * «Ventas contra caja» (pedido de los socios, 12/10/2026): por día, lo vendido
 * en el salón según el cierre contra lo que entró de verdad en las cajas,
 * cargado a mano, y la diferencia. El delivery no entra: se acredita en otro
 * momento. Es una comparación para encontrar diferencias: no registra nada en
 * los libros.
 *
 * Con `bare` va sin su encabezado y sin la tarjeta: es la tabla plegada dentro
 * del bloque «Ventas contra caja» de «El mes», que ya trae el título.
 */
export function CashTable({
  projection,
  counts,
  treasuries,
  monthLabel,
  base,
  canWrite,
  bare = false,
}: {
  /** Sin encabezado y sin tarjeta propia. */
  bare?: boolean
  projection: Projection
  counts: DailyCashCounts
  treasuries: readonly CashCountTreasury[]
  monthLabel: string
  base: string
  canWrite: boolean
}) {
  // Un día que todavía no pasó no tiene nada para comparar.
  const days = projection.days.filter((d) => d.moment !== 'future')
  const { cash, totals } = projection

  const sales = (d: ProjectionDay): ReactNode =>
    d.hasClose ? (
      <Amount cents={d.realCents} decimals={0} />
    ) : canWrite ? (
      <Link
        href={`${base}/ventas/cierre?fecha=${d.day}`}
        className="text-xs font-medium text-foreground underline-offset-4 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring hover:underline"
      >
        Cargar cierre
      </Link>
    ) : (
      <span className="text-xs text-muted-foreground">Sin cierre</span>
    )

  const counted = (d: ProjectionDay): ReactNode => {
    if (!canWrite) {
      return d.cashCountedCents === null ? (
        <span className="text-xs text-muted-foreground">Sin cargar</span>
      ) : (
        <Amount cents={d.cashCountedCents} decimals={0} />
      )
    }
    const initial = counts[d.day] ?? {}
    return (
      <CashCountDialog
        day={d.day}
        dayLabel={longDay(d.day)}
        treasuries={treasuries.filter((t) => t.active || initial[t.id] !== undefined)}
        initial={initial}
        salesCents={d.hasClose ? d.realCents : null}
        countedCents={d.cashCountedCents}
      />
    )
  }

  // Dentro del bloque de «El mes», lo que falta ya lo dice el bloque, arriba de la tabla.
  const pending = bare ? [] : cashPending(cash)

  const Shell = bare ? BareShell : DataTableShell
  return (
    <Shell>
      {bare ? null : (
        <header className="border-b border-border/60 px-5 py-4">
          <div className="max-w-2xl">
            <h2 className="font-serif text-lg font-semibold tracking-tight">Ventas contra caja</h2>
            <p className="text-xs text-muted-foreground text-pretty">
              {monthLabel} · La venta real del salón (el cierre del día menos las comisiones
              estimadas del posnet) contra lo que entró de verdad en las cajas. El delivery no
              entra: llega después. No se registra nada en los libros: es para encontrar
              diferencias.
            </p>
          </div>
        </header>
      )}

      {days.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          Este mes todavía no tiene días para comparar.
        </p>
      ) : (
        <>
          {/* Compu y tablet: la tabla. */}
          <div className="hidden sm:block">
            <DataTableScroll>
              <DataTableRoot>
                <caption className="sr-only">
                  Venta real del salón contra caja por día, {monthLabel}
                </caption>
                <DataTableHead>
                  <tr>
                    <DataTableHeader>Día</DataTableHeader>
                    <DataTableHeader className="text-right">Venta real del salón</DataTableHeader>
                    <DataTableHeader className="text-right">Entró</DataTableHeader>
                    <DataTableHeader className="text-right">Diferencia</DataTableHeader>
                  </tr>
                </DataTableHead>
                <DataTableBody>
                  {days.map((d) => (
                    <tr
                      key={d.day}
                      className="transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint"
                    >
                      <DataTableCell
                        className={cn(
                          'whitespace-nowrap py-1.5 tabular-nums',
                          d.moment === 'today' && 'font-semibold',
                        )}
                      >
                        {formatDayLabel(d.day)}
                        {d.moment === 'today' ? (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            Hoy
                          </span>
                        ) : null}
                      </DataTableCell>
                      <DataTableCell className="py-1.5 text-right">{sales(d)}</DataTableCell>
                      <DataTableCell className="py-1.5 text-right">{counted(d)}</DataTableCell>
                      <DataTableCell className="py-1.5 text-right">
                        <Difference day={d} />
                      </DataTableCell>
                    </tr>
                  ))}
                </DataTableBody>
                <tfoot className="border-t border-border bg-secondary/30 font-semibold">
                  <tr>
                    <DataTableCell>
                      {cash.comparedDays === 1
                        ? 'Total de 1 día comparado'
                        : `Total de ${cash.comparedDays} días comparados`}
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      {cash.comparedDays > 0 ? (
                        <Amount cents={cash.salesCents} decimals={0} />
                      ) : (
                        <Dash />
                      )}
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      {cash.comparedDays > 0 ? (
                        <Amount cents={cash.countedCents} decimals={0} />
                      ) : (
                        <Dash />
                      )}
                    </DataTableCell>
                    <DataTableCell className="whitespace-nowrap text-right tabular-nums">
                      {cash.comparedDays > 0 ? cashDiffText(cash.diffCents) : <Dash />}
                    </DataTableCell>
                  </tr>
                </tfoot>
              </DataTableRoot>
            </DataTableScroll>
          </div>

          {/* Celular: cada día con lo vendido y lo que entró; la diferencia, debajo. */}
          <ul
            aria-label={`Venta real del salón contra caja por día, ${monthLabel}`}
            className="divide-y divide-border/60 sm:hidden"
          >
            {days.map((d) => (
              <li key={d.day} className="space-y-1 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={cn(
                      'text-sm font-medium tabular-nums',
                      d.moment === 'today' && 'font-semibold',
                    )}
                  >
                    {formatDayLabel(d.day)}
                    {d.moment === 'today' ? (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">Hoy</span>
                    ) : null}
                  </span>
                  <Difference day={d} />
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">Venta real {sales(d)}</span>
                  <span className="flex items-center gap-1.5">Entró {counted(d)}</span>
                </div>
              </li>
            ))}
            {cash.comparedDays > 0 ? (
              <li className="space-y-1 bg-secondary/30 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3 font-semibold">
                  <span>
                    {cash.comparedDays === 1
                      ? 'Total de 1 día comparado'
                      : `Total de ${cash.comparedDays} días comparados`}
                  </span>
                  <span className="whitespace-nowrap tabular-nums">
                    {cashDiffText(cash.diffCents)}
                  </span>
                </div>
              </li>
            ) : null}
          </ul>
        </>
      )}

      {pending.length > 0 || totals.eventsCents > 0 ? (
        <p className="border-t border-border/60 px-5 py-3 text-xs text-muted-foreground text-pretty">
          {[
            ...pending,
            totals.eventsCents > 0
              ? 'Las ventas de salón incluyen lo vendido por el canal Eventos.'
              : null,
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
      ) : null}
    </Shell>
  )
}
