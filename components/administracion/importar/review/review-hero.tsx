import Link from 'next/link'
import { HeroPanel, type ViewPillItem, ViewPills } from '@/components/administracion/kit'
import type { ReviewFilter } from '@/lib/imports/ui/filters'
import { REVIEW_FILTER_COPY } from '@/lib/imports/ui/filters'
import type { ReviewHeroCopy, ReviewTally, RouteStep } from '@/lib/imports/ui/review-copy'
import { cn } from '@/lib/utils'
import { PaperPile, PILE_ICONS, pileIsFew } from './paper-pile'

/**
 * El contador de una píldora, en la letra de la pantalla: la de máquina queda
 * para el papel (ahí el «0» sale tachado y parece un error).
 */
export function PillCount({ n }: { n: number }) {
  return <span className="font-sans">{n}</span>
}

/**
 * Lo de arriba de la revisión: a la izquierda, EL número que cambia con la
 * tarea (te falta contestar → listos para cargar → cargados) con su oración; a
 * la derecha, la pila del archivo dibujada hoja por hoja y, debajo, las vistas.
 *
 * Reemplaza a las cuatro tarjetas que no sumaban («Cargados 18 de 23» contaba
 * en el 23 lo que no se carga) y a las cinco pestañas subrayadas. Las píldoras
 * de las vistas llevan la misma hojita de la pila: la leyenda es el filtro. Las
 * que están en cero se ven apagadas y no se pueden tocar.
 *
 * En el celular, con pocas hojas la pila va al lado del número (chica, contra el
 * borde): así la pregunta de abajo entra en la primera pantalla. Con muchas, va
 * debajo de la oración, a todo el ancho.
 *
 * Server-safe: las palabras llegan armadas (`reviewHero()`).
 */
export function ReviewHero({
  hero,
  tally,
  unit,
  active,
  counts,
  hrefFor,
}: {
  hero: ReviewHeroCopy
  tally: ReviewTally
  /** «comprobantes» / «movimientos». */
  unit: string
  /** La vista que se está viendo. */
  active: ReviewFilter
  counts: Readonly<Record<ReviewFilter, number>>
  hrefFor: (query: Record<string, string | number | null>) => string
}) {
  const view = (key: ReviewFilter, icon?: ViewPillItem['icon']): ViewPillItem => ({
    key,
    label: REVIEW_FILTER_COPY[key].label,
    shortLabel: REVIEW_FILTER_COPY[key].shortLabel,
    href: hrefFor({ ver: key }),
    icon,
    count: <PillCount n={counts[key]} />,
    active: active === key,
    // Una vista en cero no lleva a nada (salvo que ya se esté parado ahí).
    disabled: counts[key] === 0 && active !== key,
    scroll: false,
    ariaLabel: `${REVIEW_FILTER_COPY[key].label}: ${counts[key]}`,
  })
  const numeric = /^\d/.test(hero.value)
  const hasPile = tally.total > 0
  const beside = hasPile && pileIsFew(tally)

  return (
    <HeroPanel
      tone="crema"
      className={cn(
        'grid gap-x-4 gap-y-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-x-8',
        beside ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)]',
      )}
    >
      <div
        className={cn(
          'min-w-0 lg:col-start-1 lg:col-end-2 lg:row-start-1',
          beside && 'col-start-1 row-start-1',
        )}
      >
        {/* La etiqueta ya dice el estado («Cargados»): no lleva una píldora que lo repita. */}
        {hero.label ? (
          <p className="mb-2 text-[11px] font-medium uppercase leading-snug tracking-[0.18em] text-muted-foreground">
            {hero.label}
          </p>
        ) : null}
        <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 font-serif font-semibold leading-none tracking-tight">
          <span className={numeric ? 'text-5xl sm:text-6xl' : 'text-3xl sm:text-4xl'}>
            {hero.value}
          </span>
          {hero.unit ? (
            <span className="font-sans text-base font-medium tracking-normal text-muted-foreground">
              {hero.unit}
            </span>
          ) : null}
        </p>
      </div>
      <p
        className={cn(
          'max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty lg:col-start-1 lg:col-end-2 lg:row-start-2',
          beside && 'col-span-2 row-start-2',
        )}
      >
        {hero.sentence}
      </p>

      {hasPile ? (
        <>
          <PaperPile
            tally={tally}
            unit={unit}
            beside={beside}
            className={cn(
              'min-w-0 lg:col-start-2 lg:col-end-3 lg:row-start-1 lg:w-auto lg:self-end',
              // Ocho hojitas por renglón (8 × 14 px + 7 × 3 px = 133 px): 23 comprobantes son
              // tres renglones al lado del número, y 8 movimientos, uno solo (no 7 + 1 suelta).
              beside && 'col-start-2 row-start-1 w-[8.4rem]',
            )}
          />
          <ViewPills
            label="Qué ver de este archivo"
            className={cn(
              'min-w-0 lg:col-start-2 lg:col-end-3 lg:row-start-2',
              beside && 'col-span-2 row-start-3',
            )}
            items={[
              view('revisar', PILE_ICONS.questions),
              view('listas', PILE_ICONS.ready),
              view('cargadas', PILE_ICONS.posted),
              view(
                'no-se-cargan',
                tally.already > 0 || tally.out === 0 ? PILE_ICONS.already : PILE_ICONS.out,
              ),
              view('todos'),
              // Un archivo del que no queda nada para cargar ni se cargó nada: tres vistas en
              // cero («Con una pregunta 0 · Listos 0 · Cargados 0») no enseñan nada.
            ].filter((item) => hero.stage !== 'nothing' || !item.disabled)}
          />
        </>
      ) : null}
    </HeroPanel>
  )
}

