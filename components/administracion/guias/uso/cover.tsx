import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  Planilla,
  PlanillaTitle,
  PRow,
  PTable,
  PTd,
  PTh,
} from '@/components/administracion/planilla'
import { Button } from '@/components/ui/button'
import {
  GUIDE_EVERYWHERE,
  GUIDE_GLOSSARY,
  GUIDE_PATHS,
  GUIDE_RECIPES,
  GUIDE_SECTIONS,
  type GuideStatus,
  RECIPE_FREQUENCY_LABEL,
  type RoutineGroup,
  type RoutineRow,
  recipeAnchor,
} from '@/lib/accounting/guides'
import { cn } from '@/lib/utils'

/**
 * La portada de la guía, en planillas: «¿Qué pasó?» (cada situación con dónde se carga y su paso a
 * paso), la rutina con su estado real y, plegado, dónde está cada cosa y las palabras en criollo.
 * Corta a propósito: se viene con una duda, no a leerla entera. Server-safe: todo son links.
 */

const LINK =
  'rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

/** «¿Qué pasó?»: las recetas, cada una con dónde se carga y su paso a paso. */
export function RecipeTable({ base }: { base: string }) {
  return (
    <Planilla>
      <PlanillaTitle title="¿Qué pasó?" />
      <PTable label="Cada situación y dónde se carga" minWidth={560}>
        <thead>
          <tr>
            <PTh>Situación</PTh>
            <PTh>Dónde</PTh>
            <PTh>Cuándo</PTh>
            <PTh>
              <span className="sr-only">Ver cómo</span>
            </PTh>
          </tr>
        </thead>
        <tbody>
          {GUIDE_RECIPES.map((recipe) => (
            <PRow key={recipe.id}>
              <PTd>
                <span className="font-medium">{recipe.title}</span>
                <span className="block text-xs text-muted-foreground text-pretty">
                  {recipe.hint}
                </span>
              </PTd>
              <PTd className="text-muted-foreground">{recipe.where}</PTd>
              <PTd className="whitespace-nowrap text-muted-foreground">
                {RECIPE_FREQUENCY_LABEL[recipe.frequency]}
              </PTd>
              <PTd align="right">
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={`${base}${GUIDE_PATHS.daily}#${recipeAnchor(recipe.id)}`}
                    aria-label={`Ver cómo: ${recipe.title}`}
                  >
                    Ver
                  </Link>
                </Button>
              </PTd>
            </PRow>
          ))}
        </tbody>
      </PTable>
    </Planilla>
  )
}

function routineHref(base: string, row: RoutineRow): string {
  return row.link.kind === 'recipe'
    ? `${base}${GUIDE_PATHS.daily}#${recipeAnchor(row.link.recipe)}`
    : `${base}${row.link.path}`
}

/** El estado en palabras, con el color que corresponde (nunca el color solo). */
function RoutineStatus({ status }: { status: GuideStatus | null }) {
  if (!status) return <span className="text-muted-foreground">Cuando pasa</span>
  return (
    <span
      className={cn(
        'text-pretty',
        status.state === 'done' && 'text-success',
        status.state === 'todo' && 'font-medium text-warning-text',
        status.state === 'idle' && 'text-muted-foreground',
      )}
    >
      {status.text}
    </span>
  )
}

/** «Tu rutina»: qué conviene hacer cada día, cada semana y cada mes, y cómo venís. */
export function RoutineTable({
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
    <section id="rutina" className="scroll-mt-24">
      <Planilla>
        <PlanillaTitle title="Tu rutina" />
        {note ? <div className="px-3 pt-2 text-sm text-muted-foreground">{note}</div> : null}
        <PTable label="Tu rutina y cómo venís" minWidth={480}>
          <thead>
            <tr>
              <PTh>Cuándo</PTh>
              <PTh>Qué</PTh>
              <PTh>Cómo venís</PTh>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((group) =>
              group.rows.map((row, index) => (
                <PRow key={row.key}>
                  <PTd className="whitespace-nowrap text-muted-foreground">
                    {index === 0 ? group.title : null}
                  </PTd>
                  <PTd>
                    <Link href={routineHref(base, row)} className={LINK}>
                      {row.title}
                    </Link>
                  </PTd>
                  <PTd>
                    <RoutineStatus status={row.status} />
                  </PTd>
                </PRow>
              )),
            )}
          </tbody>
        </PTable>
      </Planilla>
    </section>
  )
}

/** Lo de consulta: plegado, para que la portada sea corta. */
export function GuideFold({
  id,
  title,
  children,
}: {
  id?: string
  title: string
  children: ReactNode
}) {
  return (
    <details
      id={id}
      className="group/fold scroll-mt-24 overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:pointer-fine:min-h-9 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          aria-hidden
          className="size-4 text-muted-foreground transition-transform group-open/fold:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="border-t border-border/70">{children}</div>
    </details>
  )
}

/** Dónde está cada cosa: las seis secciones, el engranaje y lo que se hace desde cualquier lado. */
export function SectionsTable({ base }: { base: string }) {
  return (
    <PTable label="Las secciones de Administración" minWidth={480}>
      <thead>
        <tr>
          <PTh>Sección</PTh>
          <PTh>Qué hay</PTh>
        </tr>
      </thead>
      <tbody>
        {GUIDE_SECTIONS.map((section) => (
          <PRow key={section.key}>
            <PTd className="font-medium whitespace-nowrap">
              <Link href={`${base}${section.path}`} className={LINK}>
                {section.title}
              </Link>
            </PTd>
            <PTd>
              <span className="text-pretty">{section.what}</span>
              {section.tabs.length > 0 ? (
                <span className="block text-xs text-muted-foreground text-pretty">
                  {section.tabs.join(' · ')}
                </span>
              ) : null}
            </PTd>
          </PRow>
        ))}
        {GUIDE_EVERYWHERE.map((item) => (
          <PRow key={item.title}>
            <PTd className="font-medium whitespace-nowrap">{item.title}</PTd>
            <PTd className="text-pretty">{item.what}</PTd>
          </PRow>
        ))}
      </tbody>
    </PTable>
  )
}

/** El glosario único: la idea como la decimos acá y, debajo y en gris, el nombre de contadora. */
export function GuideGlossary() {
  return (
    <GuideFold id="glosario" title="Las palabras, en criollo">
      <dl className="grid gap-x-8 gap-y-3 px-3 py-3 sm:grid-cols-2 xl:grid-cols-3">
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
            <dd className="mt-0.5 text-sm text-muted-foreground text-pretty">{entry.meaning}</dd>
          </div>
        ))}
      </dl>
    </GuideFold>
  )
}
