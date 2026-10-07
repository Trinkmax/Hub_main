import { Banknote, CalendarRange, Percent, Receipt, ReceiptText, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { Amount } from '@/components/administracion/amount'
import { plural } from '@/components/administracion/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { StatCard } from '@/components/ui/stat-card'
import {
  CHANNEL_LABELS,
  exportHref,
  getIvaBook,
  getIvaBookTotals,
  getPeriodByMonth,
  getSalesSummary,
  type IvaBookRow,
  REPORT_PAGE_LIMIT,
  settleQuery,
} from '@/lib/accounting/queries'
import { decodePageToken } from '@/lib/accounting/queries/shared'
import type { FiscalAmountKey, FiscalBook } from '@/lib/accounting/types'
import { formatIsoDay, todayInCordoba } from '@/lib/dates'
import { formatCuit, formatVoucherNumber, formatVoucherRange } from '@/lib/fiscal'
import { formatCents } from '@/lib/money'
import { loadBookContext } from '../_lib/book-context'
import { type IvaColumn, ivaSummary, visibleIvaColumns } from '../_lib/iva'
import { keysetPageInfo } from '../_lib/keyset'
import { requireBooksAccess } from '../_lib/page-access'
import {
  type BookSearchParams,
  bookHref,
  firstParam,
  monthAvailability,
  monthAvailabilityMessage,
  resolveBookMonth,
} from '../_lib/periods'
import { BookPage, WideBookHint } from './book-page'
import { ExportButton } from './export-button'
import { KeysetPagination } from './keyset-pagination'
import { MonthPicker } from './period-picker'
import { PeriodError, QueryErrorBlock } from './report-error'

const COPY = {
  purchases: {
    title: 'Libro IVA compras',
    slug: 'iva-compras',
    exportBook: 'iva-compras',
    aliquots: 'iva-compras-alicuotas',
    counterparty: 'Proveedor',
    vat: 'IVA crédito fiscal',
    noun: 'comprobantes',
  },
  sales: {
    title: 'Libro IVA ventas',
    slug: 'iva-ventas',
    exportBook: 'iva-ventas',
    aliquots: 'iva-ventas-alicuotas',
    counterparty: 'Cliente',
    vat: 'IVA débito fiscal',
    noun: 'comprobantes',
  },
} as const

/**
 * Libro IVA compras o ventas del mes (H.12, F.4/F.5): la franja de totales,
 * la tabla ancha (solo las columnas con algo en el mes; las notas de crédito y
 * las anulaciones en negativo) y los exportes del libro y de las alícuotas.
 * Lo llaman las dos páginas; valida el acceso igual que cualquier página.
 */
export async function IvaBookScreen({
  tenantSlug,
  book,
  sp,
}: {
  tenantSlug: string
  book: FiscalBook
  sp: BookSearchParams
}) {
  const copy = COPY[book]
  const base = `/${tenantSlug}/administracion`
  const path = `${base}/libros/${copy.slug}`
  const { access, canWrite } = await requireBooksAccess(tenantSlug, path)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const resolved = resolveBookMonth(sp, today)
  const month = resolved.ok ? resolved : resolveBookMonth({}, today)
  if (!month.ok) throw new Error('período por defecto inválido')
  const ctx = await loadBookContext(tenantId, today)
  const availability = monthAvailability(month.month, today, ctx.settings?.booksStartDate)
  const despues = firstParam(sp.despues)
  const load = resolved.ok && availability === 'ok'

  const [totals, page, periodRow, sales] = await Promise.all([
    load ? settleQuery(getIvaBookTotals(tenantId, { book, month: month.month })) : null,
    load
      ? settleQuery(
          getIvaBook(tenantId, {
            book,
            month: month.month,
            after: despues,
            limit: REPORT_PAGE_LIMIT,
          }),
        )
      : null,
    load ? settleQuery(getPeriodByMonth(tenantId, month.month)) : null,
    load && book === 'sales'
      ? settleQuery(getSalesSummary(tenantId, { from: month.from, to: month.to }))
      : null,
  ])

  const hasCuit = Boolean(ctx.settings?.cuit)
  const fileBase = `administracion-${tenantSlug}`
  const rows = page?.ok ? page.data.rows : []
  const totalRows = page?.ok ? page.data.totalRows : 0
  const isOpen = periodRow?.ok ? periodRow.data?.status === 'open' : false
  const uninvoiced =
    sales?.ok && sales.data.length > 0
      ? sales.data.reduce((sum, r) => sum + r.uninvoicedCents, 0)
      : null

  return (
    <BookPage
      backHref={bookHref(`${base}/libros`, { mes: month.month })}
      title={copy.title}
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span>
            {month.label}
            {page?.ok ? ` · ${plural(totalRows, 'comprobante', 'comprobantes')}` : ''}
          </span>
          {isOpen ? (
            <Badge
              variant="outline"
              className="border-warning/40 bg-warning/10 font-normal text-warning-text"
            >
              Mes abierto: puede cambiar
            </Badge>
          ) : null}
        </span>
      }
      actions={
        hasCuit ? (
          <>
            <ExportButton
              href={exportHref(tenantSlug, copy.exportBook, { mes: month.month })}
              fileName={`${fileBase}-${copy.exportBook}-${month.month}.csv`}
              label="Exportar libro"
            />
            <ExportButton
              href={exportHref(tenantSlug, copy.aliquots, { mes: month.month })}
              fileName={`${fileBase}-${copy.aliquots}-${month.month}.csv`}
              label="Exportar alícuotas"
            />
          </>
        ) : null
      }
      toolbar={<MonthPicker month={month.month} today={today} minMonth={ctx.minMonth} />}
    >
      {!resolved.ok ? <PeriodError message={resolved.message} /> : null}
      {ctx.settings && !hasCuit ? <CuitMissing base={base} canWrite={canWrite} /> : null}

      {availability !== 'ok' ? (
        <EmptyState
          icon={CalendarRange}
          title={monthAvailabilityMessage(availability, month.month, ctx.settings?.booksStartDate)}
          description="Elegí otro mes con las flechas de arriba."
        />
      ) : null}

      {totals && !totals.ok ? (
        <QueryErrorBlock code={totals.code} message={totals.message} />
      ) : null}
      {page && !page.ok && (!totals || totals.ok) ? (
        <QueryErrorBlock code={page.code} message={page.message} />
      ) : null}

      {totals?.ok && page?.ok ? (
        rows.length === 0 && page.data.totalRows === 0 ? (
          <EmptyIvaBook book={book} base={base} label={month.label} canWrite={canWrite} />
        ) : (
          <>
            <IvaSummaryCards book={book} amounts={totals.data.amounts} />
            <WideBookHint />
            <IvaTable
              book={book}
              base={base}
              rows={rows}
              columns={visibleIvaColumns(book, totals.data.amounts, rows)}
              totals={totals.data.amounts}
              caption={`${copy.title}, ${month.label}`}
            />
            <KeysetPagination
              info={keysetPageInfo({
                seenBefore: decodePageToken(despues)?.seen ?? 0,
                rows: rows.length,
                totalRows,
                pageSize: REPORT_PAGE_LIMIT,
              })}
              noun={copy.noun}
              firstHref={bookHref(path, { mes: month.month })}
              nextHref={
                page.data.nextCursor
                  ? bookHref(path, { mes: month.month, despues: page.data.nextCursor })
                  : null
              }
            />
          </>
        )
      ) : null}

      {book === 'sales' && uninvoiced !== null && uninvoiced !== 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
          <Receipt className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <div className="space-y-1 text-pretty">
            <p className="font-medium">
              Ventas del mes sin facturar: <Amount cents={uninvoiced} />
            </p>
            <p className="text-muted-foreground">
              No generan IVA débito y no entran a este libro. Cómo se tratan lo define la contadora.
            </p>
          </div>
        </div>
      ) : null}
    </BookPage>
  )
}

