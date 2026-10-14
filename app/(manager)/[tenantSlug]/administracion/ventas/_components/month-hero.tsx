import { ArrowRight, CalendarCheck, Check, Target } from 'lucide-react'
import Link from 'next/link'
import { Meter } from '@/components/administracion/charts/meter'
import { HeroPanel, MoneyHero, RetryButton } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import { type MonthDays, monthSentence, monthTitle } from '@/lib/accounting/home'
import { type Projection, projectionFigures } from '@/lib/accounting/projection'
import {
  capitalizeFirst,
  formatDayMonth,
  formatWeekdayDayMonth,
  monthName,
  weekdayName,
} from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { keepPercent, staleNote, staleTarget } from '../_lib/almanac'
import { tabHref } from '../_lib/ventas-view'

/**
 * La hoja de arriba del almanaque: «la foto del mes». Un solo número («Vas
 * vendiendo»), una oración, y la acción del momento (el cierre que falta). A
 * la derecha, la pista: la carrera contra el objetivo, sin doble eje.
 *
 * Las cifras y sus textos («Vas vendiendo», «Objetivo a hoy», «Te falta
 * vender») salen de `projectionFigures`, tal cual las pidieron los socios: son
 * las mismas del Resumen. Sin ventas no se dibuja «$ 0»: se dice con palabras
 * qué falta para empezar a verlo.
 */

/** La pastilla quieta del héroe: dice qué es, nunca un número pelado. */
const HERO_PILL =
  'inline-flex min-h-7 items-center gap-1.5 rounded-full border border-white/12 bg-white/8 px-2.5 text-xs font-medium text-adm-hero-fg'

function nightsText(count: number): string {
  return count === 1 ? '1 noche cargada' : `${count} noches cargadas`
}

/** «miércoles 07/10». */
function dayWords(day: string): string {
  return `${weekdayName(day)} ${formatDayMonth(day)}`.trim()
}

