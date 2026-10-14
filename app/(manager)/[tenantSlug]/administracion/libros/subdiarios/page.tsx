import { Layers, MoveHorizontal, Table2 } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useId } from 'react'
import { Amount } from '@/components/administracion/amount'
import { plural, signedMovement } from '@/components/administracion/format'
import { EmptyTeach } from '@/components/administracion/kit/empty-teach'
import { ViewPills } from '@/components/administracion/kit/view-pills'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableShell,
} from '@/components/ui/data-table'
import {
  decodePageToken,
  exportHref,
  getSubledger,
  listTreasuryAccounts,
  REPORT_PAGE_LIMIT,
  type SubledgerColumn,
  type SubledgerRow,
  settleQuery,
  subledgerCell,
  subledgerColumns,
} from '@/lib/accounting/queries'
import { todayInCordoba } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { BookPage, PERIOD_ROW, WideBookHint } from '../_components/book-page'
import { KeysetPagination } from '../_components/keyset-pagination'
import { RangePicker } from '../_components/period-picker'
import { PeriodError, QueryErrorBlock } from '../_components/report-error'
import { loadBookContext } from '../_lib/book-context'
import { keysetPageInfo } from '../_lib/keyset'
import { requireBooksAccess } from '../_lib/page-access'
import { bookHref, firstParam, periodParams, resolveBookRange } from '../_lib/periods'
import {
  isRefColumn,
  isRunningBalanceColumn,
  SUBLEDGER_TABS,
  subledgerCellCents,
  subledgerCellText,
  subledgerTab,
} from '../_lib/subledgers'
import { TreasuryFilter } from './_components/treasury-filter'
import { subledgerMobileRow } from './_lib/mobile-row'

export const metadata = { title: 'Subdiarios' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function SubdiariosPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const path = `${base}/libros/subdiarios`
  const { access } = await requireBooksAccess(tenantSlug, path)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const tab = subledgerTab(firstParam(sp.tipo))
  const range = resolveBookRange(sp, today)
  const shown = range.ok ? range : resolveBookRange({}, today)
  if (!shown.ok) throw new Error('período por defecto inválido')
  const despues = firstParam(sp.despues)
  const rawCaja = firstParam(sp.caja)
  const isTreasury = tab.kind === 'treasury'

  const [ctx, treasuries] = await Promise.all([
    loadBookContext(tenantId, today),
    isTreasury ? settleQuery(listTreasuryAccounts(tenantId, { includeInactive: true })) : null,
  ])
  const treasuryList = treasuries?.ok ? treasuries.data : []
  const cajaId =
    isTreasury && rawCaja && UUID_RE.test(rawCaja) && treasuryList.some((t) => t.id === rawCaja)
      ? rawCaja
      : null

  const ledger = range.ok
    ? await settleQuery(
        getSubledger(tenantId, {
          kind: tab.kind,
          from: range.from,
          to: range.to,
          treasuryId: cajaId,
          after: despues,
          limit: REPORT_PAGE_LIMIT,
        }),
      )
    : null

  const period = periodParams(shown)
  const keep = { ...period, tipo: tab.value, caja: cajaId }
  const columns = subledgerColumns(tab.kind)
  const page = ledger?.ok ? ledger.data : null
  const lines = page ? page.rows.filter((r) => r.rowKind === 'line') : []
  // La tabla ancha no dibuja las columnas que en estas filas no traen nada («Turno», «Vendido
  // eventos»): el exporte las lleva todas igual.
  const tableColumns = usedColumns(columns, lines)
  const cajaName = cajaId ? treasuryList.find((t) => t.id === cajaId)?.name : null
  const info = page
    ? keysetPageInfo({
        seenBefore: decodePageToken(despues)?.seen ?? 0,
        rows: lines.length,
        totalRows: page.totalRows,
        pageSize: REPORT_PAGE_LIMIT,
      })
    : null

  return (
    <BookPage
      backHref={bookHref(`${base}/libros`, shown.month ? { mes: shown.month } : {})}
      title="Subdiarios"
      description={`${tab.label}${cajaName ? ` · ${cajaName}` : ''} · ${shown.label}${
        page ? ` · ${plural(page.totalRows, 'fila', 'filas')}` : ''
      }`}
      exports={[
        {
          href: exportHref(tenantSlug, tab.exportBook, {
            desde: shown.from,
            hasta: shown.to,
            caja: cajaId,
          }),
          fileName: `administracion-${tenantSlug}-${tab.exportBook}-${shown.from}_${shown.to}.csv`,
          label: `Exportar ${tab.label.toLowerCase()}`,
        },
      ]}
      booksPath={`${base}/libros`}
      book="subdiarios"
      period={shown}
      toolbar={
        <div className="space-y-3">
          <ViewPills
            label="Subdiarios"
            items={SUBLEDGER_TABS.map((t) => ({
              key: t.value,
              label: t.label,
              shortLabel: t.shortLabel,
              href: bookHref(path, { ...period, tipo: t.value }),
              active: t.value === tab.value,
              scroll: false,
            }))}
          />
          <RangePicker
            className={PERIOD_ROW}
            range={shown}
            today={today}
            fiscalYear={ctx.fiscalYear}
            minMonth={ctx.minMonth}
          />
          {isTreasury && treasuryList.length > 0 ? (
            <TreasuryFilter
              treasuries={treasuryList.map((t) => ({ id: t.id, name: t.name }))}
              value={cajaId}
            />
          ) : null}
        </div>
      }
    >
      {!range.ok ? <PeriodError message={range.message} /> : null}
      {ledger && !ledger.ok ? (
        <QueryErrorBlock code={ledger.code} message={ledger.message} />
      ) : null}

      {page ? (
        lines.length === 0 && page.rows.length === 0 ? (
          <EmptyTeach icon={Layers} title={`No hay movimientos en ${shown.label.toLowerCase()}`}>
            Acá van: {tab.empty.charAt(0).toLowerCase()}
            {tab.empty.slice(1)}
          </EmptyTeach>
        ) : (
          <>
            <SubledgerMobileList
              rows={page.rows}
              columns={columns}
              base={base}
              caption={`Subdiario de ${tab.label.toLowerCase()}, ${shown.label}`}
            />
            <WideTable wide={tableColumns.length >= WIDE_COLUMNS}>
              <SubledgerTable
                rows={page.rows}
                columns={tableColumns}
                base={base}
                caption={`Subdiario de ${tab.label.toLowerCase()}, ${shown.label}`}
                showTotals={Boolean(info?.isFirst) && !page.nextCursor}
                emptyText="No hay movimientos en este período."
              />
            </WideTable>
            {info ? (
              <KeysetPagination
                info={info}
                noun="movimientos"
                firstHref={bookHref(path, keep)}
                nextHref={
                  page.nextCursor ? bookHref(path, { ...keep, despues: page.nextCursor }) : null
                }
              />
            ) : null}
          </>
        )
      ) : null}
    </BookPage>
  )
}