function CuitMissing({ base, canWrite }: { base: string; canWrite: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="space-y-1 text-pretty">
        <p className="font-medium text-warning-text">
          Falta el CUIT de la SAS para exportar los libros de IVA.
        </p>
        <p className="text-muted-foreground">
          {canWrite ? (
            <>
              Completalo en{' '}
              <Link
                href={`${base}/ajustes?tab=sas`}
                className="font-medium text-foreground underline underline-offset-4"
              >
                Ajustes › Datos de la SAS
              </Link>{' '}
              y vas a poder bajarlos.
            </>
          ) : (
            'Pediles a los dueños que lo completen en Ajustes › Datos de la SAS.'
          )}
        </p>
      </div>
    </div>
  )
}

function EmptyIvaBook({
  book,
  base,
  label,
  canWrite,
}: {
  book: FiscalBook
  base: string
  label: string
  canWrite: boolean
}) {
  if (book === 'purchases') {
    return (
      <EmptyState
        icon={Receipt}
        title={`No hay comprobantes con IVA en ${label}`}
        description="Acá entran las facturas, notas de crédito y débito y los tiques de proveedores con CUIT. Los gastos sin comprobante no van al Libro IVA."
        action={
          canWrite ? (
            <Button asChild className="h-11 md:h-9">
              <Link href={`${base}/compras/nueva`}>Cargar una factura</Link>
            </Button>
          ) : null
        }
      />
    )
  }
  return (
    <EmptyState
      icon={ReceiptText}
      title={`No hay ventas facturadas en ${label}`}
      description="Acá entran las facturas de cada cierre del día y las facturas sueltas."
      action={
        canWrite ? (
          <Button asChild className="h-11 md:h-9">
            <Link href={`${base}/ventas/cierre`}>Cierre del día</Link>
          </Button>
        ) : null
      }
    />
  )
}

