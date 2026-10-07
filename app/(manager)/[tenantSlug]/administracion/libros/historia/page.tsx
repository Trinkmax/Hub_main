import { History } from 'lucide-react'
import Link from 'next/link'
import { Amount } from '@/components/administracion/amount'
import { plural } from '@/components/administracion/format'
import { EmptyState } from '@/components/ui/empty-state'
import {
  decodePageToken,
  exportHref,
  type HistoryRow,
  listHistory,
  settleQuery,
} from '@/lib/accounting/queries'
import { formatDateTime, todayInCordoba } from '@/lib/dates'
import { BookPage } from '../_components/book-page'
import { ExportButton } from '../_components/export-button'
import { KeysetPagination } from '../_components/keyset-pagination'
import { RangePicker } from '../_components/period-picker'
import { PeriodError, QueryErrorBlock } from '../_components/report-error'
import { loadBookContext } from '../_lib/book-context'
import { keysetPageInfo } from '../_lib/keyset'
import { requireBooksAccess } from '../_lib/page-access'
import { bookHref, firstParam, periodParams, resolveBookRange } from '../_lib/periods'
import { HistoryFilters, type HistoryKindOption } from './_components/history-filters'

export const metadata = { title: 'Historia' }

/** Movimientos por página (la lectura trae de a 100). */
const PAGE_SIZE = 100

/** Los tipos de la historia (`audit_log.entity`), en palabras. */
const KINDS: readonly HistoryKindOption[] = [
  { value: 'acc_document', label: 'Comprobantes' },
  { value: 'acc_allocation', label: 'Imputaciones de pagos y cobros' },
  { value: 'acc_period', label: 'Cierres de mes' },
  { value: 'acc_fiscal_year', label: 'Cierres de ejercicio' },
  { value: 'acc_treasury', label: 'Cajas y cuentas' },
  { value: 'acc_party', label: 'Proveedores y clientes' },
  { value: 'acc_account', label: 'Plan de cuentas' },
  { value: 'acc_access', label: 'Accesos' },
  { value: 'acc_export', label: 'Exportes' },
]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function HistoriaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const path = `${base}/libros/historia`
  const { access } = await requireBooksAccess(tenantSlug, path)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const range = resolveBookRange(sp, today)
  const shown = range.ok ? range : resolveBookRange({}, today)
  if (!shown.ok) throw new Error('período por defecto inválido')
  const despues = firstParam(sp.despues)
  const rawPerson = firstParam(sp.quien)
  const person = rawPerson && UUID_RE.test(rawPerson) ? rawPerson : null
  const rawKind = firstParam(sp.tipo)
  const kind = KINDS.some((k) => k.value === rawKind) ? rawKind : null

  const [ctx, history] = await Promise.all([
    loadBookContext(tenantId, today),
    range.ok
      ? settleQuery(
          listHistory(tenantId, {
            userId: person,
            entity: kind,
            from: range.from,
            to: range.to,
            after: despues,
            limit: PAGE_SIZE,
          }),
        )
      : Promise.resolve(null),
  ])

  const period = periodParams(shown)
  const keep = { ...period, quien: person, tipo: kind }
  const page = history?.ok ? history.data : null
  const people = page?.people ?? []
  const info = page
    ? keysetPageInfo({
        seenBefore: decodePageToken(despues)?.seen ?? 0,
        rows: page.rows.length,
        totalRows: page.totalRows,
        pageSize: PAGE_SIZE,
      })
    : null
  const filtered = Boolean(person || kind)

  return (
    <BookPage
      backHref={bookHref(`${base}/libros`, shown.month ? { mes: shown.month } : {})}
      title="Historia"
      description={`Quién cargó, anuló o cerró qué · ${shown.label}${
        page ? ` · ${plural(page.totalRows, 'movimiento', 'movimientos')}` : ''
      }`}
      actions={
        <ExportButton
          href={exportHref(tenantSlug, 'historia', { desde: shown.from, hasta: shown.to })}
          fileName={`administracion-${tenantSlug}-historia-${shown.from}_${shown.to}.csv`}
        />
      }
      toolbar={
        <div className="space-y-3">
          <RangePicker
            range={shown}
            today={today}
            fiscalYear={ctx.fiscalYear}
            minMonth={ctx.minMonth}
          />
          <HistoryFilters
            people={people}
            kinds={KINDS}
            person={person && people.some((p) => p.userId === person) ? person : null}
            kind={kind}
          />
        </div>
      }
    >
      {!range.ok ? <PeriodError message={range.message} /> : null}
      {history && !history.ok ? (
        <QueryErrorBlock code={history.code} message={history.message} />
      ) : null}

      {page && info ? (
        page.rows.length === 0 ? (
          <EmptyState
            icon={History}
            title={filtered ? 'Sin resultados' : `No pasó nada en ${shown.label}`}
            description={
              filtered
                ? 'Probá con otra persona, otro tipo o un período más largo.'
                : 'Acá queda registrado quién cargó, anuló o cerró qué, con fecha y hora.'
            }
          />
        ) : (
          <>
            <div className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card">
              <ul aria-label="Historia contable" className="divide-y divide-border/60">
                {page.rows.map((row) => (
                  <HistoryItem key={row.id} row={row} base={base} />
                ))}
              </ul>
            </div>
            <KeysetPagination
              info={info}
              noun="movimientos"
              firstHref={bookHref(path, keep)}
              nextHref={
                page.nextCursor ? bookHref(path, { ...keep, despues: page.nextCursor }) : null
              }
            />
          </>
        )
      ) : null}
    </BookPage>
  )
}

function HistoryItem({ row, base }: { row: HistoryRow; base: string }) {
  const what = row.documentId ? (
    <Link
      href={`${base}/comprobantes/${row.documentId}`}
      className="rounded-sm underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {row.text}
    </Link>
  ) : (
    row.text
  )
  return (
    <li className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm text-pretty">
          <span className="font-medium">{row.actorName}</span> {what}
          {row.documentSeq ? (
            <span className="text-muted-foreground"> · #{row.documentSeq}</span>
          ) : null}
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {formatDateTime(row.createdAt)}
          {row.detail ? ` · ${row.detail}` : ''}
        </p>
      </div>
      {row.amountCents !== null ? (
        <Amount cents={row.amountCents} className="shrink-0 text-sm font-medium sm:text-right" />
      ) : null}
    </li>
  )
}
