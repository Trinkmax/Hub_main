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
  weekBuckets,
} from '@/lib/accounting/home'
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
  const [cashResult, settingsResult] = await Promise.all([data.cash, data.settings])
  if (!cashResult.ok) {
    return <PanelError title="Entró y salió" message={cashResult.message} className={className} />
  }

  const range = homeCashRange(data.today)
  const buckets = weekBuckets(cashResult.data.total.days, {
    ...range,
    booksStartDate: settingsResult.ok ? (settingsResult.data?.booksStartDate ?? null) : null,
  })
  const summary = inOutSummary(buckets)
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
          sentence={`${summary.sentence} Son los últimos ${HOME_CASH_DAYS} días, semana por semana.`}
          chart={<InOutBars buckets={buckets} />}
          table={
            <InOutBarsTable
              buckets={buckets}
              caption={`Lo que entró y lo que salió de las cajas por semana, últimos ${HOME_CASH_DAYS} días`}
            />
          }
          footer={summary.note ? <p>{summary.note}</p> : undefined}
        />
      </PanelSection>
      <PanelSection className="flex justify-end">{cajasLink}</PanelSection>
    </Panel>
  )
}
