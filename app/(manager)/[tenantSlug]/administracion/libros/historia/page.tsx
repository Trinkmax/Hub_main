import { History } from 'lucide-react'
import Link from 'next/link'
import { Amount } from '@/components/administracion/amount'
import { plural } from '@/components/administracion/format'
import { EmptyTeach } from '@/components/administracion/kit/empty-teach'
import { PillLink } from '@/components/administracion/kit/pill'
import {
  decodePageToken,
  exportHref,
  type HistoryRow,
  listHistory,
  settleQuery,
} from '@/lib/accounting/queries'
import { todayInCordoba } from '@/lib/dates'
import { BookPage, PERIOD_ROW } from '../_components/book-page'
import { KeysetPagination } from '../_components/keyset-pagination'
import { RangePicker } from '../_components/period-picker'
import { PeriodError, QueryErrorBlock } from '../_components/report-error'
import { loadBookContext } from '../_lib/book-context'
import { keysetPageInfo } from '../_lib/keyset'
import { requireBooksAccess } from '../_lib/page-access'
import { bookHref, firstParam, periodParams, resolveBookRange } from '../_lib/periods'
import { HistoryFilters, type HistoryKindOption } from './_components/history-filters'
import {
  collapseHistoryRuns,
  groupHistoryByDay,
  historyText,
  historyTime,
  personInitial,
} from './_lib/days'

export const metadata = { title: 'Historia' }

/** Movimientos por página (la lectura trae de a 100). */
const PAGE_SIZE = 100

/** Hasta cuántas personas se filtran con píldoras; con más, un desplegable. */
const MAX_PEOPLE_PILLS = 6

/** Los tipos de la historia (`audit_log.entity`), en palabras. */
const KINDS: readonly HistoryKindOption[] = [
  { value: 'acc_document', label: 'Comprobantes' },
  { value: 'acc_allocation', label: 'Pagos y cobros' },
  { value: 'acc_period', label: 'Cierres de mes' },
  { value: 'acc_fiscal_year', label: 'Cierres de ejercicio' },
  { value: 'acc_treasury', label: 'Cajas' },
  { value: 'acc_party', label: 'Proveedores y clientes' },
  { value: 'acc_account', label: 'Plan de cuentas' },
  { value: 'acc_access', label: 'Accesos' },
  { value: 'acc_export', label: 'Descargas' },
]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Las píldoras de filtro: 44 px donde se toca con el dedo, 36 con mouse (como el período). */
const FILTER_PILL =
  'h-11 px-4 text-sm md:pointer-fine:h-9 md:pointer-fine:px-3 md:pointer-fine:text-[13px]'
/** Una fila de filtros que se desliza de costado en el celular y baja de renglón en la compu. */
const FILTER_ROW =
  '-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden'

