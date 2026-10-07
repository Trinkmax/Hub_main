import { FileText, HandCoins, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { Amount } from '@/components/administracion/amount'
import { DueStatus } from '@/components/administracion/due-status'
import { plural } from '@/components/administracion/format'
import { ActionButton } from '@/components/administracion/quick-actions'
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
import { EmptyState } from '@/components/ui/empty-state'
import {
  type DocumentAmountItem,
  type DocumentListRow,
  type DocumentStatusFilter,
  encodeCursor,
  exportHref,
  LIST_PAGE_SIZE,
  listDocuments,
  PURCHASE_DOCUMENT_KINDS,
  settleQuery,
} from '@/lib/accounting/queries'
import { formatIsoDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { comprasHref, documentHref, firstParam, newPurchaseHref } from '../_lib/links'
import { periodPhrase, resolveListPeriod } from '../_lib/period'
import { BlockError } from './block-error'
import { ExportButton } from './export-button'
import { SearchFilter } from './list-filters'
import { ListPagination } from './list-pagination'
import { PeriodChips } from './period-chips'

export type DocumentsTabMode = 'comprobantes' | 'pagos'

const STATUS_OPTIONS = [
  { value: 'todos', label: 'Todos los estados', status: 'all' },
  { value: 'impagas', label: 'Impagas', status: 'unpaid' },
  { value: 'parciales', label: 'Pago parcial', status: 'partial' },
  { value: 'pagadas', label: 'Pagadas', status: 'paid' },
  { value: 'anuladas', label: 'Anuladas', status: 'voided' },
] as const satisfies ReadonlyArray<{ value: string; label: string; status: DocumentStatusFilter }>

function statusOf(raw: string) {
  return STATUS_OPTIONS.find((o) => o.value === raw) ?? STATUS_OPTIONS[0]
}

/** El estado de un comprobante de compra en palabras (H.7: Impaga · Pago parcial · Pagada · Anulada). */
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

/**
 * Las cajas de un pago o los comprobantes que canceló (H.7: «Medios» y
 * «Aplicado a»): hasta dos con su importe y cuántos más hay.
 */
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
 * «Comprobantes» y «Pagos» de Compras (H.7): período por URL, estado,
 * búsqueda, la lista paginada (tarjetas en el celular) y el exporte del
 * subdiario. El detalle de cada uno vive en `/comprobantes/[id]`.
 */
export async function DocumentsTab({
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
  const requestedPage = Number.parseInt(firstParam(sp.pagina), 10)
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 1 ? requestedPage : 1
  const offset = (page - 1) * LIST_PAGE_SIZE

  const outcome = await settleQuery(
    listDocuments(tenantId, {
      from: period.from,
      to: period.to,
      kinds: mode === 'pagos' ? ['payment'] : PURCHASE_DOCUMENT_KINDS,
      status: status.status,
      q,
      after: offset > 0 ? encodeCursor({ o: offset }, offset) : null,
      limit: LIST_PAGE_SIZE,
    }),
  )

  const tab = mode === 'pagos' ? 'pagos' : 'comprobantes'
  const exportLink = exportHref(
    tenantSlug,
    mode === 'pagos' ? 'subdiario-pagos' : 'subdiario-compras',
    {
      desde: period.from,
      hasta: period.to,
    },
  )
  const hrefFor = (p: number) =>
    comprasHref(tenantSlug, tab, {
      periodo: period.param,
      q: q || null,
      estado: mode === 'comprobantes' && status.value !== 'todos' ? status.value : null,
      pagina: p > 1 ? String(p) : null,
    })

  const toolbar = (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
          fileName={`${mode === 'pagos' ? 'subdiario-pagos' : 'subdiario-compras'}-${period.from}-${period.to}.csv`}
          label={mode === 'pagos' ? 'Exportar subdiario de pagos' : 'Exportar subdiario de compras'}
          className="h-11 self-start md:h-9 lg:self-auto"
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
      <SearchFilter
        placeholder={
          mode === 'pagos' ? 'Proveedor o número de pago' : 'Proveedor, número o detalle'
        }
        status={
          mode === 'comprobantes'
            ? {
                param: 'estado',
                value: status.value,
                defaultValue: 'todos',
                label: 'Estado de pago',
                options: STATUS_OPTIONS,
              }
            : undefined
        }
      />
    </div>
  )

  if (!outcome.ok) {
    return (
      <div className="space-y-6">
        {toolbar}
        <BlockError message={outcome.message} />
      </div>
    )
  }

  const { rows, totalRows, truncated } = outcome.data
  const totalPages = Math.max(1, Math.ceil(totalRows / LIST_PAGE_SIZE))
  const filtered = q !== '' || status.value !== 'todos'
  const when = periodPhrase(period)

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        {toolbar}
        {page > 1 && totalRows > 0 ? (
          <EmptyState
            icon={mode === 'pagos' ? HandCoins : FileText}
            title="Esta página ya no existe"
            description={`Hay ${plural(totalRows, mode === 'pagos' ? 'pago' : 'comprobante', mode === 'pagos' ? 'pagos' : 'comprobantes')} en ${when}: empezá por la primera página.`}
            action={
              <Button asChild variant="outline" className="h-11 md:h-9">
                <Link href={hrefFor(1)}>Ir a la primera página</Link>
              </Button>
            }
          />
        ) : filtered ? (
          <EmptyState
            icon={mode === 'pagos' ? HandCoins : FileText}
            title="Sin resultados"
            description={`No encontramos ${mode === 'pagos' ? 'pagos' : 'comprobantes'} con esos filtros en ${when}. Probá con otro período o quitá los filtros.`}
          />
        ) : mode === 'pagos' ? (
          <EmptyState
            icon={HandCoins}
            title={`No hay pagos en ${when}`}
            description="Cuando le pagues a un proveedor, el pago queda acá con lo que canceló."
            action={canWrite ? <ActionButton action="pagar" className="h-11 md:h-9" /> : null}
          />
        ) : (
          <EmptyState
            icon={FileText}
            title={`No hay comprobantes en ${when}`}
            description="Las facturas, notas de crédito y gastos que cargues aparecen acá, con lo que falta pagar de cada uno."
            action={
              canWrite ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild className="h-11 md:h-9">
                    <Link href={newPurchaseHref(tenantSlug)}>Cargar factura</Link>
                  </Button>
                  <ActionButton action="gasto" variant="outline" className="h-11 md:h-9" />
                </div>
              ) : null
            }
          />
        )}
      </div>
    )
  }

  const noun: readonly [string, string] =
    mode === 'pagos' ? ['pago', 'pagos'] : ['comprobante', 'comprobantes']

  return (
    <div className="space-y-6">
      {toolbar}

      {/* Compu y tablet */}
      <DataTableShell className="hidden sm:block">
        <DataTableScroll>
          <DataTableRoot>
            <caption className="sr-only">
              {mode === 'pagos' ? 'Pagos' : 'Comprobantes de compra'} de {when}
            </caption>
            <DataTableHead>
              <tr>
                <DataTableHeader className="w-28">Fecha</DataTableHeader>
                <DataTableHeader>{mode === 'pagos' ? 'Pago' : 'Comprobante'}</DataTableHeader>
                <DataTableHeader>{mode === 'pagos' ? 'Pagado a' : 'Proveedor'}</DataTableHeader>
                {mode === 'comprobantes' ? (
                  <DataTableHeader className="hidden xl:table-cell">Imputación</DataTableHeader>
                ) : (
                  <>
                    <DataTableHeader className="hidden lg:table-cell">Medios</DataTableHeader>
                    <DataTableHeader className="hidden xl:table-cell">Aplicado a</DataTableHeader>
                  </>
                )}
                <DataTableHeader className="text-right">Total</DataTableHeader>
                {mode === 'comprobantes' ? (
                  <>
                    <DataTableHeader className="text-right">Pendiente</DataTableHeader>
                    <DataTableHeader className="hidden lg:table-cell">Vence</DataTableHeader>
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
                      'group transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint',
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
                        <span
                          className={cn(
                            'block truncate font-medium group-hover:text-primary',
                            voided && 'line-through',
                          )}
                        >
                          {mode === 'pagos' ? 'Pago' : row.title}
                        </span>
                        <span className="block text-[11px] tabular-nums text-muted-foreground">
                          #{row.seq}
                          {row.issueDate !== row.accountingDate
                            ? ` · emitido el ${formatIsoDay(row.issueDate)}`
                            : ''}
                        </span>
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="max-w-[220px]">
                      <span className="block truncate">{row.partyName ?? '—'}</span>
                    </DataTableCell>
                    {mode === 'comprobantes' ? (
                      <DataTableCell className="hidden max-w-[220px] text-muted-foreground xl:table-cell">
                        <span className="block truncate">{row.imputation ?? '—'}</span>
                      </DataTableCell>
                    ) : (
                      <>
                        <DataTableCell className="hidden min-w-[180px] max-w-[260px] text-muted-foreground lg:table-cell">
                          <AmountItems items={voided ? null : row.means} />
                        </DataTableCell>
                        <DataTableCell className="hidden min-w-[200px] max-w-[280px] text-muted-foreground xl:table-cell">
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
                        <DataTableCell className="hidden lg:table-cell">
                          {hasDue(row) ? (
                            <DueStatus
                              dueDate={row.dueDate}
                              today={today}
                              settled={row.paymentStatus === 'paid'}
                              showDate
                            />
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
        <DataTableFooter>
          <span>
            Mostrando <strong className="tabular-nums text-foreground">{rows.length}</strong> de{' '}
            <strong className="tabular-nums text-foreground">
              {plural(totalRows, noun[0], noun[1])}
            </strong>
          </span>
          {truncated ? <span>Se revisaron los primeros 1.000: acotá el período.</span> : null}
        </DataTableFooter>
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
                      className={cn('block truncate text-sm font-medium', voided && 'line-through')}
                    >
                      {mode === 'pagos' ? `Pago a ${row.partyName ?? 'proveedor'}` : row.title}
                    </span>
                    {mode === 'comprobantes' && row.partyName ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.partyName}
                      </span>
                    ) : null}
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
      </div>

      <ListPagination page={Math.min(page, totalPages)} totalPages={totalPages} hrefFor={hrefFor} />
    </div>
  )
}
