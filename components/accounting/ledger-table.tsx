import Link from 'next/link'
import type * as React from 'react'
import { Amount } from '@/components/ui/amount'
import {
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableFoot,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableRow,
  DataTableScroll,
  DataTableShell,
  DataTableTruncated,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate } from '@/lib/dates/format'
import { formatCents } from '@/lib/money/format'
import { cn } from '@/lib/utils'

export type LedgerRow = {
  id: string
  /** `'yyyy-MM-dd'` (o un instante: se lee en el día de Córdoba). */
  date: string
  /** «Factura A 0003-00001234». */
  description: React.ReactNode
  /** Concepto, contrapartida o número: va debajo, en chico. */
  reference?: string
  /** Al comprobante o al asiento: la fila entera es el link (una sola parada de Tab). */
  href?: string
  dueDate?: string | null
  debitCents: number | bigint | null
  creditCents: number | bigint | null
  /**
   * Saldo acumulado **calculado en SQL** (función de ventana sobre todo el
   * período), nunca sumado en el cliente sobre una página: la tabla lo
   * muestra tal cual.
   */
  balanceCents: number | bigint
}

export type LedgerBalance = { label?: string; balanceCents: number | bigint }

export type LedgerTableProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  rows: readonly LedgerRow[]
  /** Nombre accesible de la tabla (solo para lectores). */
  caption: string
  /** «Saldo anterior»: primera fila, solo en la columna Saldo. */
  opening?: LedgerBalance
  /**
   * El saldo de cierre, de la consulta. Sin esto, con `closingLabel` y sin
   * `truncated`, el cierre es el saldo acumulado de la última fila (que ya
   * viene de SQL); con `truncated` no se dibuja: la última fila no es el final.
   */
  closing?: LedgerBalance
  /** «Saldo al 30/09/2026». */
  closingLabel?: string
  /** Default Debe/Haber · Facturas/Pagos (estado de cuenta) · Entradas/Salidas (cajas). */
  columnLabels?: { debit: string; credit: string }
  /** Default «Comprobante». */
  descriptionLabel?: string
  /** `side` (default, el mayor): absoluto + D/A · `signed` (estado de cuenta): con signo. */
  balanceMode?: 'signed' | 'side'
  /** Columna «Vence». */
  showDue?: boolean
  /** Los totales del período, de SQL (nunca sumados en el cliente). */
  totals?: { debitCents: number | bigint; creditCents: number | bigint }
  /** Tope de filas: el aviso arriba. `true` dice el texto de siempre; un nodo, el propio. */
  truncated?: boolean | React.ReactNode
  /** Default `scroll` (libros); el estado de cuenta en el celular usa `cards`. */
  mobile?: 'scroll' | 'cards'
  /** Default `compact` (36 px por fila). */
  density?: 'compact' | 'comfortable'
  /** `page` pega debajo del topbar; `container` adentro de `maxHeight`. */
  stickyHeader?: 'container' | 'page'
  maxHeight?: string
  /** Fecha con año. Default: solo si las fechas cruzan de año (`dd/MM` si no). */
  showYear?: boolean
  /** Sin movimientos en el período. Default «Sin movimientos en el período». */
  empty?: React.ReactNode
}

const DEFAULT_LABELS = { debit: 'Debe', credit: 'Haber' } as const
const DEFAULT_TRUNCATED =
  'Mostramos los primeros 1.000 movimientos. Acotá el período para ver todo.'

/** La misma celda de las del kit, para los `<th scope="row">` de las filas especiales. */
const ROW_HEADER_CELL =
  'px-[var(--cell-px,1rem)] py-[var(--cell-py,0.5rem)] text-start align-middle font-normal'

/** El link estirado de una tarjeta (igual que el de las filas de `DataTable`). */
const CARD_LINK_CLASSES =
  'outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-(--ring)'

function toBigInt(value: number | bigint): bigint {
  if (typeof value === 'bigint') return value
  if (!Number.isFinite(value)) return 0n
  return BigInt(value < 0 ? -Math.round(-value) : Math.round(value))
}

function hasMovement(value: number | bigint | null): value is number | bigint {
  return value !== null && toBigInt(value) !== 0n
}

