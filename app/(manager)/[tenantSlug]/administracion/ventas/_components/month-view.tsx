import Link from 'next/link'
import { Suspense } from 'react'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import { MonthStepper } from '@/components/administracion/cajas-ventas/period-filters'
import { PanelError, RetryButton } from '@/components/administracion/kit'
import { PlanillaBar } from '@/components/administracion/planilla'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { loadPostingCatalog, type PostingCatalog } from '@/lib/accounting/context'
import { type MonthDayState, monthDays } from '@/lib/accounting/home'
import {
  buildProjection,
  type ProjectionSourceDay,
  type TargetOfDay,
} from '@/lib/accounting/projection'
import { type DailyCloseCalendar, getDailyCloseCalendar } from '@/lib/accounting/queries/documents'
import { exportHref } from '@/lib/accounting/queries/labels'
import {
  type CashCountTreasury,
  type DailyCashCounts,
  type DayEvents,
  getSalesProjection,
  listCashCountTreasuries,
  listDailyCashCounts,
  listDayEvents,
  listSalesTargets,
} from '@/lib/accounting/queries/projection'
import { type QueryOutcome, settleQuery } from '@/lib/accounting/queries/shared'
import {
  addMonthsToYearMonth,
  daysInMonth,
  formatWeekdayDayMonth,
  monthName,
  monthOf,
  toIsoDay,
} from '@/lib/dates'
import { closeHref, commissionGaps, longDay, openNight, planillaHref } from '../_lib/planilla'
import { detailParam, tabHref, type VentasFocus } from '../_lib/ventas-view'
import { MonthPlanilla } from './month-planilla'
import { MORE_ITEM, MoreMenu } from './more-menu'
import { NightDrawer } from './night-drawer'
import { NightSheet } from './night-sheet'

/**
 * La planilla del mes: la vista por defecto de Ventas. Reemplazó al almanaque, a su hoja verde, a la
 * noche de la derecha y a los bloques apilados (reunión del 29/10/2026): un renglón por día, como su
 * Excel. Lo de la noche se abre en una hoja al tocar «Ver cierre».
 *
 * Las lecturas se piden todas juntas y sin esperarlas (`loadMonth`). Cada una va con `settleQuery`: si
 * una falla, lo suyo lo dice y el resto de la pantalla sigue.
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
  /** Los objetivos del mes pasado, para «Copiar»: solo para quien carga. */
  previousTargets: Settled<TargetOfDay[]> | null
  /** El catálogo (pesado): solo para avisar qué medios no tienen la comisión cargada. */
  catalog: Settled<PostingCatalog> | null
}

export type MonthRange = { month: string; from: string; to: string }

function previousMonthRange(month: string) {
  const previous = addMonthsToYearMonth(month, -1)
  const year = Number(previous.slice(0, 4))
  const number = Number(previous.slice(5, 7))
  return {
    month: previous,
    from: toIsoDay(year, number, 1),
    to: toIsoDay(year, number, daysInMonth(year, number)),
  }
}

/** Pide todo lo de la planilla de una vez, sin esperar nada. */
export function loadMonth(input: {
  tenantId: string
  range: MonthRange
  serviceDay: string
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
    previousTargets: canWrite
      ? settleQuery(listSalesTargets(tenantId, previousMonthRange(range.month)))
      : null,
    catalog: canWrite ? settleQuery(loadPostingCatalog(tenantId)) : null,
  }
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
    <p>
      {gaps.sentence}{' '}
      <Link
        href={`${base}/ajustes?tab=participes`}
        className="font-medium text-foreground underline-offset-4 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
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
  /** Hoy en Córdoba. */
  today: string
  serviceDay: string
  range: MonthRange
  /** El `?mes=` de la URL, si hay: se conserva en los links. */
  monthParam: string | null
  /** El `?dia=` de la URL: la noche abierta. */
  requestedDay: string | null
  /** Lo que pidió la URL (`?tab=proyeccion`, `?tab=caja`). */
  focus: VentasFocus | null
  /** Con qué abre «Ver detalle». */
  initialDetail: boolean
  canWrite: boolean
}

