import { Check } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { VoucherText } from '@/components/administracion/voucher-text'
import { formatDayMonth } from '@/lib/dates'
import { formatCents, formatCentsShort, MINUS_SIGN } from '@/lib/money'
import { cn } from '@/lib/utils'
import { documentHref } from '../../../_lib/links'
import { type LedgerLine, ledgerLineName, type SupplierLedger } from '../../../_lib/supplier-ledger'

/** Con centavos solo si los tiene: la libreta no redondea lo que se debe. */
function money(cents: number): string {
  return cents % 100 === 0 ? formatCentsShort(cents) : formatCents(cents)
}

/** «Le debés» de un renglón: la deuda en pesos, lo que hay a favor dicho con palabras, o una raya. */
function owed(cents: number): ReactNode {
  if (cents > 0) return money(cents)
  if (cents < 0) return `a favor ${money(-cents)}`
  return (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">nada</span>
    </>
  )
}

const TONE: Readonly<Record<NonNullable<LedgerLine['status']>['tone'], string>> = {
  ok: 'text-success',
  warn: 'text-warning-text',
  late: 'text-destructive',
  muted: 'text-muted-foreground',
}

/** Tres columnas de plata de 8rem; por debajo de 48rem de panel, el formato del celular. */
const ROW =
  'grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 @[48rem]:grid-cols-[3.25rem_minmax(0,1fr)_8rem_8rem_8rem]'
const CELL = 'hidden text-right tabular-nums whitespace-nowrap @[48rem]:block'

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className={CELL}>
      {children ? <span className="sr-only">{label}: </span> : null}
      {children}
    </span>
  )
}

/**
 * Los renglones de la libreta de un proveedor, del más viejo al más nuevo, con
 * las tres palabras de una cuenta corriente rotuladas UNA sola vez arriba:
 *
 *                                         Te dejó    Le pagaste    Le debés
 *   10/09  Te dejó     Factura A 0003-…   $ 1.210.000              $ 1.210.000
 *   03/10  Le pagaste  n.º 12                         $ 500.000      $ 710.000
 *
 * El sentido lo dan la columna Y el verbo («Te dejó», «Le pagaste», «Te
 * descontó»), nunca solo el color. En una hoja angosta (el celular) no hay
 * columnas: el verbo, el importe con su signo y debajo «le debés $ X».
 *
 * Es lo que ve el dueño; la contadora tiene la tabla de siempre en «Ver como
 * tabla» (`StatementTable`). Server-safe.
 */
export function LedgerLines({
  tenantSlug,
  ledger,
}: {
  tenantSlug: string
  ledger: SupplierLedger
}) {
  return (
    <div className="@container">
      <div
        aria-hidden
        className={cn(
          ROW,
          'hidden border-b border-border/60 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground @[48rem]:grid',
        )}
      >
        <span />
        <span />
        <span className="text-right">Te dejó</span>
        <span className="text-right">Le pagaste</span>
        <span className="text-right">Le debés</span>
      </div>

      <ol
        aria-label="Movimientos, del más viejo al más nuevo"
        className="divide-y divide-border/60"
      >
        {ledger.opening ? (
          <li className={cn(ROW, 'py-2.5 text-sm text-muted-foreground')}>
            <span />
            <span className="text-pretty">{ledger.opening.text}</span>
            <span className={CELL} />
            <span className={CELL} />
            <span className={CELL} aria-hidden>
              {owed(ledger.opening.balanceCents)}
            </span>
          </li>
        ) : null}

        {ledger.lines.map((line) => (
          // Todo el renglón lleva al comprobante (el link se estira): en el celular
          // el texto solo era un blanco de 17 px.
          <li
            key={line.id}
            className={cn(
              ROW,
              'relative py-2.5 text-sm',
              line.documentId && 'hover:bg-secondary/40',
            )}
          >
            <span className="pt-px text-xs tabular-nums text-muted-foreground">
              {formatDayMonth(line.date)}
            </span>
            <div className="min-w-0">
              <p className="text-pretty">
                <span className="font-semibold">{line.verb}</span>{' '}
                {line.documentId ? (
                  <Link
                    href={documentHref(tenantSlug, line.documentId)}
                    className="rounded-sm underline decoration-border underline-offset-4 outline-none after:absolute after:inset-0 after:content-[''] hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <VoucherText text={ledgerLineName(line)} />
                  </Link>
                ) : (
                  <VoucherText text={ledgerLineName(line)} />
                )}
              </p>
              {line.status ? (
                <p
                  className={cn('mt-0.5 flex items-center gap-1.5 text-xs', TONE[line.status.tone])}
                >
                  {line.status.tone === 'ok' ? (
                    <Check aria-hidden className="size-3 shrink-0" strokeWidth={3} />
                  ) : (
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
                  )}
                  {line.status.text}
                </p>
              ) : null}
              {/* Hoja angosta: sin columnas, el importe con su signo y cómo queda la deuda. */}
              <p className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 tabular-nums @[48rem]:hidden">
                <span className="font-medium whitespace-nowrap">
                  {line.increaseCents !== null ? `+ ${money(line.increaseCents)}` : null}
                  {line.decreaseCents !== null
                    ? `${MINUS_SIGN} ${money(line.decreaseCents)}`
                    : null}
                </span>
                <span className="text-xs whitespace-nowrap text-muted-foreground">
                  {line.balanceCents > 0
                    ? `le debés ${money(line.balanceCents)}`
                    : line.balanceCents < 0
                      ? `a favor ${money(-line.balanceCents)}`
                      : 'no le debés nada'}
                </span>
              </p>
            </div>
            <Cell label="Te dejó">
              {line.increaseCents !== null ? money(line.increaseCents) : null}
            </Cell>
            <Cell label="Le pagaste">
              {line.decreaseCents !== null ? money(line.decreaseCents) : null}
            </Cell>
            <Cell label="Le debés">{owed(line.balanceCents)}</Cell>
          </li>
        ))}

        {ledger.closing ? (
          <li className={cn(ROW, 'py-3 text-sm font-semibold')}>
            <span />
            <span className="flex flex-wrap items-baseline justify-between gap-x-3">
              {ledger.closing.text}
              <span className="tabular-nums whitespace-nowrap @[48rem]:hidden">
                {ledger.closing.balanceCents !== 0
                  ? money(Math.abs(ledger.closing.balanceCents))
                  : null}
              </span>
            </span>
            <span className={CELL} />
            <span className={CELL} />
            <span className={CELL}>
              {ledger.closing.balanceCents !== 0
                ? money(Math.abs(ledger.closing.balanceCents))
                : null}
            </span>
          </li>
        ) : null}
      </ol>
    </div>
  )
}
