import { CalendarRange, Receipt, ReceiptText } from 'lucide-react'
import Link from 'next/link'
import { Fragment } from 'react'
import { Amount } from '@/components/administracion/amount'
import { plural } from '@/components/administracion/format'
import { EmptyTeach } from '@/components/administracion/kit/empty-teach'
import { PanelLink } from '@/components/administracion/kit/panel-states'
import { StatusPill } from '@/components/administracion/kit/status-pill'
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
import { cn } from '@/lib/utils'
import { loadBookContext } from '../_lib/book-context'
import { type IvaColumn, ivaSummary, visibleIvaColumns } from '../_lib/iva'
import { keysetPageInfo } from '../_lib/keyset'
import { monthNoun } from '../_lib/months'
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
import { BookTotals } from './book-totals'
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
 * Libro IVA compras o ventas del mes (H.12, F.4/F.5): los totales en una banda
 * (no en tarjetas: es un renglón de control), la tabla ancha (solo las columnas
 * con algo en el mes; las notas de crédito y las anulaciones en negativo) y los
 * exportes del libro y de las alícuotas. Lo llaman las dos páginas; valida el
 * acceso igual que cualquier página.
 *
 * A estos libros entra solo lo que tiene factura. Lo que va sin factura queda
 * registrado igual, en el Libro diario y en los subdiarios: el vacío y el
 * renglón «Sin factura» lo dicen y llevan ahí.
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

  const showBook = Boolean(
    totals?.ok && page?.ok && !(rows.length === 0 && page.data.totalRows === 0),
  )

  return (
    <BookPage
      backHref={bookHref(`${base}/libros`, { mes: month.month })}
      title={copy.title}
      description={`${month.label}${
        page?.ok ? ` · ${plural(totalRows, 'comprobante', 'comprobantes')}` : ''
      }`}
      badge={isOpen ? <StatusPill tone="info">Mes abierto: puede cambiar</StatusPill> : null}
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
      booksPath={`${base}/libros`}
      book={copy.slug}
      period={{ kind: 'month', month: month.month, from: month.from, to: month.to }}
      toolbar={<MonthPicker month={month.month} today={today} minMonth={ctx.minMonth} />}
      totals={
        showBook && totals?.ok ? <IvaTotals book={book} amounts={totals.data.amounts} /> : null
      }
    >
      {!resolved.ok ? <PeriodError message={resolved.message} /> : null}
      {ctx.settings && !hasCuit ? <CuitMissing base={base} canWrite={canWrite} /> : null}

      {availability !== 'ok' ? (
        <EmptyTeach
          icon={CalendarRange}
          title={monthAvailabilityMessage(availability, month.month, ctx.settings?.booksStartDate)}
        >
          Elegí otro mes con las flechas de arriba.
        </EmptyTeach>
      ) : null}

      {totals && !totals.ok ? (
        <QueryErrorBlock code={totals.code} message={totals.message} />
      ) : null}
      {page && !page.ok && (!totals || totals.ok) ? (
        <QueryErrorBlock code={page.code} message={page.message} />
      ) : null}

      {totals?.ok && page?.ok ? (
        !showBook ? (
          <EmptyIvaBook book={book} base={base} month={month.month} canWrite={canWrite} />
        ) : (
          <>
            <WideBookHint>
              En el celular ves cada comprobante con su total: tocalo para ver el detalle. El libro
              completo se lee mejor en la compu.
            </WideBookHint>
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
        <div className="card-hairline flex flex-col gap-2 rounded-2xl border bg-card p-4 text-sm shadow-xs sm:p-5">
          <p className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5 text-pretty">
            <StatusPill tone="muted">Sin factura</StatusPill>
            <span className="min-w-0 flex-1 basis-64">
              Ventas de {monthNoun(month.month)} sin factura:{' '}
              <Amount cents={uninvoiced} decimals={0} className="font-semibold" />. Están en el
              Libro diario y en el subdiario de ventas; a este libro entra solo lo facturado. Cómo
              se tratan lo define la contadora.
            </span>
          </p>
          <PanelLink
            href={bookHref(`${base}/libros/subdiarios`, { tipo: 'ventas', mes: month.month })}
          >
            Ver todas las ventas del mes
          </PanelLink>
        </div>
      ) : null}
    </BookPage>
  )
}

function CuitMissing({ base, canWrite }: { base: string; canWrite: boolean }) {
  return (
    <p className="card-hairline flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-2xl border bg-card px-4 py-3 text-sm text-pretty shadow-xs">
      <StatusPill tone="warn">Falta la CUIT</StatusPill>
      <span className="font-medium">Falta la CUIT del bar para exportar los libros de IVA.</span>
      {canWrite ? (
        <PanelLink href={`${base}/ajustes?tab=sas`}>Cargarla</PanelLink>
      ) : (
        <span className="text-muted-foreground">Pedísela a los dueños.</span>
      )}
    </p>
  )
}