export async function MonthBody(props: MonthBodyProps) {
  const { data, base, range, canWrite, focus, monthParam, today, tenantSlug } = props
  const [calendarR, rowsR, eventsR, countsR, treasuriesR, previousR] = await Promise.all([
    data.calendar,
    data.projection,
    data.events,
    data.counts,
    data.treasuries,
    data.previousTargets,
  ])

  const calendar = calendarR.ok ? calendarR.data : null
  const serviceDay = calendar?.serviceDay ?? props.serviceDay
  const booksStart = calendar?.booksStartDate ?? null

  const bar = (firstMissing: string | null) => (
    <PlanillaBar>
      {/* El objetivo se carga también para lo que viene: quien carga llega hasta un año adelante. */}
      <MonthStepper
        month={range.month}
        today={today}
        minMonth={booksStart ? monthOf(booksStart) : null}
        maxMonth={canWrite ? addMonthsToYearMonth(monthOf(today), 12) : null}
      />
      <ReadOnlyBadge />
      <div className="ml-auto flex flex-wrap items-center gap-2.5">
        {firstMissing && canWrite ? (
          <Link
            href={closeHref(base, firstMissing)}
            prefetch={false}
            className="rounded-sm text-sm font-medium text-warning-text underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Falta el cierre del {formatWeekdayDayMonth(firstMissing)}
          </Link>
        ) : null}
        <MoreMenu label="Más de Ventas">
          <Link href={tabHref(base, 'facturas', { mes: monthParam })} className={MORE_ITEM}>
            Facturas
          </Link>
          <Link href={tabHref(base, 'cobros', { mes: monthParam })} className={MORE_ITEM}>
            Cobros
          </Link>
          <ExportButton
            href={exportHref(tenantSlug, 'subdiario-ventas', {
              desde: range.from,
              hasta: range.to,
            })}
            fileName={`administracion-${tenantSlug}-subdiario-ventas-${range.month}.csv`}
            label="Exportar subdiario de ventas"
            variant="ghost"
            className={MORE_ITEM}
          />
        </MoreMenu>
      </div>
    </PlanillaBar>
  )

  if (!rowsR.ok) {
    return (
      <>
        {bar(null)}
        <PanelError title="Planilla del mes" message={rowsR.message} />
      </>
    )
  }

  const projection = buildProjection(rowsR.data, { serviceDay })
  const days = monthDays(projection, { booksStartDate: booksStart })
  const states: Record<string, MonthDayState> = {}
  for (const d of days.days) states[d.date] = d.state

  // En el mes en curso, un cierre que falte del mes pasado no tiene renglón acá: se dice arriba.
  const missingBefore =
    range.month === monthOf(serviceDay) &&
    calendar?.firstMissingDate &&
    calendar.firstMissingDate < range.from
      ? calendar.firstMissingDate
      : null

  const night = calendar ? openNight(props.requestedDay, days.days) : null
  const nightDay = night ? projection.days.find((d) => d.day === night) : undefined
  const events = eventsR?.ok ? eventsR.data : null
  const counts = countsR?.ok ? countsR.data : {}
  const treasuries = treasuriesR?.ok ? treasuriesR.data : []
  const closeLink = {
    base,
    tab: focus,
    month: monthParam,
    detail: detailParam(props.initialDetail, focus),
  }

  return (
    <>
      {bar(missingBefore)}
      {calendarR.ok ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-card px-3 py-2">
          <p role="alert" className="min-w-0 text-sm text-muted-foreground text-pretty">
            {calendarR.message}
          </p>
          <RetryButton />
        </div>
      )}
      <MonthPlanilla
        key={range.month}
        month={range.month}
        rows={rowsR.data}
        serviceDay={serviceDay}
        states={states}
        events={events}
        counts={counts}
        treasuries={treasuries}
        previous={
          previousR?.ok
            ? { month: addMonthsToYearMonth(range.month, -1), targets: previousR.data }
            : null
        }
        base={base}
        monthParam={monthParam}
        focus={focus}
        initialDetail={props.initialDetail}
        closesFrom={days.days.some((d) => d.state === 'before') ? booksStart : null}
        canWrite={canWrite}
        commissionNote={
          data.catalog ? (
            <Suspense fallback={null}>
              <CommissionNote catalog={data.catalog} base={base} />
            </Suspense>
          ) : null
        }
      />
      {night ? (
        <NightDrawer
          key={night}
          title={`La noche del ${longDay(night)}`}
          closeHref={planillaHref(closeLink, null)}
        >
          <NightSheet
            tenantId={props.tenantId}
            base={base}
            today={today}
            day={night}
            monthName={monthName(Number(range.month.slice(5, 7))) || 'este mes'}
            projectionDay={nightDay ?? null}
            closes={calendar?.days.find((d) => d.date === night)?.closes ?? []}
            events={events?.[night] ?? []}
            counts={counts[night] ?? {}}
            treasuries={treasuries}
            canWrite={canWrite}
          />
        </NightDrawer>
      ) : null}
    </>
  )
}
