import { TriangleAlert, X } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import { plural } from '@/components/administracion/format'
import { Planilla, PlanillaBar, PlanillaFoot } from '@/components/administracion/planilla'
import { ActionButton } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import {
  INVOICE_FILTER_OPTIONS,
  INVOICE_FILTER_PARAM,
  type InvoiceFilter,
  invoiceFilterSuffix,
  parseInvoiceFilter,
  withInvoiceFilter,
} from '@/lib/accounting/invoiced'
import {
  type DocumentListPage,
  type DocumentStatusFilter,
  encodeCursor,
  exportHref,
  LIST_PAGE_SIZE,
  listDocuments,
  PURCHASE_DOCUMENT_KINDS,
  type QueryOutcome,
  settleQuery,
} from '@/lib/accounting/queries'
import { periodLead } from '../_lib/libreta'
import { comprasHref, firstParam, newPurchaseHref } from '../_lib/links'
import { type ListPeriod, periodPhrase, resolveListPeriod } from '../_lib/period'
import { DocumentRows, PaymentRows } from './document-rows'
import { ExportButton } from './export-button'
import { InvoicedTotals } from './invoiced-totals'
import { LiveSearch } from './list-filters'
import { ListPagination } from './list-pagination'
import { PeriodChips } from './period-chips'
import { SheetControls, SheetEmpty, SheetError } from './planilla-bits'
import { SheetSkeleton, TotalizerSkeleton } from './planilla-skeleton'
import { Segment } from './segment'
import { UrlSelect } from './url-select'

export type DocumentsTabMode = 'comprobantes' | 'pagos'

/**
 * El estado de pago (`?estado=`), con palabras de dueño. Los valores de la URL
 * son los de siempre; «todos» no se escribe.
 */
const STATUS_OPTIONS = [
  { value: 'todos', label: 'Todos los estados', status: 'all' },
  { value: 'impagas', label: 'Falta pagar', status: 'unpaid' },
  { value: 'parciales', label: 'Pagué una parte', status: 'partial' },
  { value: 'pagadas', label: 'Pagadas', status: 'paid' },
  { value: 'anuladas', label: 'Anuladas', status: 'voided' },
] as const satisfies ReadonlyArray<{ value: string; label: string; status: DocumentStatusFilter }>

type StatusValue = (typeof STATUS_OPTIONS)[number]['value']

function statusOf(raw: string) {
  return STATUS_OPTIONS.find((o) => o.value === raw) ?? STATUS_OPTIONS[0]
}

const QUIET_LINK =
  'inline-flex min-h-10 items-center gap-1 rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:min-h-0'

type Filters = {
  mode: DocumentsTabMode
  period: ListPeriod
  q: string
  status: StatusValue
  invoice: InvoiceFilter
  /** `?vista=tabla`: las columnas de la contadora, también para quien carga. */
  table: boolean
}

/** El link de la lista con todo lo elegido, cambiando lo que se pida. */
function listHref(
  tenantSlug: string,
  f: Filters,
  patch: Partial<{
    mode: DocumentsTabMode
    q: string
    status: StatusValue
    invoice: InvoiceFilter
    table: boolean
    page: number
  }> = {},
): string {
  const mode = patch.mode ?? f.mode
  const q = patch.q ?? f.q
  const status = patch.status ?? f.status
  const invoice = patch.invoice ?? f.invoice
  const table = patch.table ?? f.table
  const page = patch.page ?? 1
  return comprasHref(tenantSlug, 'comprobantes', {
    ver: mode === 'pagos' ? 'pagos' : null,
    periodo: f.period.param,
    q: q || null,
    estado: mode === 'comprobantes' && status !== 'todos' ? status : null,
    [INVOICE_FILTER_PARAM]: mode === 'comprobantes' && invoice !== 'todos' ? invoice : null,
    vista: table ? 'tabla' : null,
    pagina: page > 1 ? String(page) : null,
  })
}

