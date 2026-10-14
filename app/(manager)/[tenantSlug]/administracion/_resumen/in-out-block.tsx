import { ArrowRight } from 'lucide-react'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import { ChartSilhouette } from '@/components/administracion/charts/chart-parts'
import { InOutBars, InOutBarsTable } from '@/components/administracion/charts/in-out-bars'
import { EmptyTeach } from '@/components/administracion/kit/empty-teach'
import { Panel, PanelSection } from '@/components/administracion/kit/panel'
import {
  HOME_CASH_DAYS,
  homeCashRange,
  type InOutSummary,
  inOutSummary,
  monthDays,
  weekBuckets,
} from '@/lib/accounting/home'
import { monthName, startOfWeek } from '@/lib/dates'
import { PanelError, PanelLink } from './block-states'
import type { HomeData } from './home-data'

/** El título afirma qué pasó con la plata de las cajas; nunca habla de ganar ni de perder. */
function inOutTitle(summary: InOutSummary): string {
  if (!summary.hasMovements) return 'Entró y salió'
  if (summary.inCents > summary.outCents) return 'Entró más plata de la que salió'
  if (summary.outCents > summary.inCents) return 'Salió más plata de la que entró'
  return 'Entró y salió la misma plata'
}

/**
 * «Entró y salió»: la plata que pasó por las cajas en los últimos 30 días,
 * semana por semana. Es lo que de verdad se cobró y se pagó (pasar plata de una
 * caja a otra no cuenta), con la misma lectura del héroe (`getCashDaily`).
 */
export async function InOutBlock({ data, className }: { data: HomeData; className?: string }) {
  const [cashResult, settingsResult, projectionResult] = await Promise.all([
    data.cash,
    data.settings,
    data.projection,
  ])
  if (!cashResult.ok) {
    return <PanelError title="Entró y salió" message={cashResult.message} className={className} />
  }

  const range = homeCashRange(data.today)
  const booksStartDate = settingsResult.ok ? (settingsResult.data?.booksStartDate ?? null) : null
  const weeks = weekBuckets(cashResult.data.total.days, { ...range, booksStartDate })
  const summary = inOutSummary(weeks)
  // La semana en curso se llama «esta semana» en el eje, y una semana sin movimientos lo
  // dice con palabras: «$ 0» al lado de días que todavía no se cargaron es un cero que miente.
  const thisWeek = startOfWeek(data.today)
  const buckets = weeks.map((w) => ({
    key: w.key,
    label: w.label,
    shortLabel: w.key === thisWeek ? 'esta semana' : w.shortLabel,
    inCents: w.inCents,
    outCents: w.outCents,
    emptyText: w.key === thisWeek ? 'Sin movimientos todavía' : 'Sin movimientos',
  }))
  // Lo que entra sale de los cierres: si faltan, el título afirma con menos de lo que pasó.
  const missing = projectionResult.ok
    ? monthDays(projectionResult.data, { booksStartDate }).missing
    : 0
  const month = monthName(Number(data.today.slice(5, 7)))
  const missingNote =
    missing > 0
      ? `${missing === 1 ? 'Falta 1 cierre' : `Faltan ${missing} cierres`}${month ? ` de ${month}` : ''}: lo que entró puede ser más.`
      : null
  const cajasLink = (
    <PanelLink href={`${data.base}/cajas`}>
      Ver cajas
      <ArrowRight className="size-3.5" aria-hidden />
    </PanelLink>
  )

  if (!summary.hasMovements) {
    return (
      <Panel
        title="Entró y salió"
        description={`Los últimos ${HOME_CASH_DAYS} días, semana por semana.`}
        action={cajasLink}
        className={className}
      >
        <EmptyTeach plain title={summary.sentence} illustration={<ChartSilhouette kind="inout" />}>
          Cuando cargues cierres, gastos y pagos vas a ver acá cuánto entró y cuánto salió cada
          semana.
        </EmptyTeach>
      </Panel>
    )
  }

  return (
    <Panel className={className}>
      <PanelSection>
        <ChartFrame
          headingLevel="h2"
          title={inOutTitle(summary)}
          // Corta: al lado van «Ver como tabla» y «Ver cajas», y las semanas ya están en el eje.
          sentence={`${summary.sentence.replace(/\.$/, '')} en los últimos ${HOME_CASH_DAYS} días.`}
          action={cajasLink}
          chart={<InOutBars buckets={buckets} />}
          table={
            <InOutBarsTable
              buckets={buckets}
              caption={`Lo que entró y lo que salió de las cajas por semana, últimos ${HOME_CASH_DAYS} días`}
            />
          }
          footer={
            missingNote || summary.note ? (
              <>
                {missingNote ? <p>{missingNote}</p> : null}
                {summary.note ? <p>{summary.note}</p> : null}
              </>
            ) : undefined
          }
        />
      </PanelSection>
    </Panel>
  )
}
