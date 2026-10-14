import Link from 'next/link'
import type { ReactNode } from 'react'
import { HATCH_MISSING, HATCH_OVER_FILL } from '@/components/administracion/charts/chart-parts'
import { ChartTip } from '@/components/administracion/charts/chart-tip'
import type { CoverageCell, CoverageState } from '@/lib/imports/ui/inbox'
import { cn } from '@/lib/utils'

/**
 * La tira de cobertura: qué está traído y qué falta, por día (Mercado Pago, el
 * banco) o por mes (ARCA).
 *
 * Por qué un dibujo y no una lista: lo que importa es el HUECO, y en una lista
 * de archivos lo que no está no se ve.
 *
 * - Subido = relleno. Subido y esperando revisión = relleno rayado. A medias =
 *   relleno suave con borde. Falta = contorno punteado ámbar (solo lo que suma
 *   el número de la bandeja). Falta de más atrás = contorno punteado gris: un
 *   hueco viejo no puede verse igual que lo que toca ahora. Hoy = anillo.
 *   Lo que todavía no toca y lo anterior al arranque van apagados.
 * - Debajo, una leyenda mínima con lo que aparece en ESA tira (nunca un color
 *   sin su palabra).
 * - En días no hay paradas de teclado (serían 35 por bandeja): el dibujo entero
 *   es una imagen con su conclusión en `aria-label`, y el dato de cada día sale
 *   al pasar el mouse o arrastrar el dedo. Lo mismo se lee en la oración de al
 *   lado y en «Última vez».
 * - En meses, cada casillero subido es un link a su archivo.
 *
 * Es propia de «Importar» (no va al kit de gráficos). Server-safe salvo el
 * globito (`ChartTip`).
 */

export type { CoverageCell, CoverageState }

export type CoverageStripProps = {
  cells: readonly CoverageCell[]
  granularity: 'day' | 'month'
  /** Qué decir si no hay ninguna marca. */
  emptyHint?: ReactNode
  /** La conclusión, para lectores de pantalla. */
  ariaLabel?: string
  className?: string
}

const DAY_MARK: Readonly<Record<CoverageState, string>> = {
  loaded: 'bg-adm-s1',
  review: 'bg-adm-s1',
  partial: 'border border-adm-s1 bg-adm-s1/35',
  missing: 'border border-dashed border-warning',
  gap: 'border border-dashed border-adm-neutral',
  today: 'border-2 border-foreground',
  future: 'bg-adm-track',
  before: 'bg-adm-track/50',
}

const MONTH_MARK: Readonly<Record<CoverageState, string>> = {
  loaded: 'bg-adm-s1 text-adm-hero-fg',
  review: 'bg-adm-s1 text-adm-hero-fg',
  partial: 'border border-adm-s1 bg-adm-s1/25 text-foreground',
  missing: 'border border-dashed border-warning bg-warning/10 text-warning-text',
  gap: 'border border-dashed border-adm-neutral text-muted-foreground',
  today: 'text-foreground ring-2 ring-inset ring-foreground/80',
  future: 'border border-border/60 text-muted-foreground',
  before: 'bg-adm-track/50 text-muted-foreground/70',
}

/** En qué orden van las palabras de la leyenda (el de lectura: lo hecho, lo que falta, lo demás). */
const LEGEND_ORDER: readonly CoverageState[] = [
  'loaded',
  'review',
  'partial',
  'missing',
  'gap',
  'today',
  'before',
]

/**
 * La palabra de cada marca en la leyenda. «Hoy» no va en la de días: el anillo
 * ya lleva su rótulo debajo. Lo que todavía no toca no se explica: lo dice la
 * oración de la bandeja.
 */
const LEGEND_WORD: Readonly<
  Record<'day' | 'month', Readonly<Partial<Record<CoverageState, string>>>>
> = {
  day: {
    loaded: 'subido',
    review: 'falta revisarlo',
    partial: 'a medias',
    missing: 'falta',
    gap: 'falta, de más atrás',
    before: 'antes de arrancar',
  },
  month: {
    loaded: 'subido',
    review: 'falta revisarlo',
    partial: 'a medias',
    missing: 'falta bajarlo',
    gap: 'falta, de más atrás',
    today: 'este mes',
    before: 'antes de arrancar',
  },
}

/** «Lun 12/10: falta subir» → el título y el valor del globito. */
function tipOf(title: string): { title: string; value: string | undefined } {
  const at = title.indexOf(': ')
  return at < 0
    ? { title, value: undefined }
    : { title: title.slice(0, at), value: capitalize(title.slice(at + 2)) }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** La abreviatura del mes; sobre el rayado va en su propia pastilla, para que se lea. */
function MonthLabel({ cell }: { cell: CoverageCell }) {
  return cell.state === 'review' ? (
    <span className="rounded-sm bg-adm-s1 px-1 py-0.5">{cell.label}</span>
  ) : (
    cell.label
  )
}

function hatchOf(state: CoverageState) {
  return state === 'review' ? HATCH_OVER_FILL : state === 'missing' ? HATCH_MISSING : undefined
}

/**
 * La leyenda de UNA tira: solo las marcas que aparecen en ella, cada una con su
 * muestra (la misma forma que en el dibujo) y su palabra. Chica y callada: la
 * conclusión ya la dice la oración de la bandeja.
 */
function StripLegend({
  cells,
  granularity,
}: {
  cells: readonly CoverageCell[]
  granularity: 'day' | 'month'
}) {
  const words = LEGEND_WORD[granularity]
  const present = LEGEND_ORDER.filter(
    (state) => words[state] !== undefined && cells.some((c) => c.state === state),
  )
  if (present.length === 0) return null
  return (
    <ul
      aria-label="Qué es cada marca"
      className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] leading-none text-muted-foreground"
    >
      {present.map((state) => (
        <li key={state} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span
            aria-hidden
            style={hatchOf(state)}
            className={cn(
              'h-3 w-2.5 shrink-0 rounded-[3px]',
              // La muestra usa la forma de la marca de días, que es la más simple de leer.
              DAY_MARK[state],
            )}
          />
          {words[state]}
        </li>
      ))}
    </ul>
  )
}