/**
 * La tabla ancha del subdiario. En la compu se ve siempre; en el celular queda
 * detrás de «Ver la tabla completa» (arriba va la lista de un renglón por
 * movimiento). Es UNA sola tabla en el HTML: el interruptor es una casilla, así
 * anda sin JavaScript y con teclado.
 */
function WideTable({
  wide,
  children,
}: {
  /** Tiene tantas columnas que puede no entrar ni en la compu. */
  wide: boolean
  children: ReactNode
}) {
  const id = useId()
  return (
    <div>
      <input type="checkbox" id={id} className="peer sr-only" />
      <label
        htmlFor={id}
        className="mb-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border/70 bg-card px-4 text-sm font-medium peer-checked:border-foreground peer-checked:bg-foreground peer-checked:text-background peer-focus-visible:ring-2 peer-focus-visible:ring-ring sm:hidden"
      >
        <Table2 className="size-4" aria-hidden />
        Ver la tabla completa
      </label>
      <div className="hidden space-y-3 peer-checked:block sm:block">
        <WideBookHint />
        {wide ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground max-sm:hidden">
            <MoveHorizontal className="size-3.5 shrink-0" aria-hidden />
            Tabla ancha: si no entra, deslizala de costado para ver todas las columnas.
          </p>
        ) : null}
        {children}
      </div>
    </div>
  )
}

/** Desde cuántas columnas una tabla puede no entrar en la compu (se avisa que se desliza). */
const WIDE_COLUMNS = 9

/**
 * Las columnas que se dibujan: fuera las que no traen nada en ninguna fila (ni texto ni un
 * importe distinto de cero). La fecha, la referencia y el saldo acumulado van siempre. Sin
 * filas, todas (la tabla vacía conserva sus títulos).
 */
function usedColumns(
  columns: readonly SubledgerColumn[],
  lines: readonly SubledgerRow[],
): SubledgerColumn[] {
  if (lines.length === 0) return [...columns]
  return columns.filter((column, index) => {
    if (index === 0 || column.type === 'date') return true
    if (isRefColumn(column) || isRunningBalanceColumn(column)) return true
    return lines.some((row) => {
      const cell = subledgerCell(row, column)
      if (column.type === 'money') return (subledgerCellCents(cell) ?? 0) !== 0
      return subledgerCellText(cell, column) !== ''
    })
  })
}

