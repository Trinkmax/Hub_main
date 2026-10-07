import { Layers } from 'lucide-react'
import Link from 'next/link'
import { Amount } from '@/components/administracion/amount'
import { plural } from '@/components/administracion/format'
import { SectionNav } from '@/components/administracion/section-nav'
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
import { BookPage, WideBookHint } from '../_components/book-page'
import { ExportButton } from '../_components/export-button'
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
      actions={
        <ExportButton
          href={exportHref(tenantSlug, tab.exportBook, {
            desde: shown.from,
            hasta: shown.to,
            caja: cajaId,
          })}
          fileName={`administracion-${tenantSlug}-${tab.exportBook}-${shown.from}_${shown.to}.csv`}
          label={`Exportar ${tab.label.toLowerCase()}`}
        />
      }
      toolbar={
        <div className="space-y-4">
          <SectionNav
            label="Subdiarios"
            active={tab.value}
            items={SUBLEDGER_TABS.map((t) => ({
              value: t.value,
              label: t.label,
              shortLabel: t.shortLabel,
              href: bookHref(path, { ...period, tipo: t.value }),
            }))}
          />
          <RangePicker
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
          <EmptyState
            icon={Layers}
            title={`No hay movimientos en ${shown.label}`}
            description={tab.empty}
          />
        ) : (
          <>
            <WideBookHint />
            <SubledgerTable
              rows={page.rows}
              columns={columns}
              base={base}
              caption={`Subdiario de ${tab.label.toLowerCase()}, ${shown.label}`}
              showTotals={Boolean(info?.isFirst) && !page.nextCursor}
              emptyText="No hay movimientos en este período."
            />
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
      <DataTableScroll>
        <DataTableRoot>
          <caption className="sr-only">{caption}</caption>
          <DataTableHead>
            <tr>
              {columns.map((c) => (
                <DataTableHeader
                  key={c.header}
                  className={cn('whitespace-nowrap', c.align === 'end' && 'text-right')}
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
                    className="text-xs text-muted-foreground"
                  >
                    Saldo anterior
                  </DataTableCell>
                  {balanceColumn ? (
                    <>
                      <DataTableCell className="text-right text-muted-foreground">
                        <OpeningBalance row={row} column={balanceColumn} />
                      </DataTableCell>
                      {columns.slice(balanceIndex + 1).map((c) => (
                        <DataTableCell key={c.header}>{null}</DataTableCell>
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
                        <DataTableCell key={column.header} className="text-right">
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
                          column.type === 'date' &&
                            'whitespace-nowrap tabular-nums text-muted-foreground',
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
                    <DataTableCell key={column.header} className="text-xs">
                      Totales
                    </DataTableCell>
                  ) : (
                    <DataTableCell key={column.header} className="text-right">
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
      </DataTableScroll>
    </DataTableShell>
  )
}

function OpeningBalance({ row, column }: { row: SubledgerRow; column: SubledgerColumn }) {
  const cents = subledgerCellCents(subledgerCell(row, column))
  return cents === null ? null : <Amount cents={cents} currency={false} />
}
