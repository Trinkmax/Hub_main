import { ChartLine } from 'lucide-react'
import type { ReactNode } from 'react'
import { BalanceArea } from '@/components/administracion/charts/balance-area'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import { InOutBars } from '@/components/administracion/charts/in-out-bars'
import { treasuryToneSwatch } from '@/components/administracion/charts/palette'
import { EmptyTeach } from '@/components/administracion/kit'
import {
  buildCashDailyViews,
  CASH_CHART_ALL,
  CASH_CHART_RANGE_OPTIONS,
  CASH_DAILY_LABELS,
  type CashChartRange,
  type CashDailyAccount,
  type CashDailyReport,
  type CashDailyView,
} from '@/lib/accounting/cash-daily'
import { balancePoints, balanceTrend, type TreasuryTone } from '@/lib/accounting/home'
import { daysBetween } from '@/lib/dates'
import { dayBuckets, type MoveFrame, moveTitle } from '../_lib/move-view'
import { type CajaOption, CajaSwitch } from './caja-switch'
import { CashDailyTable } from './cash-daily-table'

/**
 * Los dos dibujos de «Cómo se movió» van uno arriba del otro con los mismos
 * días: para que las columnas caigan una debajo de la otra, los dos lienzos
 * tienen que reservar el MISMO margen para el eje (cada uno, suelto, mide el
 * suyo según su etiqueta más larga). Acá se les fija un ancho común.
 */
export const SAME_AXIS = '[&_[class~=grid][class*=gap-x-2]]:grid-cols-[4.75rem_minmax(0,1fr)]'

const CHART_LABEL = 'text-xs font-medium text-muted-foreground'

function frameOf(range: CashChartRange): MoveFrame {
  if (range.key === 'este-mes') return { kind: 'month_to_date', month: range.from }
  if (range.key === 'mes-pasado') return { kind: 'past_month', month: range.from }
  return { kind: 'days', days: daysBetween(range.from, range.to) + 1 }
}

/**
 * «Cómo se movió la plata» (el gráfico «como de líneas» que pidieron los
 * socios): lo que había al final de cada día y, debajo, lo que entró y lo que
 * salió, cada uno con su propio eje. En un solo eje, con $ 42 M de saldo y
 * $ 40 mil de salidas por día, lo que sale no se veía.
 *
 * El server arma un dibujo por caja («Todas las cajas» primero) y la isla
 * `CajaSwitch` muestra el elegido: cambiar de caja no vuelve a pedir nada.
 * Cada dibujo lleva su título que afirma, su oración y «Ver como tabla».
 */
export function CashMovePanel({
  report,
  range,
  today,
  base,
  booksStartDate,
  tones,
}: {
  report: CashDailyReport
  range: CashChartRange
  today: string
  /** `/<bar>/administracion`. */
  base: string
  /** El día en que arrancan los libros: antes de ese día no hay saldo que dibujar. */
  booksStartDate: string | null
  /** El color de cada caja (`walletTones`): el punto de su píldora. */
  tones: Readonly<Record<string, TreasuryTone | null>>
}) {
  const views = buildCashDailyViews(report, { today })
  const accounts = new Map<string, CashDailyAccount>()
  for (const account of report.accounts) {
    if (account.treasuryId !== null) accounts.set(account.treasuryId, account)
  }
  const frame = frameOf(range)
  const endsToday = report.to === today

  const options: CajaOption[] = views.map((view) => ({
    value: view.value,
    label: view.label,
    swatch: view.value === CASH_CHART_ALL ? null : treasuryToneSwatch(tones[view.value] ?? null),
  }))

  const frames: Record<string, ReactNode> = {}
  for (const view of views) {
    const account = view.value === CASH_CHART_ALL ? report.total : accounts.get(view.value)
    if (!account) continue
    frames[view.value] = (
      <MoveFrameView
        view={view}
        account={account}
        range={range}
        frame={frame}
        endsToday={endsToday}
        booksStartDate={booksStartDate}
        dayHref={
          view.value === CASH_CHART_ALL
            ? undefined
            : (day) => `${base}/cajas/${view.value}?desde=${day}&hasta=${day}`
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Cómo se movió la plata
      </p>
      <CajaSwitch
        options={options}
        frames={frames}
        ranges={CASH_CHART_RANGE_OPTIONS}
        rangeKey={range.key}
      />
    </div>
  )
}

function MoveFrameView({
  view,
  account,
  range,
  frame,
  endsToday,
  booksStartDate,
  dayHref,
}: {
  view: CashDailyView
  account: CashDailyAccount
  range: CashChartRange
  frame: MoveFrame
  endsToday: boolean
  booksStartDate: string | null
  dayHref?: (day: string) => string
}) {
  const { series } = view
  const labels = CASH_DAILY_LABELS[series.mode]
  const caption = `${view.label} · ${range.label}`

  if (!series.hasMovements) {
    return (
      <EmptyTeach plain icon={ChartLine} title="No hubo movimientos en este período">
        {caption}. {view.summary}
      </EmptyTeach>
    )
  }

  const opts = { from: range.from, to: range.to, booksStartDate }
  const trend = balanceTrend(account, opts)
  const tooNew = trend.kind === 'too_new'
  const card = series.mode === 'card'
  const points = balancePoints(account, opts).map((p) => ({
    ...p,
    href: dayHref ? dayHref(p.date) : undefined,
  }))
  const { buckets, note } = dayBuckets(series, { booksStartDate })

  return (
    <ChartFrame
      headingLevel="h2"
      title={moveTitle({ series, frame, tooNew, subject: card ? account.name : null })}
      sentence={
        <>
          {tooNew ? trend.sentence : view.summary}
          <span className="mt-1 block text-xs tabular-nums">{caption}</span>
        </>
      }
      chart={
        <div className={`space-y-5 ${SAME_AXIS}`}>
          <div className="space-y-1">
            <p className={CHART_LABEL}>
              {card ? 'Lo que debías al final de cada día' : 'Lo que había al final de cada día'}
            </p>
            <BalanceArea
              points={points}
              todayIndex={endsToday ? points.length - 1 : null}
              label={labels.balance}
              showLegend={false}
            />
          </div>
          <div className="space-y-1">
            <p className={CHART_LABEL}>
              {card
                ? 'Los pagos y los consumos de cada día'
                : 'Lo que entró y lo que salió cada día'}
            </p>
            <InOutBars
              buckets={buckets}
              inLabel={card ? 'Pagos' : 'Entró'}
              outLabel={card ? 'Consumos' : 'Salió'}
            />
          </div>
        </div>
      }
      table={
        <CashDailyTable
          series={series}
          labels={labels}
          caption={`${view.label}, ${range.label}`}
          dayHref={dayHref}
        />
      }
      footer={
        view.note || note ? (
          <>
            {view.note ? <p>{view.note}</p> : null}
            {note ? <p>{note}</p> : null}
          </>
        ) : undefined
      }
    />
  )
}