/**
 * El contenedor que desliza, con una sombra en el borde derecho SOLO mientras queda tabla para
 * ese lado (el viejo truco de los dos fondos: uno viaja con el contenido y tapa al otro cuando
 * se llega al final). Sin esto, una columna cortada a mitad de número parecía el final de la
 * tabla.
 */
const SCROLL_SHADOW = {
  background: [
    'linear-gradient(to left, var(--card) 35%, transparent) right center / 3rem 100% no-repeat local',
    'radial-gradient(farthest-side at 100% 50%, color-mix(in oklab, var(--foreground) 26%, transparent), transparent) right center / 0.875rem 100% no-repeat scroll',
  ].join(', '),
} as const

/** Celular: un renglón por movimiento (fecha, «#125», de qué es y UN importe). Tocarlo abre el comprobante. */
function SubledgerMobileList({
  rows,
  columns,
  base,
  caption,
}: {
  rows: readonly SubledgerRow[]
  columns: readonly SubledgerColumn[]
  base: string
  caption: string
}) {
  const lines = rows.filter((r) => r.rowKind === 'line')
  const opening = rows.find((r) => r.rowKind === 'opening') ?? null
  const balanceColumn = columns.find((c) => isRunningBalanceColumn(c)) ?? null
  const openingCents =
    opening && balanceColumn ? subledgerCellCents(subledgerCell(opening, balanceColumn)) : null
  return (
    <div className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card sm:hidden">
      <ul aria-label={caption} className="divide-y divide-border/60">
        {openingCents !== null ? (
          <li className="flex items-center justify-between gap-3 bg-secondary/20 px-4 py-3 text-sm">
            <span className="text-muted-foreground">Saldo anterior</span>
            <Amount cents={openingCents} />
          </li>
        ) : null}
        {lines.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">
            No hay movimientos en este período.
          </li>
        ) : null}
        {lines.map((row, index) => {
          const item = subledgerMobileRow(row, columns)
          const body = (
            <>
              <span className="min-w-0 space-y-0.5">
                <span className="block text-xs tabular-nums text-muted-foreground">
                  {[item.date, item.ref].filter(Boolean).join(' · ')}
                </span>
                <span className="block truncate text-sm font-medium">
                  {item.title || 'Movimiento'}
                </span>
                {item.detail ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.detail}
                  </span>
                ) : null}
              </span>
              {item.amountCents !== null ? (
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-medium whitespace-nowrap tabular-nums">
                    {item.direction === 0 ? (
                      <Amount cents={item.amountCents} />
                    ) : (
                      signedMovement(item.amountCents, item.direction > 0)
                    )}
                  </span>
                  {item.amountLabel ? (
                    <span className="block text-[11px] text-muted-foreground">
                      {item.amountLabel}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </>
          )
          const key = `${row.documentId ?? row.entryId ?? 'fila'}-${index.toString()}`
          return (
            <li key={key}>
              {row.documentId ? (
                <Link
                  href={`${base}/comprobantes/${row.documentId}`}
                  className="flex min-h-11 items-start justify-between gap-3 px-4 py-3 outline-none hover:bg-cream-tint focus-visible:bg-cream-tint focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {body}
                </Link>
              ) : (
                <div className="flex min-h-11 items-start justify-between gap-3 px-4 py-3">
                  {body}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** El aire de costado de cada celda: menos que el de fábrica (16 px), para que entren más columnas. */
const CELL_X = 'px-3 first:pl-4 last:pr-4'

function SubledgerTable({
  rows,
  columns,
  base,
  caption,
  showTotals,
  emptyText,
}: {
  rows: readonly SubledgerRow[]
  columns: readonly SubledgerColumn[]
  base: string
  caption: string
  showTotals: boolean
  emptyText: string
}) {
  const lines = rows.filter((r) => r.rowKind === 'line')
  const linkIndex = Math.max(
    0,
    columns.findIndex((c) => isRefColumn(c)),
  )
  const balanceIndex = columns.findIndex((c) => isRunningBalanceColumn(c))
  const balanceColumn = balanceIndex === -1 ? null : (columns[balanceIndex] ?? null)

  // Totales (solo si la página es todo el período): se suman las columnas de
  // plata; el saldo acumulado no se suma, va el último.
  const totals = columns.map((column, index) => {
    if (column.type !== 'money') return null
    if (index === balanceIndex) {
      const last = lines.at(-1)
      return last ? subledgerCellCents(subledgerCell(last, column)) : null
    }
    let sum = 0
    for (const row of lines) sum += subledgerCellCents(subledgerCell(row, column)) ?? 0
    return sum
  })

  return (
    <DataTableShell>
      {/* El `DataTableScroll` de siempre, con la sombra que avisa que la tabla sigue. */}
      <div className="overflow-x-auto overflow-y-auto" style={SCROLL_SHADOW}>
        <DataTableRoot>
          <caption className="sr-only">{caption}</caption>
          <DataTableHead>
            <tr>
              {columns.map((c) => (
                <DataTableHeader
                  key={c.header}
                  className={cn(
                    CELL_X,
                    // Los títulos largos («No gravado, exento y sin crédito») van en dos
                    // líneas: si no, la columna queda el doble de ancha que sus importes.
                    c.header.length > 16 ? 'min-w-44' : 'whitespace-nowrap',
                    c.align === 'end' && 'text-right',
                  )}
                >
                  {c.header}
                </DataTableHeader>
              ))}
            </tr>
          </DataTableHead>
          <DataTableBody>
            {lines.length === 0 && rows.every((r) => r.rowKind !== 'opening') ? (
              <tr>
                <DataTableCell
                  colSpan={columns.length}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {emptyText}
                </DataTableCell>
              </tr>
            ) : null}
            {rows.map((row, rowIndex) =>
              row.rowKind === 'opening' ? (
                <tr key={`opening-${rowIndex.toString()}`} className="bg-secondary/20">
                  <DataTableCell
                    colSpan={Math.max(1, balanceIndex === -1 ? columns.length : balanceIndex)}
                    className={cn(CELL_X, 'text-xs text-muted-foreground')}
                  >
                    Saldo anterior
                  </DataTableCell>
                  {balanceColumn ? (
                    <>
                      <DataTableCell className={cn(CELL_X, 'text-right text-muted-foreground')}>
                        <OpeningBalance row={row} column={balanceColumn} />
                      </DataTableCell>
                      {columns.slice(balanceIndex + 1).map((c) => (
                        <DataTableCell key={c.header} className={CELL_X}>
                          {null}
                        </DataTableCell>
                      ))}
                    </>
                  ) : null}
                </tr>
              ) : (
                <tr
                  key={`${row.documentId ?? row.entryId ?? 'fila'}-${rowIndex.toString()}`}
                  className="transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint"
                >
                  {columns.map((column, index) => {
                    const cell = subledgerCell(row, column)
                    if (column.type === 'money') {
                      const cents = subledgerCellCents(cell)
                      return (
                        <DataTableCell key={column.header} className={cn(CELL_X, 'text-right')}>
                          {cents === null || (cents === 0 && index !== balanceIndex) ? null : (
                            <Amount cents={cents} currency={false} />
                          )}
                        </DataTableCell>
                      )
                    }
                    const text = subledgerCellText(cell, column)
                    const link = index === linkIndex && row.documentId
                    return (
                      <DataTableCell
                        key={column.header}
                        className={cn(
                          CELL_X,
                          // Una fila, una línea: el subdiario es ancho y se desliza de costado;
                          // partir «Factura A 0003-00001290» en tres renglones no lo hace entrar.
                          column.type !== 'list' && 'whitespace-nowrap',
                          column.type === 'date' && 'tabular-nums text-muted-foreground',
                          column.type === 'list' && 'min-w-48 text-xs',
                          column.align === 'end' && 'text-right tabular-nums',
                        )}
                      >
                        {link ? (
                          <Link
                            href={`${base}/comprobantes/${row.documentId}`}
                            className="rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {text || 'Ver'}
                          </Link>
                        ) : (
                          text || null
                        )}
                      </DataTableCell>
                    )
                  })}
                </tr>
              ),
            )}
          </DataTableBody>
          {showTotals && lines.length > 0 ? (
            <tfoot className="bg-secondary/30 font-semibold">
              <tr className="border-t border-border">
                {columns.map((column, index) =>
                  index === 0 ? (
                    <DataTableCell key={column.header} className={cn(CELL_X, 'text-xs')}>
                      Totales
                    </DataTableCell>
                  ) : (
                    <DataTableCell key={column.header} className={cn(CELL_X, 'text-right')}>
                      {totals[index] === null || totals[index] === undefined ? null : (
                        <Amount cents={totals[index]} currency={false} />
                      )}
                    </DataTableCell>
                  ),
                )}
              </tr>
            </tfoot>
          ) : null}
        </DataTableRoot>
      </div>
    </DataTableShell>
  )
}

function OpeningBalance({ row, column }: { row: SubledgerRow; column: SubledgerColumn }) {
  const cents = subledgerCellCents(subledgerCell(row, column))
  return cents === null ? null : <Amount cents={cents} currency={false} />
}
