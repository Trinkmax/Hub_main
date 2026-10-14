import Link from 'next/link'
import { Suspense } from 'react'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import { MonthStepper } from '@/components/administracion/cajas-ventas/period-filters'
import { Explain, MathRow, PanelError, RetryButton } from '@/components/administracion/kit'
import { loadPostingCatalog, type PostingCatalog } from '@/lib/accounting/context'
import { monthDays } from '@/lib/accounting/home'
import {
  buildProjection,
  type Projection,
  type ProjectionSourceDay,
  projectionFigures,
} from '@/lib/accounting/projection'
import {
  type DailyCloseCalendar,
  getDailyCloseCalendar,
  listDocuments,
} from '@/lib/accounting/queries/documents'
import { exportHref } from '@/lib/accounting/queries/labels'
import { listParties, type PartyList } from '@/lib/accounting/queries/parties'
import {
  type CashCountTreasury,
  type DailyCashCounts,
  type DayEvents,
  getSalesProjection,
  listCashCountTreasuries,
  listDailyCashCounts,
  listDayEvents,
} from '@/lib/accounting/queries/projection'
import { type QueryOutcome, settleQuery } from '@/lib/accounting/queries/shared'
import { listTreasuryAccounts, type TreasuryAccountRow } from '@/lib/accounting/queries/treasury'
import { addDays, formatDayMonth, formatMonthLabel, monthName, monthOf } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { almanacCells, commissionGaps, defaultDay } from '../_lib/almanac'
import { tabHref, type VentasFocus } from '../_lib/ventas-view'
import { CashPanel } from './cash-panel'
import { FirstSteps } from './first-steps'
import { IncomingStrip } from './incoming-strip'
import { MonthGrid } from './month-grid'
import { MonthHero, MonthHeroError } from './month-hero'
import { NightSheet } from './night-sheet'
import { PanelFocus } from './panel-focus'
import { FOLD_SUMMARY, FoldChevron, ProjectionPanel } from './projection-panel'
import { StepperSkeleton } from './skeletons'

/**
 * «El mes»: el almanaque de pared del bar. La hoja de arriba (verde) dice cómo
 * viene el mes; la de abajo tiene un casillero por noche que se llena hasta
 * donde se vendió; al tocar una noche aparece su ticket al lado. Debajo, siempre
 * en el mismo orden, los bloques «Proyección», «Ventas contra caja» y la franja
 * «En camino».
 *
 * Las lecturas se piden todas juntas y sin esperarlas (`loadMonth`): la hoja
 * verde y el almanaque salen con el calendario y la proyección, y lo demás
 * (el ticket de la noche, la nota de las comisiones, la franja) llega después
 * sin mover lo de arriba. Cada lectura va con `settleQuery`: si una falla, su
 * bloque lo dice y el resto de la pantalla sigue.
 */

type Settled<T> = Promise<QueryOutcome<T>>

export type MonthData = {
  calendar: Settled<DailyCloseCalendar>
  projection: Settled<ProjectionSourceDay[]>
  /** `null`: quien mira no lee el calendario del bar (la contadora). */
  events: Settled<DayEvents> | null
  /** Lo que entró por caja y la lista de cajas: solo para quien carga. */
  counts: Settled<DailyCashCounts> | null
  treasuries: Settled<CashCountTreasury[]> | null
  parties: Settled<PartyList>
  boxes: Settled<TreasuryAccountRow[]>
  /** El catálogo (pesado): solo para avisar qué medios no tienen la comisión cargada. */
  catalog: Settled<PostingCatalog> | null
  /** ¿Hubo algún cierre en los últimos 30 días? `null` si no hace falta saberlo. */
  recentCloses: Settled<number> | null
}

export type MonthRange = { month: string; from: string; to: string }

/** Pide todo lo de «El mes» de una vez, sin esperar nada. */
export function loadMonth(input: {
  tenantId: string
  range: MonthRange
  serviceDay: string
  isCurrentMonth: boolean
  canWrite: boolean
  canReadCalendar: boolean
}): MonthData {
  const { tenantId, range, serviceDay, canWrite } = input
  const period = { from: range.from, to: range.to }
  return {
    calendar: settleQuery(getDailyCloseCalendar(tenantId, range.month, { serviceDay })),
    projection: settleQuery(getSalesProjection(tenantId, period)),
    events: input.canReadCalendar ? settleQuery(listDayEvents(tenantId, period)) : null,
    counts: canWrite ? settleQuery(listDailyCashCounts(tenantId, period)) : null,
    treasuries: canWrite ? settleQuery(listCashCountTreasuries(tenantId)) : null,
    parties: settleQuery(listParties(tenantId, { group: 'receivables' })),
    boxes: settleQuery(listTreasuryAccounts(tenantId)),
    catalog: canWrite ? settleQuery(loadPostingCatalog(tenantId)) : null,
    // Un bar sin ningún cierre (ni este mes ni en los últimos 30 días) ve cómo se arranca.
    recentCloses: input.isCurrentMonth
      ? settleQuery(
          listDocuments(tenantId, {
            from: addDays(serviceDay, -31),
            to: serviceDay,
            kinds: ['sales_close'],
            status: 'posted',
            limit: 1,
          }).then((page) => page.rows.length),
        )
      : null,
  }
}

