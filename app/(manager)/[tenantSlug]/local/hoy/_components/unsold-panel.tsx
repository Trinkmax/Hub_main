import { Panel } from '@/components/administracion/kit/panel'
import { formatCentsShort } from '@/lib/money'
import { clockAt } from '@/lib/pos/order/clock'
import type { UnsoldEntry, UnsoldReason, UnsoldReport } from '@/lib/pos/unsold/report'

/**
 * «Salió sin venderse» (pedido de los socios, 16/11/2026: «bajar de stock lo mal comandado, lo de
 * los socios, etc.»). Lo que dejó la cocina o la barra y no se cobró: las mesas que no se cobraron
 * (consumo de socios, invitaciones) y las bajas de algo que ya estaba hecho, por motivo y al precio de
 * la carta. No es plata que entró ni cuenta como venta.
 *
 * Aparte, en chico, lo que se parece pero no es: las bajas de algo que no llegó a hacerse (no se
 * perdió nada) y los descuentos a mesas que sí pagaron (plata, no productos).
 */

const money = (cents: number) => formatCentsShort(cents)
const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

function reasonNote(row: UnsoldReason): string {
  return row.units > 0
    ? count(row.units, 'producto', 'productos')
    : count(row.count, 'vez', 'veces')
}

function where(entry: UnsoldEntry): string {
  return entry.tableLabel ? `Mesa ${entry.tableLabel}` : 'Sin mesa'
}

function itemsText(entry: UnsoldEntry): string {
  return entry.items.map((item) => `${item.quantity} ${item.name}`).join(', ')
}

const KIND_NOTE: Readonly<Record<UnsoldEntry['kind'], string | null>> = {
  comp: 'no se cobró',
  void_made: 'baja, ya estaba hecho',
  void_not_made: 'baja, no llegó a hacerse',
  discount: 'descuento',
}

export function UnsoldPanel({
  report,
  timeZone,
  isToday,
  className,
}: {
  report: UnsoldReport
  timeZone: string
  isToday: boolean
  className?: string
}) {
  const left = report.entries.filter((entry) => entry.kind === 'comp' || entry.kind === 'void_made')
  const rest = report.entries.filter(
    (entry) => entry.kind === 'void_not_made' || entry.kind === 'discount',
  )
  const top = report.leftByReason[0]?.cents ?? 0

  return (
    <Panel
      title="Salió sin venderse"
      description="Lo que dejó la cocina o la barra y no se cobró: mesas que no se cobraron y bajas de algo que ya estaba hecho. Al precio de la carta; no cuenta como venta."
      className={className}
    >
      <div data-testid="hoy-sin-vender">
        {report.leftCents === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isToday ? 'Hasta ahora, nada.' : 'Ese día, nada.'}
          </p>
        ) : (
          <div className="grid gap-x-8 gap-y-4 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] md:items-start">
            <div>
              <p
                className="font-serif text-3xl font-semibold leading-none tracking-tight tabular-nums"
                data-testid="hoy-sin-vender-total"
              >
                {money(report.leftCents)}
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {count(report.leftUnits, 'producto', 'productos')}
              </p>
            </div>
            <ul className="space-y-3">
              {report.leftByReason.map((row) => (
                <li key={row.reason}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{row.reason}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{reasonNote(row)}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(row.cents)}</span>
                  </div>
                  <div aria-hidden className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-warning-text/70"
                      style={{ width: `${Math.max(top > 0 ? (row.cents / top) * 100 : 0, 2)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {left.length > 0 ? (
          <details className="group mt-4 border-t border-border/60 pt-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8 [&::-webkit-details-marker]:hidden">
              <span
                aria-hidden
                className="inline-block transition-transform duration-150 group-open:rotate-90"
              >
                ›
              </span>
              Qué fue, uno por uno
              <span className="font-normal text-muted-foreground">({left.length})</span>
            </summary>
            <EntryList entries={left} timeZone={timeZone} />
          </details>
        ) : null}

        {report.notMadeLines > 0 || report.discountCents > 0 ? (
          <details className="group mt-3 border-t border-border/60 pt-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-start gap-2 text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8 [&::-webkit-details-marker]:hidden">
              <span
                aria-hidden
                className="inline-block transition-transform duration-150 group-open:rotate-90"
              >
                ›
              </span>
              <span className="text-pretty">
                Aparte
                {report.notMadeLines > 0 ? (
                  <>
                    : <b className="font-semibold text-foreground">{money(report.notMadeCents)}</b>{' '}
                    en {count(report.notMadeLines, 'baja', 'bajas')} de algo que no llegó a hacerse
                    (no se perdió nada)
                  </>
                ) : null}
                {report.discountCents > 0 ? (
                  <>
                    {report.notMadeLines > 0 ? ' y ' : ': '}
                    <b className="font-semibold text-foreground">{money(report.discountCents)}</b>{' '}
                    en descuentos a mesas que pagaron
                    {report.discountByReason.length > 0
                      ? ` (${report.discountByReason
                          .map((row) => `${row.reason} ${money(row.cents)}`)
                          .join(', ')})`
                      : ''}
                  </>
                ) : null}
                .
              </span>
            </summary>
            <EntryList entries={rest} timeZone={timeZone} />
          </details>
        ) : null}
      </div>
    </Panel>
  )
}

function EntryList({ entries, timeZone }: { entries: readonly UnsoldEntry[]; timeZone: string }) {
  return (
    <ul className="mt-1 divide-y divide-border/60">
      {entries.map((entry) => (
        <li
          key={entry.key}
          className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-baseline gap-x-3 py-2.5 text-sm"
        >
          <span className="tabular-nums text-muted-foreground">{clockAt(entry.at, timeZone)}</span>
          <span className="min-w-0">
            <span className="font-medium">{entry.reason}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {[where(entry), KIND_NOTE[entry.kind], entry.byName ? `por ${entry.byName}` : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {entry.items.length > 0 ? (
              <span className="mt-0.5 block text-xs text-muted-foreground text-pretty">
                {itemsText(entry)}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 tabular-nums">{money(entry.cents)}</span>
        </li>
      ))}
    </ul>
  )
}