/**
 * La ruta: en qué orden conviene hacer lo que falta («① ¿Los tenés de antes? 14
 * — ② Contestá lo que te pregunto 3 — ③ Cargá 18»). Cada paso lleva a su lugar
 * de la pantalla. El primero es el que toca (número relleno); los demás esperan.
 *
 * Se dibuja como pasos (número, texto y una raya que los une), no como píldoras:
 * arriba tiene las píldoras de las vistas y abajo las de los filtros, y tres
 * filas iguales no dejaban ver qué era paso y qué era filtro.
 *
 * Solo se monta con dos o más cosas por hacer (`routeSteps()`), y solo para
 * quien puede cargar. En el celular no va (lo decide quien la usa, con
 * `className`): ahí el número de arriba ya dice qué falta y cada renglón que se
 * saca deja ver antes la pregunta.
 */
export function ReviewRoute({
  steps,
  className,
}: {
  steps: readonly RouteStep[]
  className?: string
}) {
  if (steps.length < 2) return null
  return (
    <nav aria-label="En qué orden" className={className}>
      <ol className="flex flex-wrap items-center gap-y-1">
        {steps.map((step, index) => (
          <li
            key={step.key}
            aria-current={index === 0 ? 'step' : undefined}
            className="flex items-center"
          >
            {/* La raya va con el paso que sigue: si la fila se parte, no queda colgando al final. */}
            {index > 0 ? <span aria-hidden className="mx-3 h-px w-6 bg-border sm:w-8" /> : null}
            <Link
              href={step.href}
              className={cn(
                'group/route inline-flex min-h-11 items-center gap-2 rounded-md text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:min-h-9',
                index === 0 ? 'font-medium' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                  index === 0
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-card text-muted-foreground',
                )}
              >
                {index + 1}
              </span>
              <span className="underline-offset-4 group-hover/route:underline">
                <span className="sr-only">Paso {index + 1}: </span>
                {step.title}
              </span>
              {step.count > 0 ? (
                <span className="rounded-full bg-secondary px-1.5 py-px text-[11px] font-medium tabular-nums text-foreground">
                  {step.count}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  )
}
