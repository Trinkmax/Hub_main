import { Hand, Info, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { Fragment } from 'react'
import { Panel } from '@/components/administracion/kit/panel'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import {
  GUIDE_LINKS,
  GUIDE_PATHS,
  type GuideLink,
  guideRecipe,
  linkAnchor,
  recipeAnchor,
} from '@/lib/accounting/guides'
import { cn } from '@/lib/utils'
import { MobileFold } from './mobile-fold'

/**
 * «Cómo se vincula cada cosa»: arriba, el dibujo de los nueve vínculos (qué se une con qué, si se
 * une solo o lo unís vos, y cuáles tienen un límite); abajo, cada uno con sus cuatro datos: qué
 * es, dónde se hace, qué pasa si no y cómo se deshace.
 *
 * Dice con honestidad lo que hoy NO se puede (vincular después un gasto fijo, elegir «es este» en
 * una línea importada): es peor prometerlo que avisarlo.
 *
 * Al tocar una unión del dibujo, su bloque queda resaltado (`:target`, sin script): son nueve
 * bloques con la misma forma y sin la marca no se sabía en cuál se había caído. En el celular
 * cada bloque muestra «Qué es» y el límite; lo demás se abre (`MobileFold`).
 */

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const HOW_TEXT = { auto: 'Se une solo', you: 'Lo unís vos' } as const
const HOW_ICON = { auto: Sparkles, you: Hand } as const

/** «Proveedor ↔ su categoría de siempre»: el nombre del vínculo, con sus puntas. */
function linkTitle(link: GuideLink): string {
  return link.ends
    .map((end, index) => (index === 0 ? end : end.charAt(0).toLowerCase() + end.slice(1)))
    .join(' ↔ ')
}

/** La línea entre dos cosas: entera si se une solo, de a rayitas si lo unís vos. */
function Wire({ how }: { how: GuideLink['how'] }) {
  return (
    <span
      aria-hidden
      className={cn(
        'h-0 min-w-5 flex-1 border-t-2',
        how === 'auto' ? 'border-adm-s1' : 'border-dashed border-foreground/45',
      )}
    />
  )
}

function Ends({ link }: { link: GuideLink }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {link.ends.map((end, index) => (
        <Fragment key={end}>
          {index > 0 ? <Wire how={link.how} /> : null}
          <span className="inline-flex min-h-9 min-w-0 items-center rounded-xl border border-border/80 bg-card px-2.5 py-1 text-[13px] leading-tight font-medium text-pretty shadow-2xs">
            {end}
          </span>
        </Fragment>
      ))}
    </span>
  )
}

