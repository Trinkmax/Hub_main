import { FileText, HandCoins, SearchX, TriangleAlert, X } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, Suspense } from 'react'
import { Amount } from '@/components/administracion/amount'
import { DueStatus } from '@/components/administracion/due-status'
import { plural } from '@/components/administracion/format'
import { EmptyTeach, PanelError, PillLink } from '@/components/administracion/kit'
import { ActionButton } from '@/components/administracion/quick-actions'
import { VoucherText } from '@/components/administracion/voucher-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableFooter,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { Skeleton } from '@/components/ui/skeleton'
import {
  INVOICE_FILTER_PARAM,
  type InvoiceFilter,
  invoiceFilterSuffix,
  isNotInvoicedVoucher,
  NOT_INVOICED_BADGE,
  parseInvoiceFilter,
  withInvoiceFilter,
} from '@/lib/accounting/invoiced'
import {
  type DocumentAmountItem,
  type DocumentListPage,
  type DocumentListRow,
  type DocumentStatusFilter,
  encodeCursor,
  exportHref,
  LIST_PAGE_SIZE,
  listDocuments,
  PURCHASE_DOCUMENT_KINDS,
  type QueryOutcome,
  settleQuery,
} from '@/lib/accounting/queries'
import { formatIsoDay } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { paymentsHeadline, periodLead } from '../_lib/libreta'
import { comprasHref, documentHref, firstParam, newPurchaseHref } from '../_lib/links'
import { type ListPeriod, periodPhrase, resolveListPeriod } from '../_lib/period'
import { DocumentRows, PaymentRows } from './document-rows'
import { ExportButton } from './export-button'
import { InvoicedSplitFallback, InvoicedSplitPanel } from './invoiced-split'
import { LiveSearch } from './list-filters'
import { ListPagination } from './list-pagination'
import { PeriodChips } from './period-chips'

export type DocumentsTabMode = 'comprobantes' | 'pagos'

/**
 * El estado de pago (`?estado=`), con palabras de dueño. Los valores de la URL
 * son los de siempre; «todos» no se escribe.
 */
const STATUS_OPTIONS = [
  { value: 'todos', label: 'Todos', status: 'all' },
  { value: 'impagas', label: 'Falta pagar', status: 'unpaid' },
  { value: 'parciales', label: 'Pagué una parte', status: 'partial' },
  { value: 'pagadas', label: 'Pagadas', status: 'paid' },
  { value: 'anuladas', label: 'Anuladas', status: 'voided' },
] as const satisfies ReadonlyArray<{ value: string; label: string; status: DocumentStatusFilter }>

type StatusValue = (typeof STATUS_OPTIONS)[number]['value']

function statusOf(raw: string) {
  return STATUS_OPTIONS.find((o) => o.value === raw) ?? STATUS_OPTIONS[0]
}

const PILL_SIZE = 'h-11 md:pointer-fine:h-9'

const QUIET_LINK =
  'inline-flex min-h-11 items-center gap-1 rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0'

type Filters = {
  mode: DocumentsTabMode
  period: ListPeriod
  q: string
  status: StatusValue
  invoice: InvoiceFilter
  /** `?vista=tabla`: la tabla de la contadora, también para quien carga. */
  table: boolean
}

/** El link de la lista con todo lo elegido, cambiando lo que se pida. */
function listHref(
  tenantSlug: string,
  f: Filters,
  patch: Partial<{
    q: string
    status: StatusValue
    invoice: InvoiceFilter
    table: boolean
    page: number
  }> = {},
): string {
  const q = patch.q ?? f.q
  const status = patch.status ?? f.status
  const invoice = patch.invoice ?? f.invoice
  const table = patch.table ?? f.table
  const page = patch.page ?? 1
  return comprasHref(tenantSlug, f.mode, {
    periodo: f.period.param,
    q: q || null,
    estado: f.mode === 'comprobantes' && status !== 'todos' ? status : null,
    [INVOICE_FILTER_PARAM]: invoice !== 'todos' ? invoice : null,
    vista: table ? 'tabla' : null,
    pagina: page > 1 ? String(page) : null,
  })
}

