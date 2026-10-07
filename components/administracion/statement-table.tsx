import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { formatIsoDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { Amount } from './amount'
import { DueStatus } from './due-status'
import { type BalanceKind, describeBalance, describeSideBalance, signedMovement } from './format'

export type StatementRow = {
  id: string
  /** `yyyy-MM-dd`. */
  date: string
  /** «Factura A 0003-00001234», «Pago», «Cierre del día». */
  voucher: string
  /** Link al detalle del comprobante (`/administracion/comprobantes/[id]`). */
  href?: string | null
  /** Leyenda o detalle; opcional. */
  detail?: string | null
  /** Vencimiento de la partida (con `showDue`). */
  dueDate?: string | null
  /** La partida ya está cancelada (con `showDue`: «Pagada»). */
  settled?: boolean
  debitCents: number | null
  creditCents: number | null
  /** Saldo acumulado DESPUÉS de este renglón, calculado en SQL. */
  balanceCents: number
  /** Comprobante anulado: se muestra tachado y no suma. */
  voided?: boolean
}

/**
 * Cómo se lee el saldo:
 * - `payable`: positivo = le debemos (lo aumenta el Haber: una factura).
 * - `receivable`: positivo = nos debe (lo aumenta el Debe: una venta).
 * - `treasury`: positivo = plata disponible (lo aumenta el Debe: una entrada).
 * - `side`: Debe − Haber con «D»/«A», como en el mayor.
 */
export type StatementBalanceMode = BalanceKind | 'side'

export type StatementTableProps = {
  rows: readonly StatementRow[]
  /** Para lectores de pantalla: «Estado de cuenta de Coca-Cola, octubre de 2026». */
  caption: string
  balanceMode: StatementBalanceMode
  /** Fila «Saldo anterior» (al día anterior al período). */
  opening?: { balanceCents: number; label?: string } | null
  /** Default «Debe»/«Haber». En un proveedor: «Pagos»/«Facturas»; en una caja: «Entradas»/«Salidas». */
  columnLabels?: { debit: string; credit: string }
  /** Columna «Vence» con el semáforo (necesita `today`). */
  showDue?: boolean
  today?: string
  /** Totales del período (de SQL) para el pie. */
  totals?: { debitCents: number; creditCents: number } | null
  /** Saldo final: «Saldo al 31/10/2026». */
  closing?: { label: string; balanceCents: number } | null
  /** Cuando no hay movimientos en el período. */
  emptyText?: ReactNode
  /** Abajo de todo: «Mostrando los últimos 500 movimientos…». */
  footnote?: ReactNode
  className?: string
}

/** ¿Este renglón hace crecer el saldo, en el sentido del modo? (para el signo en el celular). */
function increases(mode: StatementBalanceMode, row: StatementRow): boolean {
  const debit = row.debitCents ?? 0
  const credit = row.creditCents ?? 0
  return mode === 'payable' ? credit >= debit : debit >= credit
}

function BalanceCell({ cents, mode }: { cents: number; mode: StatementBalanceMode }) {
  if (mode === 'side') return <Amount cents={cents} side currency={false} />
  return <Amount cents={cents} balance={mode} words="contrary" />
}

function balancePlain(cents: number, mode: StatementBalanceMode): string {
  if (mode === 'side') {
    const d = describeSideBalance(cents, { currency: true })
    return d ? `${d.amount} ${d.side}` : '—'
  }
  const d = describeBalance(cents, mode, { words: 'contrary' })
  return [d.words, d.amount].filter(Boolean).join(' ') || '—'
}

/**
 * Estado de cuenta (proveedor, cliente, caja) y mayor: Fecha · Comprobante ·
 * Detalle · (Vence) · Debe · Haber · Saldo, con «Saldo anterior» arriba y los
 * totales al pie. En el celular cada movimiento es una tarjeta: fecha y
 * comprobante a la izquierda, el movimiento con signo a la derecha y el saldo
 * abajo. Server-safe.
 */
export function StatementTable({
  rows,
  caption,
  balanceMode,
  opening,
  columnLabels = { debit: 'Debe', credit: 'Haber' },
  showDue = false,
  today,
  totals,
  closing,
  emptyText = 'No hay movimientos en este período.',
  footnote,
  className,
}: StatementTableProps) {
  const withDue = showDue && Boolean(today)
  const columns = 6 + (withDue ? 1 : 0)
  const isEmpty = rows.length === 0

  return (
    <div className={cn('space-y-3', className)}>
      {/* Compu y tablet */}
      <DataTableShell className="hidden sm:block">
        <DataTableScroll>
          <DataTableRoot>
            <caption className="sr-only">{caption}</caption>
            <DataTableHead>
              <tr>
                <DataTableHeader className="w-28">Fecha</DataTableHeader>
                <DataTableHeader>Comprobante</DataTableHeader>
                <DataTableHeader>Detalle</DataTableHeader>
                {withDue ? <DataTableHeader>Vence</DataTableHeader> : null}
                <DataTableHeader className="text-right">{columnLabels.debit}</DataTableHeader>
                <DataTableHeader className="text-right">{columnLabels.credit}</DataTableHeader>
                <DataTableHeader className="text-right">Saldo</DataTableHeader>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {opening ? (
                <tr className="bg-secondary/20">
                  <DataTableCell colSpan={columns - 1} className="text-xs text-muted-foreground">
                    {opening.label ?? 'Saldo anterior'}
                  </DataTableCell>
                  <DataTableCell className="text-right text-muted-foreground">
                    <BalanceCell cents={opening.balanceCents} mode={balanceMode} />
                  </DataTableCell>
                </tr>
              ) : null}
              {isEmpty ? (
                <tr>
                  <DataTableCell
                    colSpan={columns}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    {emptyText}
                  </DataTableCell>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint',
                      row.voided && 'text-muted-foreground',
                    )}
                  >
                    <DataTableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatIsoDay(row.date)}
                    </DataTableCell>
                    <DataTableCell className="font-medium">
                      <Voucher row={row} />
                    </DataTableCell>
                    <DataTableCell className="max-w-[280px] text-muted-foreground">
                      <span className="line-clamp-2">{row.detail || '—'}</span>
                    </DataTableCell>
                    {withDue && today ? (
                      <DataTableCell>
                        {row.dueDate ? (
                          <DueStatus
                            dueDate={row.dueDate}
                            today={today}
                            settled={row.settled}
                            showDate
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </DataTableCell>
                    ) : null}
                    <DataTableCell className={cn('text-right', row.voided && 'line-through')}>
                      {row.debitCents ? <Amount cents={row.debitCents} currency={false} /> : null}
                    </DataTableCell>
                    <DataTableCell className={cn('text-right', row.voided && 'line-through')}>
                      {row.creditCents ? <Amount cents={row.creditCents} currency={false} /> : null}
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      <BalanceCell cents={row.balanceCents} mode={balanceMode} />
                    </DataTableCell>
                  </tr>
                ))
              )}
            </DataTableBody>
            {totals || closing ? (
              <tfoot className="bg-secondary/30 font-semibold">
                {totals ? (
                  <tr className="border-t border-border">
                    <DataTableCell colSpan={columns - 3} className="text-xs">
                      Totales del período
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      <Amount cents={totals.debitCents} currency={false} />
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      <Amount cents={totals.creditCents} currency={false} />
                    </DataTableCell>
                    <DataTableCell>{null}</DataTableCell>
                  </tr>
                ) : null}
                {closing ? (
                  <tr className="border-t-[3px] border-double border-border">
                    <DataTableCell colSpan={columns - 1} className="text-xs">
                      {closing.label}
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      <BalanceCell cents={closing.balanceCents} mode={balanceMode} />
                    </DataTableCell>
                  </tr>
                ) : null}
              </tfoot>
            ) : null}
          </DataTableRoot>
        </DataTableScroll>
      </DataTableShell>

      {/* Celular: tarjetas */}
      <div className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card sm:hidden">
        <ul aria-label={caption} className="divide-y divide-border/60">
          {opening ? (
            <li className="flex items-center justify-between gap-3 bg-secondary/20 px-4 py-3 text-sm">
              <span className="text-muted-foreground">{opening.label ?? 'Saldo anterior'}</span>
              <BalanceCell cents={opening.balanceCents} mode={balanceMode} />
            </li>
          ) : null}
          {isEmpty ? (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">{emptyText}</li>
          ) : (
            rows.map((row) => {
              const moved = Math.abs((row.debitCents ?? 0) - (row.creditCents ?? 0))
              return (
                <li key={row.id} className={cn('px-4 py-3', row.voided && 'opacity-70')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {formatIsoDay(row.date)}
                      </p>
                      <p className="truncate text-sm font-medium">
                        <Voucher row={row} />
                      </p>
                      {row.detail ? (
                        <p className="line-clamp-2 text-xs text-muted-foreground">{row.detail}</p>
                      ) : null}
                      {withDue && today && row.dueDate ? (
                        <DueStatus
                          dueDate={row.dueDate}
                          today={today}
                          settled={row.settled}
                          showDate
                        />
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={cn(
                          'text-sm font-medium tabular-nums whitespace-nowrap',
                          row.voided && 'line-through',
                        )}
                      >
                        {signedMovement(moved, increases(balanceMode, row))}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Saldo{' '}
                        <span className="tabular-nums">
                          {balancePlain(row.balanceCents, balanceMode)}
                        </span>
                      </p>
                    </div>
                  </div>
                </li>
              )
            })
          )}
          {closing ? (
            <li className="flex items-center justify-between gap-3 bg-secondary/30 px-4 py-3 text-sm font-semibold">
              <span>{closing.label}</span>
              <BalanceCell cents={closing.balanceCents} mode={balanceMode} />
            </li>
          ) : null}
        </ul>
      </div>

      {footnote ? <p className="text-xs text-muted-foreground">{footnote}</p> : null}
    </div>
  )
}

function Voucher({ row }: { row: StatementRow }) {
  const label = (
    <>
      {row.voucher}
      {row.voided ? (
        <span className="ml-2 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Anulado
        </span>
      ) : null}
    </>
  )
  if (!row.href) return label
  return (
    <Link
      href={row.href}
      className="rounded-sm underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
    </Link>
  )
}