/** El selector de mes de la fila de vistas: espera solo desde cuándo se llevan las cuentas. */
export async function MonthAside({
  calendar,
  month,
  today,
}: {
  calendar: MonthData['calendar']
  month: string
  today: string
}) {
  const result = await calendar
  const start = result.ok ? result.data.booksStartDate : null
  return <MonthStepper month={month} today={today} minMonth={start ? monthOf(start) : null} />
}

export function MonthAsideSlot(props: Parameters<typeof MonthAside>[0]) {
  return (
    <Suspense fallback={<StepperSkeleton />}>
      <MonthAside {...props} />
    </Suspense>
  )
}

/** La leyenda del almanaque, en palabras: cada muestra con lo que quiere decir. */
function Legend({ targets, events }: { targets: boolean; events: boolean }) {
  const item = 'inline-flex items-center gap-1.5 whitespace-nowrap'
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      <li className={item}>
        <span
          aria-hidden
          className="relative h-3.5 w-3 overflow-hidden rounded-[3px] border border-adm-s1/30 bg-adm-s1/12 dark:bg-adm-s1/25"
        >
          <span className="absolute inset-y-0 left-0 w-[3px] bg-adm-s1" />
        </span>
        lo vendido
      </li>
      {targets ? (
        <li className={item}>
          <span aria-hidden className="w-3 border-t-2 border-foreground/75" />
          el objetivo del día
        </li>
      ) : null}
      <li className={item}>
        <span
          aria-hidden
          className="size-3 rounded-[3px] border border-dashed border-warning bg-warning/10"
        />
        falta el cierre
      </li>
      <li className={item}>
        <span aria-hidden className="size-3 rounded-[3px] ring-2 ring-foreground/80 ring-inset" />
        hoy
      </li>
      {events ? (
        <li className={item}>
          <span aria-hidden className="size-2 rounded-full bg-adm-s2" />
          hay un evento
        </li>
      ) : null}
    </ul>
  )
}

/** Los anillos del encuadernado, sobre la costura entre la hoja verde y la de los días. */
function Rings() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-8 -top-2.5 z-[2] flex justify-evenly sm:inset-x-12"
    >
      {['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((key, index) => (
        <span
          key={key}
          className={cn(
            'h-5 w-2 rounded-full bg-adm-gold shadow-[0_1px_2px_rgb(0_0_0/0.35)] ring-1 ring-black/15',
            index > 4 && 'max-sm:hidden',
          )}
        />
      ))}
    </div>
  )
}

/** «3 medios no tienen la comisión cargada…»: llega cuando llega el catálogo, sin frenar nada. */
async function CommissionNote({
  catalog,
  base,
}: {
  catalog: Settled<PostingCatalog>
  base: string
}) {
  const result = await catalog
  if (!result.ok) return null
  const gaps = commissionGaps(result.data)
  if (!gaps) return null
  return (
    <p className="pt-2 text-xs leading-relaxed text-muted-foreground text-pretty">
      {gaps.sentence}{' '}
      <Link
        href={`${base}/ajustes?tab=participes`}
        className="font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        Cargar las comisiones
      </Link>
    </p>
  )
}

export type MonthBodyProps = {
  data: MonthData
  tenantId: string
  tenantSlug: string
  /** `/<bar>/administracion`. */
  base: string
  /** Hoy en Córdoba: lo que llega y lo que ya tendría que haber llegado. */
  today: string
  range: MonthRange
  /** El `?mes=` de la URL, si hay: se conserva en los links. */
  monthParam: string | null
  /** El `?dia=` de la URL. */
  requestedDay: string | null
  /** El bloque que pidió la URL (`?tab=proyeccion`, `?tab=caja`). */
  focus: VentasFocus | null
  canWrite: boolean
}