/**
 * «Comprobantes» y «Pagos» de Compras: el diario de lo anotado. Arriba, cuánta
 * plata fue con factura y cuánta sin (su leyenda es el filtro); después una
 * sola fila de filtros (período · buscador · estado en píldoras · exporte) y los
 * renglones, con la fecha en el margen y el estado en palabras.
 *
 * La contadora (y quien pida `?vista=tabla`) ve la tabla de siempre, con
 * «Imputación», el número interno y «emitido el».
 *
 * Nada espera a nadie: el total con/sin factura y la lista se leen en paralelo,
 * cada uno detrás de su `Suspense`; los filtros pintan primero.
 */
export function DocumentsTab({
  mode,
  tenantId,
  tenantSlug,
  sp,
  today,
  canWrite,
}: {
  mode: DocumentsTabMode
  tenantId: string
  tenantSlug: string
  sp: Readonly<Record<string, string | string[] | undefined>>
  today: string
  canWrite: boolean
}) {
  const period = resolveListPeriod(sp, {
    today,
    chips: ['este-mes', 'mes-pasado', 'ultimos-90', 'este-anio'],
    fallback: 'este-mes',
  })
  const q = firstParam(sp.q).slice(0, 60)
  const status = mode === 'comprobantes' ? statusOf(firstParam(sp.estado)) : STATUS_OPTIONS[0]
  const invoice: InvoiceFilter =
    mode === 'comprobantes' ? parseInvoiceFilter(firstParam(sp[INVOICE_FILTER_PARAM])) : 'todos'
  const requestedPage = Number.parseInt(firstParam(sp.pagina), 10)
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 1 ? requestedPage : 1
  const offset = (page - 1) * LIST_PAGE_SIZE
  const filters: Filters = {
    mode,
    period,
    q,
    status: status.value,
    invoice,
    table: firstParam(sp.vista) === 'tabla',
  }
  const asTable = !canWrite || filters.table

  // La lista arranca ya: no espera al total de arriba (ni él a ella).
  const list = settleQuery(
    listDocuments(tenantId, {
      from: period.from,
      to: period.to,
      kinds: mode === 'pagos' ? ['payment'] : PURCHASE_DOCUMENT_KINDS,
      status: status.status,
      invoice,
      q,
      after: offset > 0 ? encodeCursor({ o: offset }, offset) : null,
      limit: LIST_PAGE_SIZE,
    }),
  )

  // El exporte respeta «con / sin factura» (el estado de pago y la búsqueda, no: es el subdiario).
  const exportLink = withInvoiceFilter(
    exportHref(tenantSlug, mode === 'pagos' ? 'subdiario-pagos' : 'subdiario-compras', {
      desde: period.from,
      hasta: period.to,
    }),
    invoice,
  )
  const narrowed = q !== '' || status.value !== 'todos'
  const hasFilters = narrowed || invoice !== 'todos'
  const invoiceHref = (next: InvoiceFilter) => listHref(tenantSlug, filters, { invoice: next })

  return (
    <div className="space-y-5">
      {mode === 'comprobantes' ? (
        <Suspense
          // Otro período es otro total: el esqueleto vuelve solo ahí, no al filtrar.
          key={`${period.from}|${period.to}`}
          fallback={<InvoicedSplitFallback invoice={invoice} hrefFor={invoiceHref} />}
        >
          <InvoicedSplitPanel
            tenantId={tenantId}
            tenantSlug={tenantSlug}
            from={period.from}
            to={period.to}
            lead={periodLead(period)}
            invoice={invoice}
            narrowed={narrowed}
            hrefFor={invoiceHref}
          />
        </Suspense>
      ) : null}

      <div className="space-y-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <PeriodChips
            chips={period.chips}
            active={period.active}
            from={period.from}
            to={period.to}
            label={period.label}
            max={today}
          />
          <ExportButton
            href={exportLink}
            fileName={`${mode === 'pagos' ? 'subdiario-pagos' : `subdiario-compras${invoiceFilterSuffix(invoice)}`}-${period.from}-${period.to}.csv`}
            label={
              mode === 'pagos'
                ? 'Exportar subdiario de pagos'
                : invoice === 'todos'
                  ? 'Exportar subdiario de compras'
                  : `Exportar compras ${invoice} factura`
            }
            variant="ghost"
            className="h-11 self-start text-muted-foreground hover:text-foreground md:h-9 xl:self-auto"
          />
        </div>
        {period.error ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="text-warning-text">
              {period.error} Te mostramos {periodPhrase(period)}.
            </p>
          </div>
        ) : null}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <LiveSearch
            placeholder={
              mode === 'pagos' ? 'Proveedor o número de pago' : 'Proveedor, número o detalle'
            }
            className="w-full lg:max-w-xs lg:flex-1"
          />
          {mode === 'comprobantes' ? (
            <nav aria-label="Estado de pago" className="min-w-0">
              <ul className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 py-1 [scrollbar-width:none] max-sm:pr-10 max-sm:[mask-image:linear-gradient(to_right,black_calc(100%_-_2.5rem),transparent)] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
                {STATUS_OPTIONS.filter((o) => o.value !== 'todos').map((o) => (
                  <li key={o.value} className="shrink-0">
                    <PillLink
                      // Tocar la elegida la saca.
                      href={listHref(tenantSlug, filters, {
                        status: o.value === status.value ? 'todos' : o.value,
                      })}
                      scroll={false}
                      active={o.value === status.value}
                      className={PILL_SIZE}
                    >
                      {o.label}
                    </PillLink>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          {hasFilters ? (
            <Link
              href={listHref(tenantSlug, filters, { q: '', status: 'todos', invoice: 'todos' })}
              scroll={false}
              className={cn(QUIET_LINK, 'shrink-0')}
            >
              <X aria-hidden className="size-3.5" />
              Sacar los filtros
            </Link>
          ) : null}
        </div>
      </div>

      <Suspense
        key={`${period.from}|${period.to}|${q}|${status.value}|${invoice}|${page}|${asTable}`}
        fallback={<RowsSkeleton />}
      >
        <DocumentsList
          list={list}
          tenantSlug={tenantSlug}
          filters={filters}
          page={page}
          today={today}
          canWrite={canWrite}
          asTable={asTable}
          hasFilters={hasFilters}
        />
      </Suspense>
    </div>
  )
}

/** Seis renglones con su margen, mientras llega la lista. */
function RowsSkeleton() {
  return (
    <div
      className="card-hairline overflow-hidden rounded-2xl border bg-card shadow-xs"
      aria-busy="true"
    >
      <span className="sr-only">Cargando…</span>
      <div className="divide-y divide-border/60">
        {['a', 'b', 'c', 'd', 'e', 'f'].map((k) => (
          <div key={k} className="flex">
            <div className="flex w-14 shrink-0 flex-col items-center justify-center gap-1 border-r border-adm-s5/35 py-3 sm:w-16">
              <Skeleton className="h-2 w-6" />
              <Skeleton className="h-5 w-7" />
            </div>
            <div className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="ml-auto h-4 w-24" />
                <Skeleton className="ml-auto h-3 w-16" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

async function DocumentsList({
  list,
  tenantSlug,
  filters,
  page,
  today,
  canWrite,
  asTable,
  hasFilters,
}: {
  list: Promise<QueryOutcome<DocumentListPage>>
  tenantSlug: string
  filters: Filters
  page: number
  today: string
  canWrite: boolean
  asTable: boolean
  hasFilters: boolean
}) {
  const outcome = await list
  const { mode, period } = filters
  const pagos = mode === 'pagos'
  if (!outcome.ok) {
    return <PanelError title={pagos ? 'Pagos' : 'Comprobantes'} message={outcome.message} />
  }

  const { rows, totalRows, truncated } = outcome.data
  const totalPages = Math.max(1, Math.ceil(totalRows / LIST_PAGE_SIZE))
  const when = periodLead(period, { lower: true })
  const hrefFor = (p: number) => listHref(tenantSlug, filters, { page: p })
  const noun: readonly [string, string] = pagos
    ? ['pago', 'pagos']
    : ['comprobante', 'comprobantes']

  if (rows.length === 0) {
    if (page > 1 && totalRows > 0) {
      return (
        <EmptyTeach
          icon={pagos ? HandCoins : FileText}
          title="Esta página ya no existe"
          action={
            <Button asChild variant="outline" className="h-11 rounded-full px-5 md:h-9">
              <Link href={hrefFor(1)}>Ir a la primera página</Link>
            </Button>
          }
        >
          Hay {plural(totalRows, noun[0], noun[1])} {when}: empezá por la primera página.
        </EmptyTeach>
      )
    }
    if (hasFilters) {
      return (
        <EmptyTeach
          icon={SearchX}
          title="Nada con esos filtros"
          action={
            <Button asChild variant="outline" className="h-11 rounded-full px-5 md:h-9">
              <Link
                href={listHref(tenantSlug, filters, { q: '', status: 'todos', invoice: 'todos' })}
                scroll={false}
              >
                Sacar los filtros
              </Link>
            </Button>
          }
        >
          Probá con otro período o sacá los filtros.
        </EmptyTeach>
      )
    }
    if (pagos) {
      return (
        <EmptyTeach
          icon={HandCoins}
          title={`No hay pagos ${when}`}
          action={
            canWrite ? (
              <ActionButton action="pagar" className="h-11 rounded-full px-5">
                Pago algo que debía
              </ActionButton>
            ) : undefined
          }
        >
          Cuando le pagues a un proveedor queda acá, con lo que pagaste y con qué.
        </EmptyTeach>
      )
    }
    return (
      <EmptyTeach
        icon={FileText}
        title={`Todavía no cargaste nada ${when}`}
        action={
          canWrite ? (
            <Button asChild className="h-11 rounded-full px-5">
              <Link
                href={newPurchaseHref(tenantSlug, {
                  volver: comprasHref(tenantSlug, 'comprobantes'),
                })}
              >
                Cargar una compra que debo
              </Link>
            </Button>
          ) : undefined
        }
        secondary={
          canWrite ? (
            <ActionButton
              action="gasto"
              variant="link"
              className="h-auto min-h-11 p-0 text-muted-foreground underline-offset-4 hover:text-foreground md:min-h-0"
            >
              Pagué algo recién
            </ActionButton>
          ) : undefined
        }
      >
        Acá queda todo lo que compraste y gastaste, con su papel y lo que falta pagar.
      </EmptyTeach>
    )
  }

  const headline = pagos ? paymentsHeadline({ rows, totalRows, searching: filters.q !== '' }) : null
  const lead = periodLead(period)
  const footer = (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
      <p>
        Mostrando <strong className="tabular-nums text-foreground">{rows.length}</strong> de{' '}
        <strong className="tabular-nums text-foreground">
          {plural(totalRows, noun[0], noun[1])}
        </strong>
        {truncated ? ' · Se revisaron los primeros 1.000: achicá el período.' : null}
      </p>
      {canWrite ? (
        <Link
          href={listHref(tenantSlug, filters, { table: !filters.table, page })}
          scroll={false}
          className="inline-flex min-h-11 items-center rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
        >
          {filters.table ? 'Ver como libreta' : 'Ver como tabla'}
        </Link>
      ) : null}
    </div>
  )

  return (
    <div className="space-y-4">
      {pagos && filters.q === '' ? (
        <p className="text-sm text-pretty">
          {headline ? (
            <>
              {lead} hiciste{' '}
              <strong className="font-semibold">{plural(headline.count, 'pago', 'pagos')}</strong>{' '}
              por{' '}
              <strong className="font-semibold whitespace-nowrap tabular-nums">
                {formatCentsShort(headline.cents)}
              </strong>
              .
            </>
          ) : (
            <>
              {lead} hiciste{' '}
              <strong className="font-semibold">{plural(totalRows, 'pago', 'pagos')}</strong>.
            </>
          )}
        </p>
      ) : null}

      {asTable ? (
        <DocumentsTable
          tenantSlug={tenantSlug}
          rows={rows}
          mode={mode}
          today={today}
          caption={`${pagos ? 'Pagos' : 'Comprobantes de compra'} ${when}`}
          footer={footer}
        />
      ) : pagos ? (
        <PaymentRows tenantSlug={tenantSlug} rows={rows} footer={footer} />
      ) : (
        <DocumentRows
          tenantSlug={tenantSlug}
          rows={rows}
          today={today}
          canWrite={canWrite}
          footer={footer}
        />
      )}

      <ListPagination page={Math.min(page, totalPages)} totalPages={totalPages} hrefFor={hrefFor} />
    </div>
  )
}

// ─── La tabla de la contadora (y de `?vista=tabla`) ──────────────────────────

/** El estado de un comprobante de compra, con las palabras del libro. */
function StatusBadge({ row, mode }: { row: DocumentListRow; mode: DocumentsTabMode }) {
  if (row.status === 'voided') return <Badge variant="muted">Anulado</Badge>
  if (mode === 'pagos') return null
  if (row.kind === 'expense') {
    return <span className="text-xs text-muted-foreground">De contado</span>
  }
  if (row.kind === 'purchase_credit_note') {
    return (row.openCents ?? 0) > 0 ? (
      <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
        Sin aplicar
      </Badge>
    ) : (
      <span className="text-xs text-muted-foreground">Aplicada</span>
    )
  }
  switch (row.paymentStatus) {
    case 'paid':
      return (
        <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
          Pagada
        </Badge>
      )
    case 'partial':
      return (
        <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning-text">
          Pago parcial
        </Badge>
      )
    case 'unpaid':
      return <Badge variant="outline">Impaga</Badge>
    default:
      return <span className="text-xs text-muted-foreground">—</span>
  }
}

function Dash() {
  return (
    <span className="text-muted-foreground/60">
      <span aria-hidden="true">—</span>
      <span className="sr-only">Nada</span>
    </span>
  )
}

/** La marca chica de un egreso sin factura. Con palabras, sin color. */
function NotInvoicedBadge({ row, className }: { row: DocumentListRow; className?: string }) {
  if (!isNotInvoicedVoucher(row.voucherType)) return null
  return (
    <Badge variant="muted" className={cn('px-1.5 py-0 text-[11px] font-normal', className)}>
      {NOT_INVOICED_BADGE}
    </Badge>
  )
}

/** Las cajas de un pago o los comprobantes que canceló: hasta dos con su importe y cuántos más. */
function AmountItems({
  items,
  empty,
}: {
  items: readonly DocumentAmountItem[] | null
  /** Lo que se dice si no hay ninguno (un pago sin aplicar queda «A cuenta»). */
  empty?: string
}) {
  if (items === null) return <Dash />
  if (items.length === 0) return empty ? <span className="text-xs">{empty}</span> : <Dash />
  const shown = items.slice(0, 2)
  const rest = items.length - shown.length
  return (
    <ul className="space-y-0.5 text-xs">
      {shown.map((item) => (
        <li
          key={`${item.id ?? ''}|${item.label}|${item.amountCents}`}
          className="flex min-w-0 items-baseline justify-between gap-2"
        >
          <span className="truncate">{item.label}</span>
          <Amount cents={item.amountCents} className="shrink-0" />
        </li>
      ))}
      {rest > 0 ? <li>y {plural(rest, 'más', 'más')}</li> : null}
    </ul>
  )
}

/** Lo que falta pagar (factura, ND) o aplicar (NC); nada en gastos de contado y pagos. */
function pendingOf(row: DocumentListRow): number | null {
  if (row.status === 'voided') return null
  if (row.kind === 'expense' || row.kind === 'payment') return null
  return row.openCents
}

function hasDue(row: DocumentListRow): boolean {
  return (
    row.status === 'posted' &&
    (row.kind === 'purchase' || row.kind === 'purchase_debit_note') &&
    row.dueDate !== null
  )
}

/**
 * La tabla densa de siempre (tarjetas en el celular): para la contadora es el
 * producto. Las columnas se muestran según el ancho de la tabla (`@container`).
 */
function DocumentsTable({
  tenantSlug,
  rows,
  mode,
  today,
  caption,
  footer,
}: {
  tenantSlug: string
  rows: readonly DocumentListRow[]
  mode: DocumentsTabMode
  today: string
  caption: string
  footer: ReactNode
}) {
  return (
    <>
      <DataTableShell className="@container hidden sm:block">
        <DataTableScroll>
          <DataTableRoot>
            <caption className="sr-only">{caption}</caption>
            <DataTableHead>
              <tr>
                <DataTableHeader className="w-28">Fecha</DataTableHeader>
                <DataTableHeader>{mode === 'pagos' ? 'Pago' : 'Comprobante'}</DataTableHeader>
                {mode === 'comprobantes' ? (
                  <>
                    <DataTableHeader className="hidden @[68rem]:table-cell">
                      Proveedor
                    </DataTableHeader>
                    <DataTableHeader className="hidden @[82rem]:table-cell">
                      Imputación
                    </DataTableHeader>
                  </>
                ) : (
                  <>
                    <DataTableHeader>Pagado a</DataTableHeader>
                    <DataTableHeader className="hidden @[52rem]:table-cell">Medios</DataTableHeader>
                    <DataTableHeader className="hidden @[68rem]:table-cell">
                      Aplicado a
                    </DataTableHeader>
                  </>
                )}
                <DataTableHeader className="text-right">Total</DataTableHeader>
                {mode === 'comprobantes' ? (
                  <>
                    <DataTableHeader className="text-right">Pendiente</DataTableHeader>
                    <DataTableHeader className="hidden @[48rem]:table-cell">Vence</DataTableHeader>
                  </>
                ) : null}
                <DataTableHeader>Estado</DataTableHeader>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => {
                const pending = pendingOf(row)
                const voided = row.status === 'voided'
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      'group transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-cream-tint',
                      voided && 'text-muted-foreground',
                    )}
                  >
                    <DataTableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatIsoDay(row.accountingDate)}
                    </DataTableCell>
                    <DataTableCell>
                      <Link
                        href={documentHref(tenantSlug, row.id)}
                        className="block min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span
                            className={cn(
                              'font-medium group-hover:text-primary',
                              voided && 'line-through',
                            )}
                          >
                            {mode === 'pagos' ? 'Pago' : <VoucherText text={row.title} />}
                          </span>
                          {mode === 'comprobantes' ? <NotInvoicedBadge row={row} /> : null}
                        </span>
                        <span className="block text-[11px] tabular-nums text-muted-foreground">
                          #{row.seq}
                          {row.issueDate !== row.accountingDate
                            ? ` · emitido el ${formatIsoDay(row.issueDate)}`
                            : ''}
                          {mode === 'comprobantes' && row.partyName ? (
                            <span className="@[68rem]:hidden">
                              {' · '}
                              {row.partyName}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </DataTableCell>
                    {mode === 'comprobantes' ? (
                      <>
                        <DataTableCell className="hidden max-w-[220px] @[68rem]:table-cell">
                          <span className="block truncate">{row.partyName ?? '—'}</span>
                        </DataTableCell>
                        <DataTableCell className="hidden max-w-[220px] text-muted-foreground @[82rem]:table-cell">
                          <span className="block truncate">{row.imputation ?? '—'}</span>
                        </DataTableCell>
                      </>
                    ) : (
                      <>
                        <DataTableCell className="max-w-[220px]">
                          <span className="block truncate">{row.partyName ?? '—'}</span>
                        </DataTableCell>
                        <DataTableCell className="hidden min-w-[180px] max-w-[260px] text-muted-foreground @[52rem]:table-cell">
                          <AmountItems items={voided ? null : row.means} />
                        </DataTableCell>
                        <DataTableCell className="hidden min-w-[200px] max-w-[280px] text-muted-foreground @[68rem]:table-cell">
                          <AmountItems items={voided ? null : row.appliedTo} empty="A cuenta" />
                        </DataTableCell>
                      </>
                    )}
                    <DataTableCell className="text-right">
                      <Amount
                        cents={row.totalCents}
                        className={cn('font-medium', voided && 'line-through')}
                      />
                    </DataTableCell>
                    {mode === 'comprobantes' ? (
                      <>
                        <DataTableCell className="text-right">
                          {pending !== null && pending > 0 ? <Amount cents={pending} /> : <Dash />}
                        </DataTableCell>
                        <DataTableCell className="hidden @[48rem]:table-cell">
                          {hasDue(row) && row.dueDate ? (
                            <>
                              <DueStatus
                                dueDate={row.dueDate}
                                today={today}
                                settled={row.paymentStatus === 'paid'}
                              />
                              <span className="block pl-3 text-[11px] tabular-nums text-muted-foreground">
                                {formatIsoDay(row.dueDate)}
                              </span>
                            </>
                          ) : (
                            <Dash />
                          )}
                        </DataTableCell>
                      </>
                    ) : null}
                    <DataTableCell>
                      <StatusBadge row={row} mode={mode} />
                    </DataTableCell>
                  </tr>
                )
              })}
            </DataTableBody>
          </DataTableRoot>
        </DataTableScroll>
        <DataTableFooter>{footer}</DataTableFooter>
      </DataTableShell>

      {/* Celular: tarjetas */}
      <div className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card sm:hidden">
        <ul
          aria-label={mode === 'pagos' ? 'Pagos' : 'Comprobantes de compra'}
          className="divide-y divide-border/60"
        >
          {rows.map((row) => {
            const pending = pendingOf(row)
            const voided = row.status === 'voided'
            return (
              <li key={row.id}>
                <Link
                  href={documentHref(tenantSlug, row.id)}
                  className={cn(
                    'flex min-h-11 items-start justify-between gap-3 px-4 py-3 outline-none focus-visible:bg-cream-tint active:bg-cream-tint',
                    voided && 'opacity-70',
                  )}
                >
                  <span className="min-w-0 space-y-0.5">
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      {formatIsoDay(row.accountingDate)} · #{row.seq}
                    </span>
                    <span
                      className={cn(
                        'block text-sm font-medium text-pretty',
                        voided && 'line-through',
                      )}
                    >
                      {mode === 'pagos' ? (
                        `Pago a ${row.partyName ?? 'proveedor'}`
                      ) : (
                        <VoucherText text={row.title} />
                      )}
                    </span>
                    {mode === 'comprobantes' && row.partyName ? (
                      <span className="block text-xs text-muted-foreground text-pretty">
                        {row.partyName}
                      </span>
                    ) : null}
                    {mode === 'comprobantes' ? <NotInvoicedBadge row={row} /> : null}
                    {mode === 'comprobantes' && hasDue(row) ? (
                      <DueStatus
                        dueDate={row.dueDate}
                        today={today}
                        settled={row.paymentStatus === 'paid'}
                      />
                    ) : null}
                  </span>
                  <span className="shrink-0 space-y-1 text-right">
                    <Amount
                      cents={row.totalCents}
                      block
                      className={cn('text-sm font-medium', voided && 'line-through')}
                    />
                    {pending !== null && pending > 0 ? (
                      <span className="block text-[11px] text-muted-foreground">
                        {row.kind === 'purchase_credit_note' ? 'Sin aplicar' : 'Falta'}{' '}
                        <Amount cents={pending} />
                      </span>
                    ) : null}
                    <span className="block">
                      <StatusBadge row={row} mode={mode} />
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
        <div className="border-t border-border/60 px-4 py-3 text-muted-foreground">{footer}</div>
      </div>
    </>
  )
}
