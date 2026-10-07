import { CircleCheck } from 'lucide-react'
import type * as React from 'react'
import { Amount } from '@/components/ui/amount'
import {
  DataTableBody,
  DataTableCell,
  DataTableFoot,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableRow,
  DataTableScroll,
} from '@/components/ui/data-table'
import { formatDate } from '@/lib/dates/format'
import type { CentsValue } from '@/lib/money/format'
import { cn } from '@/lib/utils'
import { BalanceSeal } from './balance-seal'
import { entryBalance, hasAmount } from './entry-balance'

/**
 * Una línea del asiento. Es compatible con `EntryPreviewLine` del motor
 * (`lib/accounting/types.ts`): `toEntryPreview(bundle, ctx)[n].lines` entra tal
 * cual. Los formularios que arman la vista previa a mano pasan lo mínimo.
 */
export type EntryLine = {
  /** Estable entre renders (el motor usa `'<documento>:<línea>'`). */
  id?: string
  accountCode: string
  accountName: string
  debitCents?: CentsValue
  creditCents?: CentsValue
  /** La leyenda del renglón. */
  note?: string | null
  /** El partícipe de una cuenta de control («Distribuidora del Centro SA»). */
  partyName?: string | null
  /** El vencimiento de la partida (`'yyyy-MM-dd'`). */
  dueDate?: string | null
}

export type EntryPreviewProps = Omit<React.ComponentProps<'section'>, 'title' | 'children'> & {
  lines: readonly EntryLine[]
  /** Default «Asiento que se va a generar». También nombra la tabla para el lector. */
  title?: string
  /** Default `h2` (al lado de las `FormSection` del formulario). */
  titleAs?: 'h2' | 'h3' | 'h4'
  /** Default «Completá los importes para ver el asiento.» */
  emptyText?: React.ReactNode
  /** Default `compact` (36 px por fila, como un libro). */
  density?: 'compact' | 'comfortable'
  /** Default `true`: el código de la cuenta antes del nombre. */
  showCodes?: boolean
}

type Side = 'debit' | 'credit'

/** Del Debe si tiene importe en el Debe; del Haber si solo lo tiene en el Haber; `null` sin importe. */
function sideOf(line: EntryLine): Side | null {
  if (hasAmount(line.debitCents)) return 'debit'
  if (hasAmount(line.creditCents)) return 'credit'
  return null
}

/** Las mismas clases de una celda del kit, para el `<th>` de «Totales». */
const ROW_HEADER_CELL =
  'px-[var(--cell-px,1rem)] py-[var(--cell-py,0.5rem)] text-start align-middle text-foreground'

/** Las del Haber: 16 px de sangría (sobre el relleno de la celda) y la «a» delante. */
const CREDIT_INDENT = 'ps-[calc(var(--cell-px,1rem)+1rem)]'

function LineMeta({ line }: { line: EntryLine }) {
  const due = line.dueDate ? formatDate(line.dueDate) : ''
  const parts = [
    line.partyName?.trim() || null,
    due ? `vence ${due}` : null,
    line.note?.trim() || null,
  ].filter((part): part is string => part !== null)
  if (parts.length === 0) return null
  return (
    <span data-slot="entry-preview-meta" className="block type-caption text-muted-foreground">
      {parts.join(' · ')}
    </span>
  )
}

/**
 * La vista previa del asiento (kit §3.8): «la vista previa es exactamente lo
 * que se guarda» (Sprint 1, E.7). Server-safe; el sello que cambia es una isla
 * cliente chica (`BalanceSeal`).
 *
 * - **Encabezado:** título en `type-subtitle` y, a la derecha, el sello:
 *   «Cuadra», «No cuadra · diferencia $ 12,40» o «Sin importes», en una región
 *   `role="status"` que habla solo cuando cambia el estado.
 * - **Tabla compacta Cuenta · Debe · Haber:** primero el Debe; las del Haber
 *   con 16 px de sangría y una «a» delante («a Proveedores»), como el libro
 *   diario. El código en `type-amount text-subtle-foreground`. Importes con
 *   dos decimales (lo contable no esconde centavos), sin «$» repetido.
 * - **Pie:** los totales con la regla contable (raya simple arriba, doble
 *   abajo) y «Debe = Haber» cuando cuadra.
 * - Las líneas sin importe no van: un renglón en cero no es parte del asiento
 *   (el motor también los descarta). Sin ninguna, el texto de vacío.
 *
 * ```tsx
 * const result = buildPurchase(input, ctx, { clientRef })
 * {result.ok ? result.preview.map((entry) => (
 *   <EntryPreview key={entry.documentRef} lines={entry.lines} />
 * )) : <EntryPreview lines={[]} />}
 * ```
 */