/**
 * Historia (§F.14): quién cargó, anuló o cerró qué. Agrupada por día («Hoy ·
 * martes 13/10», «Ayer», «Vie 09/10»), con la inicial de cada persona al
 * margen: se lee como una bitácora, no como una tabla de auditoría.
 *
 * «Qué» y «Quién» viven en la URL (`?tipo=`, `?quien=`), como siempre; ahora
 * son píldoras (la elegida, rellena). Con más de seis personas «Quién» sigue
 * siendo un desplegable.
 */
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
  const shownPerson = person && people.some((p) => p.userId === person) ? person : null
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
      exports={[
        {
          href: exportHref(tenantSlug, 'historia', { desde: shown.from, hasta: shown.to }),
          fileName: `administracion-${tenantSlug}-historia-${shown.from}_${shown.to}.csv`,
        },
      ]}
      booksPath={`${base}/libros`}
      book="historia"
      period={shown}
      toolbar={
        <div className="space-y-3">
          <RangePicker
            className={PERIOD_ROW}
            range={shown}
            today={today}
            fiscalYear={ctx.fiscalYear}
            minMonth={ctx.minMonth}
          />
          <nav aria-label="Qué pasó">
            <ul className={FILTER_ROW}>
              <li className="shrink-0">
                <PillLink
                  href={bookHref(path, { ...period, quien: person })}
                  active={kind === null}
                  scroll={false}
                  className={FILTER_PILL}
                >
                  Todo
                </PillLink>
              </li>
              {KINDS.map((k) => (
                <li key={k.value} className="shrink-0">
                  <PillLink
                    href={bookHref(path, { ...period, quien: person, tipo: k.value })}
                    active={kind === k.value}
                    scroll={false}
                    className={FILTER_PILL}
                  >
                    {k.label}
                  </PillLink>
                </li>
              ))}
            </ul>
          </nav>
          {people.length > MAX_PEOPLE_PILLS ? (
            <HistoryFilters people={people} person={shownPerson} />
          ) : people.length > 1 || shownPerson ? (
            <nav aria-label="Quién">
              <ul className={FILTER_ROW}>
                <li className="shrink-0">
                  <PillLink
                    href={bookHref(path, { ...period, tipo: kind })}
                    active={shownPerson === null}
                    scroll={false}
                    className={FILTER_PILL}
                  >
                    Todas las personas
                  </PillLink>
                </li>
                {people.map((p) => (
                  <li key={p.userId} className="shrink-0">
                    <PillLink
                      href={bookHref(path, { ...period, tipo: kind, quien: p.userId })}
                      active={shownPerson === p.userId}
                      scroll={false}
                      className={FILTER_PILL}
                    >
                      <span className="inline-block max-w-40 truncate align-bottom">{p.name}</span>
                    </PillLink>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
      }
    >
      {!range.ok ? <PeriodError message={range.message} /> : null}
      {history && !history.ok ? (
        <QueryErrorBlock code={history.code} message={history.message} />
      ) : null}

      {page && info ? (
        page.rows.length === 0 ? (
          <EmptyTeach
            icon={History}
            title={filtered ? 'Sin resultados' : `No pasó nada en ${shown.label.toLowerCase()}`}
          >
            {filtered
              ? 'Probá con otra persona, otro tipo o un período más largo.'
              : 'Acá queda registrado quién cargó, anuló o cerró qué, con fecha y hora.'}
          </EmptyTeach>
        ) : (
          <>
            <div className="space-y-5">
              {groupHistoryByDay(page.rows, today).map((group) => (
                <section key={group.day || 'sin-fecha'} aria-label={group.label}>
                  <h2 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {group.label}
                  </h2>
                  <div className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card">
                    <ul className="divide-y divide-border/60">
                      {collapseHistoryRuns(group.rows).map(({ row, count }) => (
                        <HistoryItem key={row.id} row={row} count={count} base={base} />
                      ))}
                    </ul>
                  </div>
                </section>
              ))}
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

function HistoryItem({ row, count, base }: { row: HistoryRow; count: number; base: string }) {
  const text = historyText(row.text)
  const what = row.documentId ? (
    <Link
      href={`${base}/comprobantes/${row.documentId}`}
      className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {text}
    </Link>
  ) : (
    text
  )
  const time = historyTime(row.createdAt)
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span
        aria-hidden
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground/80"
      >
        {personInitial(row.actorName)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm text-pretty">
            <span className="font-medium">{row.actorName}</span> {what}
            {row.documentSeq ? (
              <span className="text-muted-foreground"> · #{row.documentSeq}</span>
            ) : null}
            {count > 1 ? <span className="text-muted-foreground"> · {count} veces</span> : null}
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {time}
            {time && row.detail ? ' · ' : ''}
            {row.detail ?? ''}
          </p>
        </div>
        {row.amountCents !== null ? (
          <Amount cents={row.amountCents} className="shrink-0 text-sm font-medium sm:text-right" />
        ) : null}
      </div>
    </li>
  )
}
