import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Fragment } from 'react'
import {
  HeroPanel,
  StatusPill,
  type ViewPillItem,
  ViewPills,
} from '@/components/administracion/kit'
import type { ReviewFilter } from '@/lib/imports/ui/filters'
import { REVIEW_FILTER_COPY } from '@/lib/imports/ui/filters'
import type { ReviewHeroCopy, ReviewTally, RouteStep } from '@/lib/imports/ui/review-copy'
import { cn } from '@/lib/utils'
import { PaperPile, PILE_ICONS } from './paper-pile'

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
    count: counts[key],
    active: active === key,
    // Una vista en cero no lleva a nada (salvo que ya se esté parado ahí).
    disabled: counts[key] === 0 && active !== key,
    scroll: false,
    ariaLabel: `${REVIEW_FILTER_COPY[key].label}: ${counts[key]}`,
  })
  const numeric = /^\d/.test(hero.value)

  return (
    <HeroPanel
      tone="crema"
      className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-8"
    >
      <div className="min-w-0">
        {hero.label || hero.stage === 'loaded' ? (
          <div className="mb-2 flex min-h-6 flex-wrap items-center gap-2">
            {hero.label ? (
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {hero.label}
              </p>
            ) : null}
            {hero.stage === 'loaded' ? <StatusPill tone="ok">Cargado</StatusPill> : null}
          </div>
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
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
          {hero.sentence}
        </p>
      </div>

      {tally.total > 0 ? (
        <div className="min-w-0 space-y-4">
          <PaperPile tally={tally} unit={unit} />
          <ViewPills
            label="Qué ver de este archivo"
            items={[
              view('revisar', PILE_ICONS.questions),
              view('listas', PILE_ICONS.ready),
              view('cargadas', PILE_ICONS.posted),
              view(
                'no-se-cargan',
                tally.already > 0 || tally.out === 0 ? PILE_ICONS.already : PILE_ICONS.out,
              ),
              view('todos'),
            ]}
          />
        </div>
      ) : null}
    </HeroPanel>
  )
}

/**
 * La ruta: en qué orden conviene hacer lo que falta («¿Los tenés de antes? · 14
 * → Contestá lo que te pregunto · 3 → Cargá · 18»). Cada paso lleva a su lugar
 * de la pantalla. El primero es el que toca (relleno); los demás esperan.
 *
 * Solo se monta con dos o más cosas por hacer (`routeSteps()`), y solo para
 * quien puede cargar. Es propia de esta pantalla: los pasos van escritos, con su
 * número, porque acá lo que hace falta es leer el orden.
 */
export function ReviewRoute({ steps }: { steps: readonly RouteStep[] }) {
  if (steps.length < 2) return null
  return (
    <nav aria-label="En qué orden">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
        {steps.map((step, index) => (
          <Fragment key={step.key}>
            {index > 0 ? (
              <li aria-hidden className="flex text-muted-foreground">
                <ChevronRight className="size-4" />
              </li>
            ) : null}
            <li aria-current={index === 0 ? 'step' : undefined}>
              <Link
                href={step.href}
                className={cn(
                  'inline-flex h-11 items-center gap-2 rounded-full border pr-3.5 pl-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:h-9',
                  index === 0
                    ? 'border-primary/40 bg-card font-medium shadow-xs'
                    : 'border-border/70 text-muted-foreground hover:bg-cream-tint hover:text-foreground',
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
                <span>
                  <span className="sr-only">Paso {index + 1}: </span>
                  {step.title}
                </span>
                {step.count > 0 ? (
                  <span className="rounded-full bg-secondary px-1.5 py-px font-mono text-[11px] tabular-nums text-foreground">
                    {step.count}
                  </span>
                ) : null}
              </Link>
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  )
}