export function MonthHero({
  projection,
  days,
  month,
  firstMissingDate,
  todayPending,
  base,
  canWrite,
}: {
  projection: Projection
  days: Pick<MonthDays, 'loaded' | 'missing' | 'sentence'>
  /** `yyyy-MM`. */
  month: string
  /** El primer cierre que falta de los últimos 30 días; `null` si no falta ninguno. */
  firstMissingDate: string | null
  /** El día de hoy (el de servicio) si todavía no tiene cierre; `null` si ya está o no es este mes. */
  todayPending: string | null
  /** `/<bar>/administracion`. */
  base: string
  canWrite: boolean
}) {
  const { summary } = projection
  const name = monthName(Number(month.slice(5, 7))) || 'este mes'
  const figures = projectionFigures(summary)
  const title = monthTitle(summary, name)
  const hasSales = summary.soldCents > 0
  const future = summary.monthState === 'future'
  // «A hoy» cuenta una noche que todavía no tiene cierre: se dice cuál, debajo de su cifra.
  const stale = staleTarget(projection)
  // Un mes que viene sin objetivo: una sola frase a la izquierda y, a la derecha, solo la acción.
  const futureBare = future && !summary.hasTargets
  // Quien solo mira un mes que viene sin objetivo no tiene nada que hacer en el recuadro.
  const showTrack = summary.hasTargets || canWrite || !future
  // La oración de siempre le habla a quien carga; a quien solo mira, se le dice qué va a ver.
  const sentence =
    !canWrite && !hasSales && summary.monthState === 'current'
      ? 'Cuando los dueños carguen los cierres del día, vas a ver acá lo vendido de cada noche.'
      : futureBare
        ? canWrite
          ? 'Ponele el objetivo ahora: cuando arranque, cada noche te dice si quedó arriba o abajo.'
          : 'Todavía no tiene objetivos cargados.'
        : // Un mes sin nada cargado: la oración nombra el MISMO día que el botón (decía «el cierre
          // de ayer» y el botón llevaba al primero que falta, que puede ser de antes).
          canWrite &&
            !hasSales &&
            !summary.hasTargets &&
            summary.monthState === 'current' &&
            firstMissingDate
          ? `Cargá el cierre del ${dayWords(firstMissingDate)} para empezar a ver cómo viene el mes.`
          : monthSentence(projection)

  return (
    <HeroPanel tone="bosque" className="grid gap-x-8 gap-y-5 lg:grid-cols-12">
      <div
        className={
          showTrack
            ? 'flex min-w-0 flex-col gap-4 lg:col-span-7'
            : 'flex min-w-0 flex-col gap-4 lg:col-span-12'
        }
      >
        {hasSales ? (
          <MoneyHero
            tone="onHero"
            size="xl"
            animate
            cents={summary.soldCents}
            label={`${figures.sold.label} en ${name}`}
            sentence={sentence}
          />
        ) : (
          <div className="min-w-0">
            <h2 className="font-serif text-3xl font-semibold leading-[1.05] tracking-tight text-adm-hero-fg text-balance sm:text-[2.6rem]">
              {title}
            </h2>
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-adm-hero-muted text-pretty">
              {sentence}
            </p>
          </div>
        )}

        {days.loaded > 0 || days.missing > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {days.loaded > 0 ? <li className={HERO_PILL}>{nightsText(days.loaded)}</li> : null}
            {days.missing > 0 ? (
              <li className={HERO_PILL}>
                <span aria-hidden className="size-1.5 rounded-full bg-warning" />
                {days.sentence}
              </li>
            ) : null}
          </ul>
        ) : null}

        {canWrite && !future ? (
          firstMissingDate ? (
            <Button
              asChild
              className="mt-auto h-auto min-h-12 w-full gap-2 whitespace-normal px-5 py-2 text-center text-base font-semibold text-balance sm:w-fit sm:px-6"
            >
              <Link href={`${base}/ventas/cierre?fecha=${firstMissingDate}`}>
                <CalendarCheck className="size-4 shrink-0" aria-hidden />
                {/* En el celular el día va corto («mié 07/10»): el botón entra en un renglón. */}
                <span>
                  Cargar el cierre del{' '}
                  <span className="sm:hidden">{formatWeekdayDayMonth(firstMissingDate)}</span>
                  <span className="max-sm:hidden">{dayWords(firstMissingDate)}</span>
                </span>
              </Link>
            </Button>
          ) : todayPending ? (
            <Button
              asChild
              variant="outline"
              className="mt-auto min-h-12 w-full gap-2 border-white/15 bg-white/10 px-6 text-base text-adm-hero-fg hover:bg-white/16 hover:text-adm-hero-fg sm:w-fit"
            >
              <Link href={`${base}/ventas/cierre?fecha=${todayPending}`}>
                <CalendarCheck className="size-4 shrink-0" aria-hidden />
                Cargar el cierre de hoy
              </Link>
            </Button>
          ) : days.loaded > 0 ? (
            <p className={`${HERO_PILL} mt-auto w-fit`}>
              <Check aria-hidden className="size-3.5" strokeWidth={3} />
              Están todos los cierres cargados
            </p>
          ) : null
        ) : null}
      </div>

      {/* La pista: lo vendido contra el objetivo del mes, con la marca de «a hoy». */}
      {showTrack ? (
        <div
          className={
            futureBare
              ? 'flex min-w-0 flex-col justify-center gap-2 rounded-2xl bg-white/8 p-4 sm:p-5 lg:col-span-5'
              : 'min-w-0 rounded-2xl bg-white/8 p-4 sm:p-5 lg:col-span-5'
          }
        >
          {summary.hasTargets ? (
            <div className="space-y-4">
              <h3 className="font-serif text-lg font-semibold leading-snug tracking-tight text-adm-hero-fg text-balance">
                {hasSales
                  ? keepPercent(title)
                  : `El objetivo de ${name} es ${formatCentsShort(summary.monthTargetCents)}`}
              </h3>
              <Meter
                tone="onHero"
                height={14}
                valueCents={summary.soldCents}
                totalCents={summary.monthTargetCents}
                markerCents={summary.targetToDateCents}
                markerLabel="objetivo a hoy"
                label="Vendido del objetivo del mes"
              />
              {/* Lado a lado: el «%» va pegado a su número (`keepPercent`), así «vas 4 %» nunca
                  queda partido en dos renglones. */}
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {[figures.target, figures.remaining].map((figure) => (
                  <div key={figure.label} className="min-w-0">
                    <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-adm-hero-muted">
                      {figure.label}
                    </dt>
                    <dd className="mt-1 font-serif text-2xl font-semibold leading-none tracking-tight text-adm-hero-fg tabular-nums">
                      {figure.value}
                    </dd>
                    {figure.hint ? (
                      <dd className="mt-1.5 text-xs leading-snug text-adm-hero-muted text-pretty">
                        {keepPercent(figure.hint)}
                        {figure === figures.target && stale ? (
                          <span className="block">{staleNote(stale)}</span>
                        ) : null}
                      </dd>
                    ) : null}
                  </div>
                ))}
              </dl>
            </div>
          ) : futureBare ? (
            canWrite ? (
              // Un mes que viene: solo la acción, la del momento (lo que pasa después ya lo dice
              // la izquierda).
              <Button
                asChild
                className="min-h-12 w-full gap-2 px-5 text-base font-semibold sm:w-fit"
              >
                <Link href={tabHref(base, 'proyeccion', { mes: month })}>
                  <Target aria-hidden className="size-4 shrink-0" />
                  Poner el objetivo de {name}
                </Link>
              </Button>
            ) : null
          ) : (
            <div className="flex h-full flex-col gap-1 lg:gap-3">
              <h3 className="font-serif text-lg font-semibold leading-snug tracking-tight text-adm-hero-fg text-balance">
                {capitalizeFirst(name)}{' '}
                {summary.monthState === 'past' ? 'no tuvo objetivo' : 'todavía no tiene objetivo'}
              </h3>
              {/* La pista vacía: el riel punteado, sin marcas (sin objetivo no hay «a hoy»). En
                  el celular no se dibuja (cada renglón cuenta): quedan el título y el link. */}
              <div
                aria-hidden
                className="h-3.5 rounded-full border border-dashed border-white/35 max-lg:hidden"
              />
              {canWrite ? (
                <>
                  <p className="text-sm leading-relaxed text-adm-hero-muted text-pretty max-lg:hidden">
                    {summary.monthState === 'past'
                      ? 'Con un objetivo, cada noche del almanaque dice si quedó arriba o abajo.'
                      : 'Con un objetivo, acá ves por dónde deberías ir hoy y cuánto te falta vender.'}
                  </p>
                  <Link
                    href={tabHref(base, 'proyeccion', { mes: month })}
                    className="mt-auto inline-flex min-h-11 w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-adm-hero-fg underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Target aria-hidden className="size-4 shrink-0" />
                    Poner el objetivo de {name}
                    <ArrowRight aria-hidden className="size-3.5 shrink-0" />
                  </Link>
                </>
              ) : (
                <p className="text-sm leading-relaxed text-adm-hero-muted text-pretty">
                  Este mes no tiene objetivos cargados.
                </p>
              )}
            </div>
          )}
        </div>
      ) : null}
    </HeroPanel>
  )
}

/** La proyección no se pudo leer: la hoja conserva su lugar, dice por qué y ofrece reintentar. */
export function MonthHeroError({ message }: { message: string }) {
  return (
    <HeroPanel tone="crema" className="space-y-3">
      <h2 className="font-serif text-2xl font-semibold tracking-tight text-balance">
        No pudimos cargar el mes.
      </h2>
      <p role="alert" className="max-w-prose text-sm text-muted-foreground text-pretty">
        {message}
      </p>
      <RetryButton />
    </HeroPanel>
  )
}
