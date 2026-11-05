import Link from 'next/link'
import { Fragment } from 'react'
import { Amount } from '@/components/administracion/amount'
import { PanelLink } from '@/components/administracion/kit/panel-states'
import {
  Planilla,
  PlanillaFoot,
  PRow,
  PTable,
  PTd,
  PTh,
  PTotalRow,
} from '@/components/administracion/planilla'
import { Stamp } from '@/components/administracion/planilla/stamp'
import { Totalizer } from '@/components/administracion/planilla/totalizer'
import { Button } from '@/components/ui/button'
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
import { BookPage, SLIDING_SHEET } from './book-page'
import { ClickableBody } from './clickable-body'
import { IvaTabs } from './iva-tabs'
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
 * Libro IVA compras o ventas del mes (H.12, F.4/F.5): el totalizador, la planilla (solo las columnas
 * con algo en el mes; las notas de crédito y las anulaciones en negativo) y los exportes del libro y
 * de las alícuotas. Un segmento chico pasa a la Posición y al otro libro. Lo llaman las dos páginas;
 * valida el acceso igual que cualquier página.
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
      title={copy.title}
      toolbar={
        <>
          <IvaTabs booksPath={`${base}/libros`} month={month.month} active={copy.slug} />
          <MonthPicker month={month.month} today={today} minMonth={ctx.minMonth} />
        </>
      }
      aside={isOpen ? <Stamp tone="warn">Mes abierto</Stamp> : null}
      exports={
        hasCuit
          ? [
              {
                href: exportHref(tenantSlug, copy.exportBook, { mes: month.month }),
                fileName: `${fileBase}-${copy.exportBook}-${month.month}.csv`,
              },
              {
                href: exportHref(tenantSlug, copy.aliquots, { mes: month.month }),
                fileName: `${fileBase}-${copy.aliquots}-${month.month}.csv`,
                label: 'Alícuotas',
              },
            ]
          : undefined
      }
    >
      {!resolved.ok ? <PeriodError message={resolved.message} /> : null}
      {ctx.settings && !hasCuit ? <CuitMissing base={base} canWrite={canWrite} /> : null}

      {availability !== 'ok' ? (
        <Planilla>
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {monthAvailabilityMessage(availability, month.month, ctx.settings?.booksStartDate)}{' '}
            Elegí otro mes con las flechas de arriba.
          </p>
        </Planilla>
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
            <IvaTotals book={book} amounts={totals.data.amounts} />
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
        <Planilla>
          <PlanillaFoot className="border-t-0 bg-transparent">
            <p className="min-w-0 flex-1 basis-64 text-sm text-pretty">
              Ventas de {monthNoun(month.month)} sin factura:{' '}
              <Amount cents={uninvoiced} decimals={0} className="font-semibold" />. Están en el
              Libro diario y en el subdiario de ventas; a este libro entra solo lo facturado.
            </p>
            <PanelLink
              href={bookHref(`${base}/libros/subdiarios`, { tipo: 'ventas', mes: month.month })}
            >
              Ver todas las ventas del mes
            </PanelLink>
          </PlanillaFoot>
        </Planilla>
      ) : null}
    </BookPage>
  )
}