/**
 * «Comprobantes» de Compras: lo anotado, en una planilla. Arriba, el segmento Compras · Pagos, con
 * factura o sin factura, el período y el exporte; adentro de la hoja, la búsqueda y el estado de
 * pago. Nada espera a nadie: los filtros pintan primero y la lista llega detrás de su `Suspense`.
 *
 * Quien carga y la contadora ven la misma tabla; ella, con Imputación, Falta y Vence, que quien carga
 * pide con «Ver imputación y vencimientos» (`?vista=tabla`).
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
  const detail = !canWrite || filters.table

  // La lista arranca ya: la barra no la espera.
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

  return (
    <>
      <PlanillaBar>
        <Segment
          label="Compras o pagos"
          items={[
            {
              key: 'comprobantes',
              label: 'Compras',
              href: listHref(tenantSlug, filters, { mode: 'comprobantes' }),
              active: mode === 'comprobantes',
            },
            {
              key: 'pagos',
              label: 'Pagos',
              href: listHref(tenantSlug, filters, { mode: 'pagos' }),
              active: mode === 'pagos',
            },
          ]}
        />
        {mode === 'comprobantes' ? (
          <Segment
            label="Con factura o sin factura"
            items={INVOICE_FILTER_OPTIONS.map((option) => ({
              key: option.value,
              label: option.label,
              href: listHref(tenantSlug, filters, { invoice: option.value }),
              active: option.value === invoice,
            }))}
          />
        ) : null}
        <PeriodChips
          chips={period.chips}
          active={period.active}
          from={period.from}
          to={period.to}
          label={period.label}
          max={today}
        />
        <div className="ml-auto flex items-center gap-2">
          <ReadOnlyBadge />
          <ExportButton
            href={exportLink}
            fileName={`${mode === 'pagos' ? 'subdiario-pagos' : `subdiario-compras${invoiceFilterSuffix(invoice)}`}-${period.from}-${period.to}.csv`}
            label="Exportar"
            pendingLabel="Preparando…"
            variant="ghost"
            size="sm"
            className="h-10 text-muted-foreground hover:text-foreground md:pointer-fine:h-8"
          />
        </div>
      </PlanillaBar>

      {period.error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-warning-text">
            {period.error} Te mostramos {periodPhrase(period)}.
          </p>
        </div>
      ) : null}

      {mode === 'comprobantes' ? (
        <Suspense key={`${period.from}|${period.to}`} fallback={<TotalizerSkeleton />}>
          <InvoicedTotals tenantId={tenantId} from={period.from} to={period.to} />
        </Suspense>
      ) : null}

      <Planilla>
        <SheetControls>
          <LiveSearch
            placeholder={
              mode === 'pagos' ? 'Proveedor o número de pago' : 'Proveedor, número o detalle'
            }
            className="w-full sm:w-64"
          />
          {mode === 'comprobantes' ? (
            <UrlSelect
              param="estado"
              value={status.value === 'todos' ? '' : status.value}
              label="Estado de pago"
              options={STATUS_OPTIONS.map((option) => ({
                value: option.value === 'todos' ? '' : option.value,
                label: option.label,
              }))}
            />
          ) : null}
          {hasFilters ? (
            <Link
              href={listHref(tenantSlug, filters, { q: '', status: 'todos', invoice: 'todos' })}
              scroll={false}
              className={QUIET_LINK}
            >
              <X aria-hidden className="size-3" />
              Sacar los filtros
            </Link>
          ) : null}
        </SheetControls>
        <Suspense
          key={`${period.from}|${period.to}|${q}|${status.value}|${invoice}|${page}|${detail}`}
          fallback={<SheetSkeleton rows={8} columns={2} />}
        >
          <DocumentsList
            list={list}
            tenantSlug={tenantSlug}
            filters={filters}
            page={page}
            today={today}
            canWrite={canWrite}
            detail={detail}
            hasFilters={hasFilters}
          />
        </Suspense>
      </Planilla>
    </>
  )
}

async function DocumentsList({
  list,
  tenantSlug,
  filters,
  page,
  today,
  canWrite,
  detail,
  hasFilters,
}: {
  list: Promise<QueryOutcome<DocumentListPage>>
  tenantSlug: string
  filters: Filters
  page: number
  today: string
  canWrite: boolean
  detail: boolean
  hasFilters: boolean
}) {
  const outcome = await list
  const { mode, period } = filters
  const pagos = mode === 'pagos'
  if (!outcome.ok) {
    return <SheetError message={outcome.message} />
  }

  const { rows, totalRows, truncated } = outcome.data
  const totalPages = Math.max(1, Math.ceil(totalRows / LIST_PAGE_SIZE))
  const when = periodLead(period, { lower: true })
  const hrefFor = (p: number) => listHref(tenantSlug, filters, { page: p })
  const noun: readonly [string, string] = pagos
    ? ['pago', 'pagos']
    : ['comprobante', 'comprobantes']
  const buttonClass = 'h-10 md:pointer-fine:h-8'

  if (rows.length === 0) {
    if (page > 1 && totalRows > 0) {
      return (
        <SheetEmpty
          action={
            <Button asChild variant="outline" size="sm" className={buttonClass}>
              <Link href={hrefFor(1)}>Ir a la primera página</Link>
            </Button>
          }
        >
          Esta página ya no existe: hay {plural(totalRows, noun[0], noun[1])} {when}.
        </SheetEmpty>
      )
    }
    if (hasFilters) {
      return (
        <SheetEmpty
          action={
            <Button asChild variant="outline" size="sm" className={buttonClass}>
              <Link
                href={listHref(tenantSlug, filters, { q: '', status: 'todos', invoice: 'todos' })}
                scroll={false}
              >
                Sacar los filtros
              </Link>
            </Button>
          }
        >
          Nada con esos filtros. Probá con otro período o sacalos.
        </SheetEmpty>
      )
    }
    if (pagos) {
      return (
        <SheetEmpty
          action={
            canWrite ? (
              <ActionButton action="pagar" size="sm" className={buttonClass}>
                Cargar un pago
              </ActionButton>
            ) : undefined
          }
        >
          No hay pagos {when}.
        </SheetEmpty>
      )
    }
    return (
      <SheetEmpty
        action={
          canWrite ? (
            <Button asChild size="sm" className={buttonClass}>
              <Link
                href={newPurchaseHref(tenantSlug, {
                  volver: comprasHref(tenantSlug, 'comprobantes'),
                })}
              >
                Cargar una compra
              </Link>
            </Button>
          ) : undefined
        }
        secondary={
          canWrite ? (
            <Button asChild variant="outline" size="sm" className={buttonClass}>
              <Link
                href={newPurchaseHref(tenantSlug, {
                  modo: 'pago',
                  volver: comprasHref(tenantSlug, 'comprobantes'),
                })}
              >
                Compra y pago
              </Link>
            </Button>
          ) : undefined
        }
      >
        Todavía no cargaste nada {when}.
      </SheetEmpty>
    )
  }

  // Un total a medias se dice: solo es «Total» si la página trae todo lo del período.
  const totalLabel = totalRows > rows.length ? 'Total de esta página' : 'Total'
  const caption = `${pagos ? 'Pagos' : 'Comprobantes de compra'} ${when}`

  return (
    <>
      {pagos ? (
        <PaymentRows
          tenantSlug={tenantSlug}
          rows={rows}
          totalLabel={totalLabel}
          caption={caption}
        />
      ) : (
        <DocumentRows
          tenantSlug={tenantSlug}
          rows={rows}
          today={today}
          canWrite={canWrite}
          detail={detail}
          totalLabel={totalLabel}
          caption={caption}
        />
      )}
      <PlanillaFoot className="text-xs text-muted-foreground">
        <p>
          <span className="tabular-nums">{rows.length}</span> de{' '}
          <span className="tabular-nums">{plural(totalRows, noun[0], noun[1])}</span>
          {truncated ? ' · Se revisaron los primeros 1.000: achicá el período.' : null}
        </p>
        {canWrite && !pagos ? (
          <Link
            href={listHref(tenantSlug, filters, { table: !filters.table, page })}
            scroll={false}
            className={QUIET_LINK}
          >
            {filters.table ? 'Ocultar imputación y vencimientos' : 'Ver imputación y vencimientos'}
          </Link>
        ) : null}
      </PlanillaFoot>
      {totalPages > 1 ? (
        <div className="border-t border-border/70 px-3 py-2">
          <ListPagination
            page={Math.min(page, totalPages)}
            totalPages={totalPages}
            hrefFor={hrefFor}
          />
        </div>
      ) : null}
    </>
  )
}
