import { ArrowRight, Target } from 'lucide-react'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import { ChartSilhouette, dayTitle } from '@/components/administracion/charts/chart-parts'
import { CloseStrip } from '@/components/administracion/charts/close-strip'
import { DayBars, type DayBarsDay, DayBarsTable } from '@/components/administracion/charts/day-bars'
import { TargetRace } from '@/components/administracion/charts/target-race'
import { EmptyTeach } from '@/components/administracion/kit/empty-teach'
import { Explain, MathRow } from '@/components/administracion/kit/explain'
import { Panel, PanelSection } from '@/components/administracion/kit/panel'
import { monthDays, monthSentence, monthTitle } from '@/lib/accounting/home'
import { projectionFigures } from '@/lib/accounting/projection'
import { formatDayMonth, monthName } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { PanelError, PanelLink } from './block-states'
import { HomeActionButton } from './home-action'
import type { HomeData } from './home-data'

/**
 * «El mes contra el objetivo»: cómo viene la venta del mes, día por día, y qué
 * cierres faltan. Sale de la proyección que ya se pide para «Hoy te toca»
 * (`buildProjection`): las cifras son las mismas de Ventas › Proyección, que
 * es lo que pidieron los socios («Vas vendiendo» y «Te falta vender»).
 *
 * Un día sin cierre no es un día en cero: en las columnas es un hueco y en la
 * tira de abajo dice «falta» y se toca para cargarlo.
 */
export async function MonthBlock({ data, className }: { data: HomeData; className?: string }) {
  const [result, settingsResult] = await Promise.all([data.projection, data.settings])
  if (!result.ok) {
    return (
      <PanelError
        title="El mes contra el objetivo"
        message={result.message}
        className={className}
      />
    )
  }

  const projection = result.data
  const { summary, totals } = projection
  const { base, canWrite } = data
  const month = monthName(Number(data.today.slice(5, 7))) || 'este mes'
  const days = monthDays(projection, {
    booksStartDate: settingsResult.ok ? (settingsResult.data?.booksStartDate ?? null) : null,
  })
  const title = monthTitle(summary, month)
  const sentence = monthSentence(projection)
  const hasSales = days.loaded > 0 && summary.soldCents > 0
  const projectionHref = `${base}/ventas?tab=proyeccion`
  // Quien solo lee ve qué días faltan, pero no un link a cargarlos.
  const loadHref = (path: string | null) => (canWrite && path ? `${base}${path}` : undefined)

  const bars: DayBarsDay[] = days.days.map((d) => ({
    date: d.date,
    label: dayTitle(d.date),
    cents: d.cents,
    targetCents: d.targetCents,
    state: d.state === 'loaded' ? 'ok' : d.state === 'before' ? 'future' : d.state,
    href: loadHref(d.path),
  }))
  const strip = days.days.map((d) => ({
    date: d.date,
    dayNumber: d.dayNumber,
    weekday: d.weekday,
    state: d.state,
    cents: d.cents,
    isToday: d.isToday,
    href: loadHref(d.path),
  }))
  const figures = projectionFigures(summary)

  return (
    <Panel className={className}>
      <PanelSection>
        {hasSales ? (
          <ChartFrame
            headingLevel="h2"
            title={title}
            sentence={sentence}
            chart={
              <div className="space-y-6">
                <DayBars days={bars} seriesLabel="Vendido" missingPills={false} />
                {summary.hasTargets ? (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold">
                      Lo vendido en el mes, sumado día a día
                    </h3>
                    <TargetRace
                      points={days.days.map((d) => ({
                        date: d.date,
                        soldAccumCents: d.soldAccumCents,
                        targetAccumCents: d.targetAccumCents,
                      }))}
                      todayIndex={days.todayIndex >= 0 ? days.todayIndex : null}
                    />
                  </div>
                ) : null}
              </div>
            }
            table={<DayBarsTable days={bars} caption={`Lo vendido cada día de ${month}`} />}
          />
        ) : (
          <EmptyTeach plain title={title} illustration={<ChartSilhouette kind="bars" />}>
            <p>{sentence}</p>
            <p className="mt-1.5">
              Cada cierre suma una columna: vas a ver qué días vendiste más y cómo viene el mes.
            </p>
          </EmptyTeach>
        )}
      </PanelSection>

      {hasSales ? (
        <PanelSection>
          {summary.hasTargets ? (
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <dl className="flex flex-wrap gap-x-8 gap-y-3">
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{figures.sold.label}</dt>
                  <dd className="font-serif text-2xl font-semibold tracking-tight tabular-nums">
                    {figures.sold.value}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{figures.remaining.label}</dt>
                  <dd className="font-serif text-2xl font-semibold tracking-tight tabular-nums">
                    {figures.remaining.value}
                  </dd>
                  <dd className="text-xs text-muted-foreground text-pretty">
                    {figures.remaining.hint}
                  </dd>
                </div>
              </dl>
              <PanelLink href={projectionHref}>
                Ver la proyección
                <ArrowRight className="size-3.5" aria-hidden />
              </PanelLink>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl bg-secondary/50 px-3 py-2.5">
              <p className="flex items-center gap-2 text-sm text-pretty">
                <Target className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                {canWrite
                  ? 'Poné un objetivo para ver si llegás.'
                  : 'Este mes no tiene objetivos cargados.'}
              </p>
              <PanelLink href={projectionHref}>
                {canWrite ? 'Cargar objetivos' : 'Ver la proyección'}
                <ArrowRight className="size-3.5" aria-hidden />
              </PanelLink>
            </div>
          )}
        </PanelSection>
      ) : null}

      <PanelSection
        title={days.sentence}
        description={
          days.missing > 0
            ? 'Tocá un día que falta para cargarlo.'
            : 'Un casillero por día: relleno cuando su cierre está cargado.'
        }
        action={
          days.firstMissing ? (
            <HomeActionButton
              action={{
                kind: 'href',
                href: `${base}/ventas/cierre?fecha=${days.firstMissing}`,
                label: `Cargar el del ${formatDayMonth(days.firstMissing)}`,
              }}
              className="min-h-11 sm:min-h-9"
            />
          ) : undefined
        }
      >
        <CloseStrip days={strip} showLegend={false} />
      </PanelSection>

      {hasSales ? (
        <PanelSection>
          <Explain
            note={
              <>
                Lo vendido es la venta neta de los cierres del día, sin las comisiones estimadas:
                todavía no se le restan las compras ni los gastos. Son las mismas cifras de Ventas ›
                Proyección.
              </>
            }
          >
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
            {summary.hasTargets ? (
              <p className="pt-1 text-xs text-muted-foreground text-pretty">
                El objetivo del mes es {formatCentsShort(summary.monthTargetCents)}:{' '}
                {summary.remainingCents > 0
                  ? `faltan ${formatCentsShort(summary.remainingCents)}.`
                  : 'ya está cumplido.'}
              </p>
            ) : null}
            <p className="pt-1">
              <PanelLink href={`${base}/ventas?tab=neto-por-medio`} className="text-xs">
                Ver cuánto se queda cada medio de cobro
                <ArrowRight className="size-3" aria-hidden />
              </PanelLink>
            </p>
          </Explain>
        </PanelSection>
      ) : null}
    </Panel>
  )
}