function EmptyIvaBook({
  book,
  base,
  month,
  canWrite,
}: {
  book: FiscalBook
  base: string
  /** `yyyy-MM`. */
  month: string
  canWrite: boolean
}) {
  const noun = monthNoun(month)
  if (book === 'purchases') {
    return (
      <EmptyTeach
        icon={Receipt}
        title={`No hay compras con factura en ${noun}`}
        action={
          canWrite ? (
            <Button asChild className="h-11">
              <Link href={`${base}/compras/nueva`}>Cargar una compra que debo</Link>
            </Button>
          ) : undefined
        }
        secondary={
          <PanelLink href={bookHref(`${base}/libros/subdiarios`, { tipo: 'compras', mes: month })}>
            Ver el subdiario de compras
          </PanelLink>
        }
      >
        Acá entran las facturas, las notas de crédito y débito y los tiques con CUIT. Lo que
        compraste sin factura queda registrado igual: está en el Libro diario y en el subdiario de
        compras.
      </EmptyTeach>
    )
  }
  return (
    <EmptyTeach
      icon={ReceiptText}
      title={`No hay ventas con factura en ${noun}`}
      action={
        canWrite ? (
          <Button asChild className="h-11">
            <Link href={`${base}/ventas/cierre`}>Cargar el cierre del día</Link>
          </Button>
        ) : undefined
      }
      secondary={
        <PanelLink href={bookHref(`${base}/libros/subdiarios`, { tipo: 'ventas', mes: month })}>
          Ver el subdiario de ventas
        </PanelLink>
      }
    >
      Acá entra lo que marcás como facturado en cada cierre del día. Lo demás queda como venta sin
      factura, en el mismo libro diario.
    </EmptyTeach>
  )
}

/** Los totales del mes en una banda: neto, IVA, percepciones y total, con su aclaración. */
function IvaTotals({
  book,
  amounts,
}: {
  book: FiscalBook
  amounts: Readonly<Record<FiscalAmountKey, number>>
}) {
  const s = ivaSummary(amounts)
  return (
    <BookTotals
      label="Totales del mes"
      items={[
        { key: 'neto', label: 'Neto gravado', value: <Amount cents={s.netCents} /> },
        {
          key: 'iva',
          label: COPY[book].vat,
          value: <Amount cents={s.vatCents} />,
          hint:
            book === 'purchases' && s.computableCents !== s.vatCents ? (
              <>
                computable <Amount cents={s.computableCents} />
              </>
            ) : undefined,
        },
        {
          key: 'percepciones',
          label: 'Percepciones',
          value: <Amount cents={s.perceptionsCents} />,
        },
        {
          key: 'total',
          label: 'Total',
          value: <Amount cents={s.totalCents} />,
          hint:
            s.otherCents !== 0 ? (
              <>
                no gravado, exento y otros <Amount cents={s.otherCents} />
              </>
            ) : undefined,
        },
      ]}
    />
  )
}

function voucherNumberOf(row: IvaBookRow): string {
  if (row.numberTo !== null && row.numberTo !== row.numberFrom) {
    return formatVoucherRange(row.pointOfSale, row.numberFrom, row.numberTo)
  }
  return formatVoucherNumber(row.pointOfSale, row.numberFrom)
}

/**
 * Un número o un rango («0003-00018345 a 0003-00018522») que, si no entra,
 * baja por los espacios y nunca se corta en el guion de un número.
 */
function WrappingVoucherNumber({ text }: { text: string }) {
  let offset = 0
  const parts = text.split(' ').map((part) => {
    const start = offset
    offset += part.length + 1
    return { part, start }
  })
  return parts.map(({ part, start }) => (
    <Fragment key={start}>
      {start > 0 ? ' ' : null}
      <span className="whitespace-nowrap">{part}</span>
    </Fragment>
  ))
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
                <DataTableHeader>Comprobante</DataTableHeader>
                <DataTableHeader>{counterparty}</DataTableHeader>
                {book === 'sales' ? <DataTableHeader>Canal</DataTableHeader> : null}
                {columns.map((c) => (
                  <DataTableHeader key={c.key} className="whitespace-nowrap px-3 text-right">
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
                      className="whitespace-nowrap rounded-sm font-medium underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
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
                    <span className="block">{row.counterpartyName || docOf(row)}</span>
                    {row.counterpartyName && row.counterpartyName !== docOf(row) ? (
                      <span className="block whitespace-nowrap text-xs text-muted-foreground">
                        {docOf(row)}
                      </span>
                    ) : null}
                  </DataTableCell>
                  {book === 'sales' ? (
                    <DataTableCell className="text-muted-foreground">
                      {row.channel ? (CHANNEL_LABELS[row.channel] ?? row.channel) : '—'}
                    </DataTableCell>
                  ) : null}
                  {columns.map((c) => (
                    <DataTableCell
                      key={c.key}
                      className={cn('px-3 text-right', c.key === 'total_cents' && 'font-medium')}
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
                  <DataTableCell key={c.key} className="px-3 text-right">
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
                className="flex items-start justify-between gap-3 px-4 py-3 outline-none hover:bg-cream-tint focus-visible:bg-cream-tint focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="min-w-0 space-y-0.5">
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    {formatIsoDay(row.voucherDate)}
                  </span>
                  <span className="block truncate text-sm font-medium">{row.voucherLabel}</span>
                  {/* El rango «0003-00018225 a 0003-00018344» no entra al lado del tipo:
                      va abajo y, si tampoco entra ahí, sigue en otra línea (no se corta). */}
                  <span className="block font-mono text-xs text-muted-foreground">
                    <WrappingVoucherNumber text={voucherNumberOf(row)} />
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