export async function MonthBody(props: MonthBodyProps) {
  const { data, base, range, canWrite, focus, monthParam } = props
  const [calendarR, rowsR, eventsR, countsR, treasuriesR, recentR] = await Promise.all([
    data.calendar,
    data.projection,
    data.events,
    data.counts,
    data.treasuries,
    data.recentCloses,
  ])

  const strip = (
    <Suspense fallback={null}>
      <IncomingStrip parties={data.parties} treasuries={data.boxes} base={base} />
    </Suspense>
  )

  if (!rowsR.ok) {
    return (
      <div className="space-y-6">
        <MonthHeroError message={rowsR.message} />
        <PanelError title="Noche por noche" message={rowsR.message} />
        {strip}
      </div>
    )
  }

  const calendar = calendarR.ok ? calendarR.data : null
  const serviceDay = calendar?.serviceDay ?? props.today
  const projection: Projection = buildProjection(rowsR.data, { serviceDay })
  const { summary, totals } = projection
  const days = monthDays(projection, { booksStartDate: calendar?.booksStartDate ?? null })
  const events = eventsR?.ok ? eventsR.data : null
  const counts = countsR?.ok ? countsR.data : {}
  const treasuries = treasuriesR?.ok ? treasuriesR.data : []
  const name = monthName(Number(range.month.slice(5, 7))) || 'este mes'
  const label = formatMonthLabel(range.month)
  const currentMonth = monthOf(serviceDay)
  const isCurrentMonth = range.month === currentMonth
  const future = summary.monthState === 'future'

  const selected = defaultDay({ requested: props.requestedDay, days: days.days })
  const selectedDay = selected ? days.days.find((d) => d.date === selected) : undefined
  const cells = almanacCells({
    days: days.days,
    projection: projection.days,
    events,
    base,
    month: monthParam,
    canWrite,
    selected,
  })
  const hasEvents = cells.some((cell) => cell.dot)
  const figures = projectionFigures(summary)
  const todayPending =
    isCurrentMonth && days.days.some((d) => d.state === 'today') ? serviceDay : null
  // En el mes en curso, el primer cierre que falta de los últimos 30 días (puede ser del mes
  // pasado); mirando otro mes, el primero que falta de ESE mes.
  const firstMissing = isCurrentMonth && calendar ? calendar.firstMissingDate : days.firstMissing
  const startedMidMonth = days.days.some((d) => d.state === 'before')

  // El bar recién arrancado: ni un cierre este mes ni en los últimos 30 días.
  const brandNew =
    isCurrentMonth && days.loaded === 0 && (recentR === null || !recentR.ok || recentR.data === 0)
  const showProjection = !brandNew || focus === 'proyeccion'
  const showCash = (!brandNew || focus === 'caja') && !future
  const closeHref = firstMissing
    ? `${base}/ventas/cierre?fecha=${firstMissing}`
    : `${base}/ventas/cierre`

  const exportSales = exportHref(props.tenantSlug, 'subdiario-ventas', {
    desde: range.from,
    hasta: range.to,
  })

  return (
    <div className="space-y-6">
      <div>
        <MonthHero
          projection={projection}
          days={days}
          month={range.month}
          firstMissingDate={firstMissing}
          todayPending={todayPending}
          base={base}
          canWrite={canWrite}
        />

        {/* En la compu, dos columnas: a la izquierda el almanaque y, debajo, sus bloques; a la
            derecha la noche elegida, a lo alto de las dos filas. En el celular el orden es el
            del marcado: el almanaque, la noche y después los bloques. */}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:grid-rows-[auto_1fr] xl:items-start">
          {/* La hoja de los días, montada sobre el borde de la verde: es un almanaque, no dos tarjetas. */}
          <section
            id="almanaque"
            aria-labelledby="noche-por-noche"
            className="card-hairline relative z-[1] -mt-2.5 min-w-0 scroll-mt-28 rounded-2xl border bg-card px-3 pt-6 pb-4 shadow-xs sm:px-5 sm:pb-5 xl:col-start-1 xl:row-start-1"
          >
            <Rings />
            <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 px-1">
              <h2
                id="noche-por-noche"
                className="font-serif text-lg font-semibold leading-snug tracking-tight"
              >
                Noche por noche
              </h2>
              <Legend targets={summary.hasTargets} events={hasEvents} />
            </header>
            {startedMidMonth && calendar?.booksStartDate ? (
              <p className="mt-2 px-1 text-xs text-muted-foreground text-pretty">
                Llevás la cuenta desde el {formatDayMonth(calendar.booksStartDate)}: los días de
                antes no se cargan.
              </p>
            ) : null}

            {calendar ? (
              <MonthGrid
                className="mt-3"
                month={range.month}
                cells={cells}
                caption={`Lo vendido cada noche de ${name}`}
                ariaLabel={days.sentence}
              />
            ) : (
              <div className="mt-3 flex flex-col items-start gap-3 px-1">
                <p role="alert" className="text-sm text-muted-foreground text-pretty">
                  {calendarR.ok ? '' : calendarR.message}
                </p>
                <RetryButton />
              </div>
            )}

            <div className="mt-4 space-y-3 px-1">
              {summary.soldCents > 0 ? (
                <div className="border-t border-border/60 pt-3">
                  <Explain note="Es la misma cifra del Resumen. Todavía no se le restan las compras ni los gastos.">
                    <MathRow
                      label="Vendido en el salón y en eventos"
                      value={formatCentsShort(totals.barCents)}
                    />
                    <MathRow
                      op="−"
                      label="Comisiones de las tarjetas (estimadas)"
                      value={formatCentsShort(totals.posnetCommissionCents)}
                    />
                    <MathRow
                      op="+"
                      label="Vendido por delivery"
                      value={formatCentsShort(totals.deliveryCents)}
                    />
                    <MathRow
                      op="−"
                      label="Comisiones de las apps (estimadas)"
                      value={formatCentsShort(totals.deliveryCommissionCents)}
                    />
                    <MathRow op="=" label={figures.sold.label} value={figures.sold.value} />
                    {data.catalog ? (
                      <Suspense fallback={null}>
                        <CommissionNote catalog={data.catalog} base={base} />
                      </Suspense>
                    ) : null}
                  </Explain>
                </div>
              ) : null}
              {days.loaded > 0 ? (
                <p className="border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground text-pretty">
                  ¿Cuánto fue con factura? Está en el ticket de cada noche y, del mes entero, en{' '}
                  <Link
                    href={tabHref(base, 'facturas', { mes: monthParam })}
                    className="font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Facturas
                  </Link>
                  .
                </p>
              ) : null}
              <details
                open={!canWrite}
                className="group/fold border-t border-border/60 pt-1 text-sm"
              >
                <summary className={cn(FOLD_SUMMARY, 'text-muted-foreground')}>
                  Para la contadora
                  <FoldChevron />
                </summary>
                <div className="pb-1">
                  <ExportButton
                    href={exportSales}
                    fileName={`administracion-${props.tenantSlug}-subdiario-ventas-${range.month}.csv`}
                    label="Exportar subdiario de ventas"
                    size="sm"
                    className="h-11 md:pointer-fine:h-9"
                  />
                </div>
              </details>
            </div>
          </section>

          <div
            id="noche"
            className="min-w-0 scroll-mt-28 xl:sticky xl:top-[calc(5rem+var(--adm-nav-h,0px))] xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:mt-6"
          >
            <NightSheet
              tenantId={props.tenantId}
              base={base}
              today={props.today}
              day={calendar ? selected : null}
              state={calendar ? (selectedDay?.state ?? null) : null}
              monthName={name}
              monthState={summary.monthState}
              projectionDay={
                selected ? (projection.days.find((d) => d.day === selected) ?? null) : null
              }
              closes={calendar?.days.find((d) => d.date === selected)?.closes ?? []}
              events={selected ? (events?.[selected] ?? []) : []}
              counts={selected ? (counts[selected] ?? {}) : {}}
              treasuries={treasuries}
              canWrite={canWrite}
            />
            <PanelFocus target="noche" when="change" watch={selected} below={1280} />
          </div>

          <div className="@container min-w-0 space-y-6 xl:col-start-1 xl:row-start-2">
            {brandNew ? (
              <FirstSteps
                base={base}
                month={monthParam}
                closeHref={closeHref}
                hasTargets={summary.hasTargets}
                canWrite={canWrite}
              />
            ) : null}

            {showProjection ? (
              <ProjectionPanel
                projection={projection}
                days={days}
                events={events}
                month={range.month}
                currentMonth={currentMonth}
                base={base}
                canWrite={canWrite}
                open={focus === 'proyeccion' || !canWrite}
              />
            ) : null}

            {showCash ? (
              <CashPanel
                projection={projection}
                counts={counts}
                treasuries={treasuries}
                monthLabel={label}
                base={base}
                canWrite={canWrite}
                open={focus === 'caja' || !canWrite}
              />
            ) : null}

            {brandNew || future ? null : strip}
          </div>
        </div>
      </div>

      {focus === 'proyeccion' || focus === 'caja' ? <PanelFocus target={focus} /> : null}
    </div>
  )
}