function CuitMissing({ base, canWrite }: { base: string; canWrite: boolean }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-pretty">
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
  const purchases = book === 'purchases'
  return (
    <Planilla>
      <div className="grid justify-items-center gap-3 px-3 py-6 text-center text-sm">
        <div className="grid max-w-prose gap-1 text-pretty">
          <p className="font-medium">
            {purchases
              ? `No hay compras con factura en ${noun}`
              : `No hay ventas con factura en ${noun}`}
          </p>
          {purchases ? (
            <p className="text-muted-foreground">
              Acá entran las facturas, las notas de crédito y débito y los tiques con CUIT. Lo que
              compraste sin factura queda registrado igual: está en el Libro diario y en el
              subdiario de compras.
            </p>
          ) : (
            <p className="text-muted-foreground">
              Acá entra lo que marcás como facturado en cada cierre del día. Lo demás queda como
              venta sin factura, en el mismo libro diario.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          {canWrite ? (
            <Button asChild variant="outline" className="h-11 md:pointer-fine:h-9">
              <Link href={purchases ? `${base}/compras/nueva` : `${base}/ventas/cierre`}>
                {purchases ? 'Cargar una compra que debo' : 'Cargar el cierre del día'}
              </Link>
            </Button>
          ) : null}
          <PanelLink
            href={bookHref(`${base}/libros/subdiarios`, {
              tipo: purchases ? 'compras' : 'ventas',
              mes: month,
            })}
          >
            {purchases ? 'Ver el subdiario de compras' : 'Ver el subdiario de ventas'}
          </PanelLink>
        </div>
      </div>
    </Planilla>
  )
}

/** Los totales del mes: neto, IVA, percepciones y total, con su aclaración. */
function IvaTotals({
  book,
  amounts,
}: {
  book: FiscalBook
  amounts: Readonly<Record<FiscalAmountKey, number>>
}) {
  const s = ivaSummary(amounts)
  return (
    <Totalizer
      items={[
        { label: 'Neto gravado', cents: s.netCents },
        {
          label: COPY[book].vat,
          cents: s.vatCents,
          hint:
            book === 'purchases' && s.computableCents !== s.vatCents ? (
              <>
                computable <Amount cents={s.computableCents} />
              </>
            ) : undefined,
        },
        { label: 'Percepciones', cents: s.perceptionsCents },
        {
          label: 'Total',
          cents: s.totalCents,
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
    <Planilla className={SLIDING_SHEET}>
      <PTable minWidth={720} label={caption}>
        <thead>
          <tr>
            <PTh>Fecha</PTh>
            <PTh>Comprobante</PTh>
            <PTh>{counterparty}</PTh>
            {book === 'sales' ? <PTh>Canal</PTh> : null}
            {columns.map((c) => (
              <PTh key={c.key} align="right">
                <abbr title={c.label} className="no-underline">
                  {c.short}
                </abbr>
              </PTh>
            ))}
          </tr>
        </thead>
        <ClickableBody>
          {rows.map((row) => (
            <PRow key={row.voucherId} className="cursor-pointer">
              <PTd className="align-top whitespace-nowrap text-muted-foreground">
                {formatIsoDay(row.voucherDate)}
              </PTd>
              <PTd className="align-top">
                <Link
                  href={`${base}/comprobantes/${row.documentId}`}
                  data-row-action=""
                  className="whitespace-nowrap rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:inline-block pointer-coarse:py-1"
                >
                  {row.voucherLabel}
                </Link>
                <span className="block font-mono text-xs text-muted-foreground">
                  <WrappingVoucherNumber text={voucherNumberOf(row)} />
                </span>
                {row.isReversal ? (
                  <span className="text-xs text-muted-foreground">Anulación</span>
                ) : null}
              </PTd>
              <PTd className="align-top">
                <span className="block">{row.counterpartyName || docOf(row)}</span>
                {row.counterpartyName && row.counterpartyName !== docOf(row) ? (
                  <span className="block whitespace-nowrap text-xs text-muted-foreground">
                    {docOf(row)}
                  </span>
                ) : null}
              </PTd>
              {book === 'sales' ? (
                <PTd className="align-top text-muted-foreground">
                  {row.channel ? (CHANNEL_LABELS[row.channel] ?? row.channel) : '—'}
                </PTd>
              ) : null}
              {columns.map((c) => (
                <PTd
                  key={c.key}
                  align="right"
                  className={cn('align-top', c.key === 'total_cents' && 'font-medium')}
                >
                  {row.amounts[c.key] ? (
                    <Amount cents={row.amounts[c.key]} currency={false} />
                  ) : null}
                </PTd>
              ))}
            </PRow>
          ))}
        </ClickableBody>
        <tfoot>
          <PTotalRow>
            <PTd colSpan={book === 'sales' ? 4 : 3} className="font-semibold">
              Totales del mes
            </PTd>
            {columns.map((c) => (
              <PTd key={c.key} align="right" className="font-semibold">
                <Amount cents={totals[c.key]} currency={false} />
              </PTd>
            ))}
          </PTotalRow>
        </tfoot>
      </PTable>
    </Planilla>
  )
}