/** `'2026-09-15'` → `'15/09'` o `'15/09/2026'`. */
function ledgerDate(value: string | null | undefined, withYear: boolean): string {
  const text = formatDate(value)
  return withYear ? text : text.slice(0, 5)
}

/** ¿Las fechas (y vencimientos) cruzan de año? */
function crossesYears(rows: readonly LedgerRow[], showDue: boolean): boolean {
  const years = new Set<string>()
  for (const row of rows) {
    const date = formatDate(row.date)
    if (date) years.add(date.slice(6))
    if (showDue && row.dueDate) {
      const due = formatDate(row.dueDate)
      if (due) years.add(due.slice(6))
    }
  }
  return years.size > 1
}

/** Un saldo: con D/A (y sin lado si es cero) o con signo. */
function BalanceAmount({
  cents,
  mode,
  currency = false,
  className,
}: {
  cents: number | bigint
  mode: 'signed' | 'side'
  currency?: false | 'ARS'
  className?: string
}) {
  if (mode === 'side' && toBigInt(cents) !== 0n) {
    return <Amount cents={cents} side="auto" currency={currency} className={className} />
  }
  return <Amount cents={cents} currency={currency} className={className} />
}

/**
 * El libro (kit §3.8): mayor, movimientos de una caja y estado de cuenta.
 * Server-safe, sobre los primitivos de la tabla del kit.
 *
 * - **Columnas:** Fecha (`dd/MM`, con año si el período cruza años) ·
 *   Comprobante (la fila es el link) · Vence · Debe · Haber · Saldo.
 * - **Saldo acumulado:** viene calculado de SQL en cada fila. La tabla nunca
 *   suma en el cliente: ni el saldo ni los totales (que también vienen de la
 *   consulta, en `totals`).
 * - **D/A:** en el mayor (`side`) el saldo va en absoluto con «D» o «A» (y la
 *   palabra «deudor»/«acreedor» para el lector); en el estado de cuenta
 *   (`signed`), con signo.
 * - **Filas especiales:** «Saldo anterior» primera, solo en la columna Saldo y
 *   apagada; el cierre en el pie, en semibold y con la regla doble.
 * - **Filas de 36 px** (`compact`) y el aviso de tope arriba (`truncated`).
 * - **Celular:** `scroll` (scroll horizontal) o `cards`: fecha y descripción
 *   a la izquierda, el movimiento con signo a la derecha (+ factura, − pago) y
 *   el saldo abajo.
 */