/** El dibujo: los nueve vínculos de un vistazo. Cada renglón baja a su explicación. */
export function LinksMap() {
  const total = GUIDE_LINKS.length
  const auto = GUIDE_LINKS.filter((link) => link.how === 'auto').length
  return (
    <Panel
      title={`Son ${total} uniones: ${auto} se hacen solas y ${total - auto} las hacés vos`}
      description="Tocá una para ver dónde se hace, qué pasa si no y cómo se deshace."
      action={
        <ul
          aria-label="Cómo leer las líneas"
          className="hidden items-center gap-4 text-xs text-muted-foreground sm:flex"
        >
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="w-6 border-t-2 border-adm-s1" />
            {HOW_TEXT.auto}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="w-6 border-t-2 border-dashed border-foreground/45" />
            {HOW_TEXT.you}
          </li>
        </ul>
      }
    >
      <ol className="-mx-2">
        {GUIDE_LINKS.map((link) => (
          <li key={link.id}>
            <a
              href={`#${linkAnchor(link.id)}`}
              className={cn(
                'grid gap-x-5 gap-y-1.5 rounded-xl px-2 py-2.5 transition-colors hover:bg-cream-tint sm:grid-cols-[minmax(0,1fr)_22rem] sm:items-center',
                FOCUS,
              )}
            >
              <Ends link={link} />
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                <span className="font-medium text-foreground">{HOW_TEXT[link.how]}</span>
                <span>{link.when}</span>
                {link.limit ? <StatusPill tone="info">Con un límite</StatusPill> : null}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

const FACTS = [
  { key: 'what', label: 'Qué es' },
  { key: 'where', label: 'Dónde se hace' },
  { key: 'ifNot', label: 'Qué pasa si no' },
  { key: 'undo', label: 'Cómo se deshace' },
] as const

const [WHAT, ...MORE] = FACTS

function Fact({ label, children }: { label: string; children: string }) {
  return (
    <div className="min-w-0">
      <h4 className="text-[13px] font-semibold">{label}</h4>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground text-pretty">{children}</p>
    </div>
  )
}

function LinkDetail({ link, base }: { link: GuideLink; base: string }) {
  const titleId = `${linkAnchor(link.id)}-nombre`
  const recipe = link.recipe ? guideRecipe(link.recipe) : null
  return (
    <section
      id={linkAnchor(link.id)}
      aria-labelledby={titleId}
      // El margen negativo le da lugar al resaltado sin correr el texto de la columna.
      className="-mx-3 grid scroll-mt-20 gap-x-8 gap-y-4 border-t border-border/60 px-3 py-5 first:border-t-0 target:rounded-xl target:border-transparent target:bg-cream-tint target:ring-1 target:ring-primary/30 lg:grid-cols-[17rem_minmax(0,1fr)]"
    >
      <div className="min-w-0">
        <h3
          id={titleId}
          className="font-serif text-lg leading-snug font-semibold tracking-tight text-balance"
        >
          {linkTitle(link)}
        </h3>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
          <StatusPill tone="muted" icon={HOW_ICON[link.how]}>
            {HOW_TEXT[link.how]}
          </StatusPill>
          {link.when}
        </p>
        {recipe ? (
          <p className="mt-2.5 text-sm">
            <Link
              href={`${base}${GUIDE_PATHS.daily}#${recipeAnchor(recipe.id)}`}
              className={cn(
                'inline-flex min-h-9 items-center rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground pointer-coarse:min-h-11',
                FOCUS,
              )}
            >
              Paso a paso: {recipe.title}
            </Link>
          </p>
        ) : null}
      </div>
      {/* En la compu, los cuatro datos en dos columnas y el límite debajo. En el celular: qué es,
          el límite, y los otros tres datos plegados (mismo contenido, otro orden). */}
      <div className="grid min-w-0 gap-x-8 gap-y-4 sm:grid-cols-2">
        <Fact label={WHAT.label}>{link[WHAT.key]}</Fact>
        {link.limit ? (
          <div className="flex items-start gap-2.5 rounded-xl bg-secondary/50 px-3.5 py-3 text-sm leading-relaxed sm:order-last sm:col-span-2">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
            <p className="min-w-0 text-pretty">
              <span className="sr-only">Un límite: </span>
              {link.limit}
            </p>
          </div>
        ) : null}
        <MobileFold
          label="Dónde se hace, qué pasa si no y cómo se deshace"
          contentClassName="max-sm:space-y-4 max-sm:pt-2"
        >
          {MORE.map((fact) => (
            <Fact key={fact.key} label={fact.label}>
              {link[fact.key]}
            </Fact>
          ))}
        </MobileFold>
      </div>
    </section>
  )
}

/** Cada vínculo con sus cuatro datos, uno debajo del otro. */
export function LinksDetail({ base }: { base: string }) {
  return (
    <Panel
      title="Cada unión, con sus cuatro datos"
      description="Qué es, dónde se hace, qué pasa si no la hacés y cómo se deshace."
    >
      {GUIDE_LINKS.map((link) => (
        <LinkDetail key={link.id} link={link} base={base} />
      ))}
    </Panel>
  )
}