function IvaSummaryCards({
  book,
  amounts,
}: {
  book: FiscalBook
  amounts: Readonly<Record<FiscalAmountKey, number>>
}) {
  const s = ivaSummary(amounts)
  return (
    <section aria-label="Totales del mes" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard icon={Banknote} label="Neto gravado" value={formatCents(s.netCents)} />
      <StatCard
        icon={Percent}
        label={COPY[book].vat}
        value={formatCents(s.vatCents)}
        hint={
          book === 'purchases' && s.computableCents !== s.vatCents
            ? `Computable: ${formatCents(s.computableCents)}`
            : undefined
        }
      />
      <StatCard icon={ReceiptText} label="Percepciones" value={formatCents(s.perceptionsCents)} />
      <StatCard
        icon={Receipt}
        label="Total"
        value={formatCents(s.totalCents)}
        hint={
          s.otherCents !== 0
            ? `No gravado, exento y otros: ${formatCents(s.otherCents)}`
            : undefined
        }
      />
    </section>
  )
}

function voucherNumberOf(row: IvaBookRow): string {
  if (row.numberTo !== null && row.numberTo !== row.numberFrom) {
    return formatVoucherRange(row.pointOfSale, row.numberFrom, row.numberTo)
  }
  return formatVoucherNumber(row.pointOfSale, row.numberFrom)
}

function docOf(row: IvaBookRow): string {
  const number = row.counterpartyDocNumber
  if (!number || number === '0') return 'Consumidor final'
  return row.counterpartyDocType === 80 || row.counterpartyDocType === 86
    ? `CUIT ${formatCuit(number)}`
    : `Doc. ${number}`
}

