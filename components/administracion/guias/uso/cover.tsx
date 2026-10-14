import {
  ArrowRight,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ActionTile } from '@/components/administracion/kit/action-tile'
import { Panel } from '@/components/administracion/kit/panel'
import {
  GUIDE_GLOSSARY,
  GUIDE_PATHS,
  GUIDE_RECIPES,
  type GuideStatus,
  linkAnchor,
  PAPER_IDS,
  PAPERS_ANCHOR,
  type RoutineGroup,
  type RoutineRow,
  recipeAnchor,
} from '@/lib/accounting/guides'
import { cn } from '@/lib/utils'
import { RECIPE_ICON } from './guide-icons'
import { MobileFold } from './mobile-fold'
import { LinkArt, PaperArt } from './station-art'

/**
 * Los bloques de la portada de la guía que van debajo del mapa: las recetas por situación
 * («¿Qué pasó?»), los dos accesos grandes, la rutina con su estado real y el glosario.
 * Server-safe: todo son links.
 */

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** «¿Qué pasó?»: las doce recetas, cada una lleva a su paso a paso. */
export function RecipeTiles({ base }: { base: string }) {
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {GUIDE_RECIPES.map((recipe) => (
        <li key={recipe.id} className="flex">
          <ActionTile
            icon={RECIPE_ICON[recipe.id]}
            title={recipe.title}
            hint={recipe.hint}
            href={`${base}${GUIDE_PATHS.daily}#${recipeAnchor(recipe.id)}`}
            className="w-full"
          />
        </li>
      ))}
    </ul>
  )
}

type BigQuestion = { text: string; href: string }

/**
 * Un tema con su página: el dibujo, el título (que lleva a la página) y las preguntas que
 * contesta, cada una directo a su parte. Las preguntas llenan la tarjeta, que queda del alto de
 * «Tu rutina», y ahorran un paso: nadie entra a «ver» una guía, entra con una duda.
 */
