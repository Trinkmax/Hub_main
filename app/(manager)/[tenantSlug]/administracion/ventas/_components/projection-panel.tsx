import { ChevronDown } from 'lucide-react'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import { ChartSilhouette } from '@/components/administracion/charts/chart-parts'
import { TargetRace, TargetRaceTable } from '@/components/administracion/charts/target-race'
import { EmptyTeach, Panel, PillLink } from '@/components/administracion/kit'
import { type MonthDays, monthPace, monthTitle } from '@/lib/accounting/home'
import { type Projection, projectionFigures } from '@/lib/accounting/projection'
import type { DayEvents } from '@/lib/accounting/queries/projection'
import { addMonthsToYearMonth, formatMonthLabel, monthName } from '@/lib/dates'
import { keepPercent, staleSentence, staleTarget } from '../_lib/almanac'
import { tabHref } from '../_lib/ventas-view'
import { FoldOnPhone } from './panel-focus'
import { ProjectionTable } from './projection-table'
import { TargetBuilder } from './target-builder'
import { TargetsImportDialog } from './targets-import-dialog'

/**
 * El bloque «Proyección» de «El mes»: la carrera contra el objetivo. Con
 * objetivos, dos líneas (lo vendido y el objetivo, sumados día a día) y la
 * planilla de los socios plegada debajo. Sin objetivos, enseña los tres
 * caminos para ponerlos: pegar la columna de la planilla («Cargar una lista»,
 * que no cambió), armarlo acá o escribirlo día por día en el almanaque.
 *
 * Se llega con `?tab=proyeccion` (el link de siempre): ahí la planilla viene
 * abierta y el bloque va a todo el ancho (lo decide «El mes»). Para quien solo mira
 * también: es su vista de trabajo. En el celular, a quien carga se le pliega
 * igual (son 31 fichas): arriba quedan los tres caminos para poner el objetivo.
 */

/** El plegable de un bloque: una raya, el rótulo y la flecha. */
export const FOLD_SUMMARY =
  'flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-sm font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden'

export function FoldChevron() {
  return (
    <ChevronDown
      aria-hidden
      className="size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) group-open/fold:rotate-180 motion-reduce:transition-none"
    />
  )
}

export function ProjectionPanel({
  projection,
  days,
  events,
  month,
  currentMonth,
  base,
  canWrite,
  open,
}: {
  projection: Projection
  days: MonthDays
  /** Eventos del calendario por día; `null` si quien mira no los puede leer. */
  events: DayEvents | null
  /** `yyyy-MM`. */
  month: string
  /** El mes de hoy (`yyyy-MM`): desde ahí se llega al que viene. */
  currentMonth: string
  /** `/<bar>/administracion`. */
  base: string
  canWrite: boolean
  /** La planilla viene abierta (se entró con `?tab=proyeccion`, o es quien solo mira). */
  open: boolean
}) {
  const { summary } = projection
  const name = monthName(Number(month.slice(5, 7))) || 'este mes'
  const label = formatMonthLabel(month)
  const figures = projectionFigures(summary)
  const pace = monthPace(projection)
  const existing = projection.days.map((d) => ({ day: d.day, targetCents: d.targetCents }))
  const nextMonth = addMonthsToYearMonth(currentMonth, 1)
  const nextChip =
    canWrite && month === currentMonth ? (
      <PillLink
        size="touch"
        className="md:pointer-fine:h-9 md:pointer-fine:px-3 md:pointer-fine:text-[13px]"
        href={tabHref(base, 'proyeccion', { mes: nextMonth })}
        scroll={false}
      >
        Mes que viene
      </PillLink>
    ) : null

  const sheet = (
    <details
      open={open}
      id="planilla-dia-por-dia"
      className="group/fold mt-4 border-t border-border/60 pt-2"
    >
      <summary className={FOLD_SUMMARY}>
        Ver la planilla día por día
        <FoldChevron />
      </summary>
      <div className="pt-2">
        <ProjectionTable
          bare
          projection={projection}
          events={events}
          month={month}
          monthLabel={label}
          base={base}
          canWrite={canWrite}
        />
      </div>
      {open && canWrite ? <FoldOnPhone target="planilla-dia-por-dia" /> : null}
    </details>
  )

  if (!summary.hasTargets) {
    return (
      <Panel id="proyeccion" title="Proyección" action={nextChip}>
        {canWrite ? (
          <EmptyTeach
            plain
            illustration={<ChartSilhouette kind="line" />}
            title={`Poné el objetivo de ${name} y mirá si llegás`}
            action={<TargetsImportDialog month={month} monthLabel={label} variant="primary" />}
            secondary={
              <TargetBuilder
                month={month}
                monthName={name}
                averageCents={pace.averageCents}
                existing={existing}
                label="Armar el objetivo"
                variant="link"
              />
            }
          >
            <p>
              Un objetivo por noche. Con eso, cada día del almanaque te dice si quedó arriba o
              abajo, y arriba ves cuánto te falta vender.
            </p>
            <ol className="mt-3 space-y-1.5">
              {[
                'Si ya lo tenés en tu planilla: copiá la columna y pegala.',
                'Si lo querés armar acá: decís cuánto querés vender y qué días son fuertes.',
                'O tocá un día del almanaque y escribile el suyo.',
              ].map((text, index) => (
                <li key={text} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[11px] font-semibold tabular-nums text-foreground"
                  >
                    {index + 1}
                  </span>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
          </EmptyTeach>
        ) : (
          <p className="text-sm text-muted-foreground text-pretty">
            Este mes no tiene objetivos cargados. Cuando los dueños los pongan, acá vas a ver lo
            vendido contra el objetivo, sumado día a día.
          </p>
        )}
        {sheet}
      </Panel>
    )
  }

  const points = days.days.map((d) => ({
    date: d.date,
    soldAccumCents: d.soldAccumCents,
    targetAccumCents: d.targetAccumCents,
  }))
  const hasSales = summary.soldCents > 0
  // Antes de cargar el cierre de anoche, «a hoy» ya cuenta su objetivo y la carrera corta en la
  // última noche cargada: sin explicarlo, la misma pantalla decía «abajo» y «arriba».
  const stale = staleTarget(projection)

  return (
    <Panel id="proyeccion" title="Proyección">
      <ChartFrame
        title={monthTitle(summary, name)}
        sentence={stale ? staleSentence(stale) : keepPercent(figures.target.hint)}
        defaultView={canWrite ? 'chart' : 'table'}
        chart={
          <TargetRace
            points={points}
            todayIndex={days.todayIndex >= 0 ? days.todayIndex : null}
            emptyHint="Cuando cargues el primer cierre, acá ves lo vendido contra el objetivo, sumado día a día."
          />
        }
        table={
          hasSales ? (
            <TargetRaceTable
              points={points}
              caption={`Lo vendido y el objetivo de ${name}, sumados día a día`}
            />
          ) : undefined
        }
      />
      {canWrite ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <TargetsImportDialog month={month} monthLabel={label} />
          <TargetBuilder
            month={month}
            monthName={name}
            averageCents={pace.averageCents}
            existing={existing}
            label="Armar de nuevo"
          />
          {nextChip}
        </div>
      ) : null}
      {sheet}
    </Panel>
  )
}