function EntryPreview({
  lines,
  title = 'Asiento que se va a generar',
  titleAs: Title = 'h2',
  emptyText = 'Completá los importes para ver el asiento.',
  density = 'compact',
  showCodes = true,
  className,
  ...props
}: EntryPreviewProps) {
  const debitLines = lines.filter((line) => sideOf(line) === 'debit')
  const creditLines = lines.filter((line) => sideOf(line) === 'credit')
  const ordered: Array<{ line: EntryLine; side: Side }> = [
    ...debitLines.map((line) => ({ line, side: 'debit' as const })),
    ...creditLines.map((line) => ({ line, side: 'credit' as const })),
  ]
  const balance = entryBalance(lines)

  return (
    <section
      data-slot="entry-preview"
      data-status={balance.status}
      className={cn('min-w-0 overflow-clip rounded-xl border border-border bg-card', className)}
      {...props}
    >
      <div
        data-slot="entry-preview-header"
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-3.5 pb-3"
      >
        <Title className="type-subtitle text-foreground">{title}</Title>
        <BalanceSeal status={balance.status} diffCents={balance.diff} />
      </div>
      {ordered.length === 0 ? (
        <p
          data-slot="entry-preview-empty"
          className="border-t border-border px-4 py-4 type-small text-pretty text-muted-foreground"
        >
          {emptyText}
        </p>
      ) : (
        // Si no entra (una columna angosta en el celular), scroll horizontal: nunca se recorta un importe.
        <DataTableScroll>
          <DataTableRoot density={density} caption={title}>
            <DataTableHead>
              <tr>
                <DataTableHeader>Cuenta</DataTableHeader>
                {/* `w-px`: los importes miden lo que su cifra (no se cortan); el resto es para la cuenta. */}
                <DataTableHeader numeric className="w-px">
                  Debe
                </DataTableHeader>
                <DataTableHeader numeric className="w-px">
                  Haber
                </DataTableHeader>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {ordered.map(({ line, side }, index) => (
                <DataTableRow key={line.id ?? `${side}-${index.toString()}`} data-side={side}>
                  <DataTableCell className={cn(side === 'credit' && CREDIT_INDENT)}>
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      {side === 'credit' ? (
                        <span data-slot="entry-preview-to" className="text-subtle-foreground">
                          a
                        </span>
                      ) : null}
                      {showCodes ? (
                        <span
                          data-slot="entry-preview-code"
                          className="shrink-0 type-amount text-subtle-foreground"
                        >
                          {line.accountCode}
                        </span>
                      ) : null}
                      <span className="min-w-0 text-pretty">
                        {line.accountName}
                        <LineMeta line={line} />
                      </span>
                    </span>
                  </DataTableCell>
                  <DataTableCell numeric>
                    {side === 'debit' ? <Amount cents={line.debitCents} currency={false} /> : null}
                  </DataTableCell>
                  <DataTableCell numeric>
                    {side === 'credit' || hasAmount(line.creditCents) ? (
                      <Amount cents={line.creditCents} currency={false} />
                    ) : null}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
            <DataTableFoot>
              <tr>
                <th scope="row" className={ROW_HEADER_CELL}>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="type-label">Totales</span>
                    {balance.status === 'balanced' ? (
                      <span
                        data-slot="entry-preview-check"
                        className="inline-flex items-center gap-1 type-caption font-medium text-success-text"
                      >
                        <CircleCheck aria-hidden="true" className="size-3.5 shrink-0" />
                        Debe = Haber
                      </span>
                    ) : null}
                  </span>
                </th>
                <DataTableCell numeric>
                  <Amount cents={balance.debit} currency={false} />
                </DataTableCell>
                <DataTableCell numeric>
                  <Amount cents={balance.credit} currency={false} />
                </DataTableCell>
              </tr>
            </DataTableFoot>
          </DataTableRoot>
        </DataTableScroll>
      )}
    </section>
  )
}

export { EntryPreview }