export function CoverageStrip({
  cells,
  granularity,
  emptyHint,
  ariaLabel,
  className,
}: CoverageStripProps) {
  if (cells.length === 0) {
    return emptyHint ? (
      <p className={cn('text-sm text-muted-foreground', className)}>{emptyHint}</p>
    ) : null
  }

  if (granularity === 'month') {
    return (
      <div className={cn('min-w-0', className)}>
        {ariaLabel ? <p className="sr-only">{ariaLabel}</p> : null}
        <ChartTip scrub={false}>
          <ul className="flex gap-1">
            {cells.map((cell) => {
              const tip = tipOf(cell.title)
              const classes = cn(
                'flex h-8 w-full items-center justify-center rounded-md text-[11px] font-medium leading-none',
                MONTH_MARK[cell.state],
              )
              return (
                <li key={cell.key} className="min-w-0 flex-1">
                  {cell.href ? (
                    <Link
                      href={cell.href}
                      prefetch={false}
                      aria-label={`${cell.title}. Abre ese archivo`}
                      data-tip-title={tip.title}
                      data-tip-value={tip.value}
                      data-tip-sub="Tocá para abrir el archivo"
                      style={hatchOf(cell.state)}
                      className={cn(
                        classes,
                        'outline-none transition-[filter] duration-(--duration-fast) hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card motion-reduce:transition-none',
                      )}
                    >
                      <MonthLabel cell={cell} />
                    </Link>
                  ) : (
                    <span
                      title={cell.title}
                      data-tip-title={tip.title}
                      data-tip-value={tip.value}
                      style={hatchOf(cell.state)}
                      className={classes}
                    >
                      <span aria-hidden className="contents">
                        <MonthLabel cell={cell} />
                      </span>
                      <span className="sr-only">{cell.title}</span>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </ChartTip>
        <StripLegend cells={cells} granularity="month" />
      </div>
    )
  }

  const last = cells.length - 1
  const hasTicks = cells.some((c) => c.tick)
  return (
    <div className={cn('min-w-0', className)}>
      <ChartTip>
        <div role="img" aria-label={ariaLabel ?? 'Días subidos y días que faltan'}>
          <div className="flex gap-[2px]">
            {cells.map((cell) => {
              const tip = tipOf(cell.title)
              return (
                <span
                  key={cell.key}
                  data-tip-title={tip.title}
                  data-tip-value={tip.value}
                  style={hatchOf(cell.state)}
                  className={cn('h-4 min-w-0 flex-1 rounded-[3px]', DAY_MARK[cell.state])}
                />
              )
            })}
          </div>
          {hasTicks ? (
            <div aria-hidden className="mt-1.5 flex gap-[2px]">
              {cells.map((cell, index) => (
                <span key={cell.key} className="relative h-3.5 min-w-0 flex-1">
                  {cell.tick ? (
                    <span
                      className={cn(
                        'absolute top-0 whitespace-nowrap text-[11px] leading-none tabular-nums text-muted-foreground',
                        // «hoy» es el rótulo del anillo: va en tinta, como él.
                        cell.state === 'today' && 'font-medium text-foreground',
                        // El primero y los del final no se salen de la tira.
                        index <= 1
                          ? 'left-0'
                          : index >= last - 2
                            ? 'right-0'
                            : 'left-1/2 -translate-x-1/2',
                      )}
                    >
                      {cell.tick}
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </ChartTip>
      <StripLegend cells={cells} granularity="day" />
    </div>
  )
}

/**
 * Lo mismo que la tira, como tabla: una fila por día o por mes con su estado.
 * Es la versión «para leer» (un lector de pantalla, un test, quien quiera el
 * detalle); las bandejas ya dicen la conclusión en palabras.
 */
export function CoverageStripTable({
  cells,
  caption,
  className,
}: {
  cells: readonly CoverageCell[]
  caption: string
  className?: string
}) {
  if (cells.length === 0) return null
  return (
    <table className={cn('w-full text-sm', className)}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th scope="col" className="py-1 pr-3 font-medium">
            Cuándo
          </th>
          <th scope="col" className="py-1 font-medium">
            Cómo está
          </th>
        </tr>
      </thead>
      <tbody>
        {cells.map((cell) => {
          const tip = tipOf(cell.title)
          return (
            <tr key={cell.key} className="border-t border-border/60">
              <th scope="row" className="py-1 pr-3 text-left font-normal tabular-nums">
                {tip.title}
              </th>
              <td className="py-1">{tip.value ?? '—'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