function LedgerTable({
  rows,
  caption,
  opening,
  closing,
  closingLabel,
  columnLabels = DEFAULT_LABELS,
  descriptionLabel = 'Comprobante',
  balanceMode = 'side',
  showDue = false,
  totals,
  truncated,
  mobile = 'scroll',
  density = 'compact',
  stickyHeader,
  maxHeight,
  showYear,
  empty,
  className,
  ...props
}: LedgerTableProps) {
  const cards = mobile === 'cards'
  const withYear = showYear ?? crossesYears(rows, showDue)
  const textColumns = showDue ? 3 : 2
  const columnCount = textColumns + 3
  const lastRow = rows[rows.length - 1]
  const closingCents =
    closing?.balanceCents ??
    (closingLabel !== undefined && !truncated
      ? (lastRow?.balanceCents ?? opening?.balanceCents)
      : undefined)
  const closingText = closing?.label ?? closingLabel ?? 'Saldo final'
  const showClosing = closingCents !== undefined
  const emptyNode = empty ?? <EmptyState size="sm" title="Sin movimientos en el período" />
  const sticky = maxHeight !== undefined ? 'container' : stickyHeader

  const table = (
    <DataTableRoot density={density} caption={caption} className={cn(cards && 'hidden md:table')}>
      <DataTableHead sticky={sticky}>
        <tr>
          {/* Fechas e importes miden lo que su contenido (`w-px` + sin cortes); el
              comprobante se lleva el resto y nunca baja de 14 rem (entra «Factura A
              0003-00001234»): si no entra, scroll horizontal en vez de apretarlo. */}
          <DataTableHeader className="w-px whitespace-nowrap">Fecha</DataTableHeader>
          <DataTableHeader className="min-w-56">{descriptionLabel}</DataTableHeader>
          {showDue ? (
            <DataTableHeader className="w-px whitespace-nowrap">Vence</DataTableHeader>
          ) : null}
          <DataTableHeader numeric className="w-px">
            {columnLabels.debit}
          </DataTableHeader>
          <DataTableHeader numeric className="w-px">
            {columnLabels.credit}
          </DataTableHeader>
          <DataTableHeader numeric className="w-px">
            Saldo
          </DataTableHeader>
        </tr>
      </DataTableHead>
      <DataTableBody>
        {opening ? (
          <tr data-slot="ledger-opening" className="h-[var(--row-h,var(--row-compact))]">
            <th
              scope="row"
              colSpan={textColumns + 2}
              className={cn(ROW_HEADER_CELL, 'text-muted-foreground')}
            >
              {opening.label ?? 'Saldo anterior'}
            </th>
            <DataTableCell numeric>
              <BalanceAmount
                cents={opening.balanceCents}
                mode={balanceMode}
                className="text-muted-foreground"
              />
            </DataTableCell>
          </tr>
        ) : null}
        {rows.length === 0 ? (
          <DataTableEmpty colSpan={columnCount}>{emptyNode}</DataTableEmpty>
        ) : (
          rows.map((row) => (
            <DataTableRow key={row.id} href={row.href} data-ledger-row={row.id}>
              <DataTableCell className="whitespace-nowrap type-amount text-muted-foreground">
                {ledgerDate(row.date, withYear)}
              </DataTableCell>
              <DataTableCell primary>
                <span className="block min-w-0">{row.description}</span>
                {row.reference ? (
                  <span className="block type-caption font-normal text-muted-foreground">
                    {row.reference}
                  </span>
                ) : null}
              </DataTableCell>
              {showDue ? (
                <DataTableCell className="whitespace-nowrap type-amount text-muted-foreground">
                  {row.dueDate ? ledgerDate(row.dueDate, withYear) : null}
                </DataTableCell>
              ) : null}
              <DataTableCell numeric>
                {hasMovement(row.debitCents) ? (
                  <Amount cents={row.debitCents} currency={false} />
                ) : null}
              </DataTableCell>
              <DataTableCell numeric>
                {hasMovement(row.creditCents) ? (
                  <Amount cents={row.creditCents} currency={false} />
                ) : null}
              </DataTableCell>
              <DataTableCell numeric>
                <BalanceAmount cents={row.balanceCents} mode={balanceMode} />
              </DataTableCell>
            </DataTableRow>
          ))
        )}
      </DataTableBody>
      {totals || showClosing ? (
        <DataTableFoot>
          {totals ? (
            <tr data-slot="ledger-totals">
              <th scope="row" colSpan={textColumns} className={ROW_HEADER_CELL}>
                <span className="type-label text-foreground">Totales</span>
              </th>
              <DataTableCell numeric>
                <Amount cents={totals.debitCents} currency={false} />
              </DataTableCell>
              <DataTableCell numeric>
                <Amount cents={totals.creditCents} currency={false} />
              </DataTableCell>
              <td />
            </tr>
          ) : null}
          {showClosing ? (
            <tr data-slot="ledger-closing">
              <th scope="row" colSpan={textColumns + 2} className={ROW_HEADER_CELL}>
                <span className="font-semibold text-foreground">{closingText}</span>
              </th>
              <DataTableCell numeric>
                <BalanceAmount cents={closingCents} mode={balanceMode} />
              </DataTableCell>
            </tr>
          ) : null}
        </DataTableFoot>
      ) : null}
    </DataTableRoot>
  )

  // Como la tabla del kit: el scroll horizontal es un contenedor de scroll y el
  // encabezado fijo `page` dejaría de pegarse; con `page`, sin scroll en escritorio.
  let framed: React.ReactNode
  if (maxHeight !== undefined)
    framed = <DataTableScroll maxHeight={maxHeight}>{table}</DataTableScroll>
  else if (sticky === 'page')
    framed = (
      <div data-slot="data-table-scroll" className="max-md:overflow-x-auto">
        {table}
      </div>
    )
  else framed = <DataTableScroll>{table}</DataTableScroll>

  const cardList = cards ? (
    <ul data-slot="ledger-cards" aria-label={caption} className="divide-y divide-border md:hidden">
      {opening ? (
        <li
          data-slot="ledger-card-opening"
          className="flex items-baseline justify-between gap-3 px-4 py-3"
        >
          <span className="type-small text-muted-foreground">
            {opening.label ?? 'Saldo anterior'}
          </span>
          <BalanceAmount
            cents={opening.balanceCents}
            mode={balanceMode}
            currency="ARS"
            className="type-small text-muted-foreground"
          />
        </li>
      ) : null}
      {rows.length === 0 ? <li className="px-4 py-2">{emptyNode}</li> : null}
      {rows.map((row) => {
        const debit = hasMovement(row.debitCents) ? row.debitCents : null
        const credit = hasMovement(row.creditCents) ? row.creditCents : null
        return (
          <li
            key={row.id}
            data-slot="ledger-card"
            className={cn(
              'relative flex items-start gap-3 px-4 py-3',
              row.href &&
                'hover:[background-image:linear-gradient(var(--hover),var(--hover))] active:[background-image:linear-gradient(var(--active),var(--active))]',
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="type-caption text-muted-foreground">
                {ledgerDate(row.date, withYear)}
                {showDue && row.dueDate ? ` · vence ${ledgerDate(row.dueDate, withYear)}` : null}
              </span>
              <span className="type-body font-medium text-foreground">
                {row.href ? (
                  <Link href={row.href} className={CARD_LINK_CLASSES}>
                    {row.description}
                  </Link>
                ) : (
                  row.description
                )}
              </span>
              {row.reference ? (
                <span className="type-caption text-muted-foreground">{row.reference}</span>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5 text-end">
              {debit !== null ? (
                <span className="type-body type-amount font-medium text-foreground">
                  <span className="sr-only">{`${columnLabels.debit}: `}</span>
                  {formatCents(debit, { sign: 'always' })}
                </span>
              ) : null}
              {credit !== null ? (
                <span className="type-body type-amount font-medium text-foreground">
                  <span className="sr-only">{`${columnLabels.credit}: `}</span>
                  {formatCents(-toBigInt(credit))}
                </span>
              ) : null}
              <span className="type-caption text-muted-foreground">
                {'Saldo '}
                <BalanceAmount cents={row.balanceCents} mode={balanceMode} currency="ARS" />
              </span>
            </div>
          </li>
        )
      })}
      {totals ? (
        <li
          data-slot="ledger-card-totals"
          className="flex flex-col gap-1 border-t border-t-rule px-4 py-3"
        >
          <span className="type-label text-foreground">Totales</span>
          <span className="flex justify-between gap-3 type-small">
            <span className="text-muted-foreground">{columnLabels.debit}</span>
            <Amount cents={totals.debitCents} className="font-semibold" />
          </span>
          <span className="flex justify-between gap-3 type-small">
            <span className="text-muted-foreground">{columnLabels.credit}</span>
            <Amount cents={totals.creditCents} className="font-semibold" />
          </span>
        </li>
      ) : null}
      {showClosing ? (
        <li
          data-slot="ledger-card-closing"
          className="flex items-baseline justify-between gap-3 border-t border-t-rule border-b-[3px] border-b-rule px-4 py-3 [border-bottom-style:double]"
        >
          <span className="type-body font-semibold text-foreground">{closingText}</span>
          <BalanceAmount
            cents={closingCents}
            mode={balanceMode}
            currency="ARS"
            className="font-semibold"
          />
        </li>
      ) : null}
    </ul>
  ) : null

  return (
    <div
      data-slot="ledger-table"
      data-density={density}
      data-mobile={mobile}
      className={cn('flex min-w-0 flex-col gap-3', className)}
      {...props}
    >
      {truncated ? (
        <DataTableTruncated>
          {truncated === true ? DEFAULT_TRUNCATED : truncated}
        </DataTableTruncated>
      ) : null}
      <DataTableShell>
        {framed}
        {cardList}
      </DataTableShell>
    </div>
  )
}

export { LedgerTable }