function IvaTable({
  book,
  base,
  rows,
  columns,
  totals,
  caption,
}: {
  book: FiscalBook
  base: string
  rows: readonly IvaBookRow[]
  columns: readonly IvaColumn[]
  totals: Readonly<Record<FiscalAmountKey, number>>
  caption: string
}) {
  const counterparty = COPY[book].counterparty
  return (
    <>
      {/* Compu y tablet: el libro ancho, con scroll de costado. */}
      <DataTableShell className="hidden sm:block">
        <DataTableScroll>
          <DataTableRoot>
            <caption className="sr-only">{caption}</caption>
            <DataTableHead>
              <tr>
                <DataTableHeader className="w-28">Fecha</DataTableHeader>
                <DataTableHeader className="min-w-52">Comprobante</DataTableHeader>
                <DataTableHeader className="min-w-48">{counterparty}</DataTableHeader>
                {book === 'sales' ? <DataTableHeader>Canal</DataTableHeader> : null}
                {columns.map((c) => (
                  <DataTableHeader key={c.key} className="whitespace-nowrap text-right">
                    <abbr title={c.label} className="no-underline">
                      {c.short}
                    </abbr>
                  </DataTableHeader>
                ))}
              </tr>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => (
                <tr
                  key={row.voucherId}
                  className="transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint"
                >
                  <DataTableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {formatIsoDay(row.voucherDate)}
                  </DataTableCell>
                  <DataTableCell>
                    <Link
                      href={`${base}/comprobantes/${row.documentId}`}
                      className="rounded-sm font-medium underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {row.voucherLabel}
                    </Link>
                    <span className="block whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {voucherNumberOf(row)}
                    </span>
                    {row.isReversal ? (
                      <span className="text-xs text-muted-foreground">Anulación</span>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell>
                    <span className="block">{row.counterpartyName || '—'}</span>
                    <span className="block text-xs text-muted-foreground">{docOf(row)}</span>
                  </DataTableCell>
                  {book === 'sales' ? (
                    <DataTableCell className="text-muted-foreground">
                      {row.channel ? (CHANNEL_LABELS[row.channel] ?? row.channel) : '—'}
                    </DataTableCell>
                  ) : null}
                  {columns.map((c) => (
                    <DataTableCell
                      key={c.key}
                      className={c.key === 'total_cents' ? 'text-right font-medium' : 'text-right'}
                    >
                      {row.amounts[c.key] ? (
                        <Amount cents={row.amounts[c.key]} currency={false} />
                      ) : null}
                    </DataTableCell>
                  ))}
                </tr>
              ))}
            </DataTableBody>
            <tfoot className="bg-secondary/30 font-semibold">
              <tr className="border-t border-border">
                <DataTableCell colSpan={book === 'sales' ? 4 : 3} className="text-xs">
                  Totales del mes
                </DataTableCell>
                {columns.map((c) => (
                  <DataTableCell key={c.key} className="text-right">
                    <Amount cents={totals[c.key]} currency={false} />
                  </DataTableCell>
                ))}
              </tr>
            </tfoot>
          </DataTableRoot>
        </DataTableScroll>
      </DataTableShell>

      {/* Celular: cada comprobante con su total; tocarlo abre el detalle. */}
      <div className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card sm:hidden">
        <ul aria-label={caption} className="divide-y divide-border/60">
          {rows.map((row) => (
            <li key={row.voucherId}>
              <Link
                href={`${base}/comprobantes/${row.documentId}`}
                className="flex items-start justify-between gap-3 px-4 py-3 outline-none hover:bg-cream-tint focus-visible:bg-cream-tint"
              >
                <span className="min-w-0 space-y-0.5">
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    {formatIsoDay(row.voucherDate)}
                  </span>
                  <span className="block truncate text-sm font-medium">
                    {row.voucherLabel} {voucherNumberOf(row)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.counterpartyName || docOf(row)}
                  </span>
                </span>
                <Amount cents={row.amounts.total_cents} className="shrink-0 text-sm font-medium" />
              </Link>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 bg-secondary/30 px-4 py-3 text-sm font-semibold">
            <span>Total del mes</span>
            <Amount cents={totals.total_cents} />
          </li>
        </ul>
      </div>
    </>
  )
}