function BigLink({
  href,
  title,
  children,
  art,
  questions,
}: {
  href: string
  title: string
  children: ReactNode
  art: ReactNode
  questions: readonly BigQuestion[]
}) {
  return (
    <article className="card-hairline flex h-full flex-col rounded-2xl border bg-card p-5 shadow-xs">
      <div aria-hidden className="flex h-16 items-end gap-2">
        {art}
      </div>
      <h3 className="mt-4 font-serif text-xl leading-tight font-semibold tracking-tight text-balance">
        <Link
          href={href}
          className={cn(
            'group inline-flex items-center gap-1.5 rounded-sm decoration-border underline-offset-4 hover:underline',
            FOCUS,
          )}
        >
          {title}
          <ArrowRight
            aria-hidden
            className="size-4 shrink-0 text-primary transition-[translate] duration-(--duration-fast) ease-(--ease-out) group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        </Link>
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground text-pretty">{children}</p>
      <div className="mt-auto pt-4">
        <ul className="-mx-2 border-t border-border/60 pt-2">
          {questions.map((question) => (
            <li key={question.href}>
              <Link
                href={question.href}
                className={cn(
                  'group flex min-h-9 items-center gap-2 rounded-xl px-2 py-1.5 text-sm transition-colors hover:bg-cream-tint pointer-coarse:min-h-11',
                  FOCUS,
                )}
              >
                <span className="min-w-0 flex-1 text-pretty">{question.text}</span>
                <ChevronRight
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground/70 group-hover:text-foreground"
                />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}

/** Los dos temas que más confunden, cada uno con su página y las dudas con las que se llega. */
export function BigLinks({ base }: { base: string }) {
  const invoice = `${base}${GUIDE_PATHS.invoice}`
  const links = `${base}${GUIDE_PATHS.links}`
  return (
    <>
      <BigLink
        href={invoice}
        title="Con factura y sin factura"
        art={PAPER_IDS.map((id) => <PaperArt key={id} id={id} className="h-14" />)}
        questions={[
          { text: '¿Recupero el IVA con un tique?', href: `${invoice}#${PAPERS_ANCHOR.papers}` },
          { text: '¿Dónde cargo un remito?', href: `${invoice}#${PAPERS_ANCHOR.cases}` },
          { text: '¿Y lo que vendí sin factura?', href: `${invoice}#${PAPERS_ANCHOR.sales}` },
        ]}
      >
        Los cuatro papeles que te pueden dar y qué cambia con cada uno. Todo queda en el mismo
        libro.
      </BigLink>
      <BigLink
        href={links}
        title="Cómo se vincula cada cosa"
        art={<LinkArt className="h-12" />}
        questions={[
          {
            text: '¿Cómo uno una compra con su pago?',
            href: `${links}#${linkAnchor('compra-pago')}`,
          },
          {
            text: '¿Y un gasto con su gasto fijo?',
            href: `${links}#${linkAnchor('gasto-fijo')}`,
          },
          {
            text: '¿Y lo que subí de ARCA con lo que cargué a mano?',
            href: `${links}#${linkAnchor('importado')}`,
          },
        ]}
      >
        La compra con su pago, el gasto con su gasto fijo, lo importado con lo que cargaste a mano.
        Y lo que hoy todavía no se puede.
      </BigLink>
    </>
  )
}

function RoutineMark({ status }: { status: GuideStatus | null }) {
  const className = 'mt-0.5 size-4 shrink-0'
  // Sin estado igual lleva su círculo, y se tiene que ver también en oscuro.
  if (!status) return <Circle aria-hidden className={cn(className, 'text-muted-foreground/50')} />
  if (status.state === 'done') {
    return <CircleCheck aria-hidden className={cn(className, 'text-success')} />
  }
  if (status.state === 'todo') {
    return <CircleDot aria-hidden className={cn(className, 'text-warning')} />
  }
  return <CircleDashed aria-hidden className={cn(className, 'text-muted-foreground')} />
}

function routineHref(base: string, row: RoutineRow): string {
  return row.link.kind === 'recipe'
    ? `${base}${GUIDE_PATHS.daily}#${recipeAnchor(row.link.recipe)}`
    : `${base}${row.link.path}`
}

/** «Tu rutina»: qué conviene hacer cada día, cada semana y cada mes, y cómo venís. */
export function RoutinePanel({
  base,
  groups,
  note,
}: {
  base: string
  groups: readonly RoutineGroup[]
  /** Si no se pudo leer el estado: la rutina se ve igual, sin marcas. */
  note?: ReactNode
}) {
  return (
    <Panel
      id="rutina"
      title="Tu rutina"
      description="Lo de cada día, cada semana y cada mes. Se marca sola con lo que vas cargando."
      // Las tres columnas dependen del ancho del PANEL (al lado de los accesos queda angosto).
      className="@container h-full"
    >
      {note ? <div className="mb-4 text-sm text-muted-foreground">{note}</div> : null}
      <div className="grid gap-x-6 gap-y-6 @[40rem]:grid-cols-3">
        {groups.map((group) => (
          <section
            key={group.frequency}
            className="min-w-0 border-border/60 @[40rem]:border-l @[40rem]:pl-6 @[40rem]:first:border-l-0 @[40rem]:first:pl-0"
          >
            <h3 className="text-sm font-semibold">{group.title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{group.hint}</p>
            <ul className="mt-2 -mx-2">
              {group.rows.map((row) => (
                <li key={row.key}>
                  <Link
                    href={routineHref(base, row)}
                    className={cn(
                      'group flex min-h-11 items-start gap-2 rounded-xl px-2 py-2 transition-colors hover:bg-cream-tint',
                      FOCUS,
                    )}
                  >
                    <RoutineMark status={row.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-snug text-pretty">{row.title}</span>
                      {row.status ? (
                        <span
                          className={cn(
                            'mt-0.5 block text-xs text-pretty',
                            row.status.state === 'done' && 'text-success',
                            row.status.state === 'todo' && 'font-medium text-warning-text',
                            row.status.state === 'idle' && 'text-muted-foreground',
                          )}
                        >
                          {row.status.text}
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground/70 group-hover:text-foreground"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Panel>
  )
}

/**
 * El glosario único: la idea como la decimos acá y, debajo y en gris, el nombre de contadora.
 * Es de consulta: en el celular viene plegado, para que no sean dos pantallas de palabras antes
 * del final de la portada.
 */
export function GuideGlossary() {
  return (
    <Panel
      id="glosario"
      title="Las palabras, en criollo"
      description="Primero la idea, como la decimos acá. En gris, cómo le dicen los contadores."
    >
      <MobileFold label={`Ver las ${GUIDE_GLOSSARY.length} palabras`}>
        <dl className="grid gap-x-8 gap-y-4 max-sm:pt-3 sm:grid-cols-2 xl:grid-cols-3">
          {GUIDE_GLOSSARY.map((entry) => (
            <div key={entry.idea} className="min-w-0">
              <dt className="text-sm leading-snug font-medium">
                {entry.idea}
                {entry.name ? (
                  <span className="block text-xs font-normal text-muted-foreground">
                    <span className="sr-only">Para los contadores: </span>
                    {entry.name}
                  </span>
                ) : null}
              </dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground text-pretty">
                {entry.meaning}
              </dd>
            </div>
          ))}
        </dl>
      </MobileFold>
    </Panel>
  )
}
