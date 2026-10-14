import { ArrowRight, Sparkles } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ACTION_TITLES } from '@/components/administracion/acciones/types'
import { ONBOARDING_STAYS_MANUAL, PLATFORM_DOES } from '@/lib/accounting/onboarding'
import { cn } from '@/lib/utils'
import { MobileFold } from '../uso/mobile-fold'
import { SheetButton } from './sheet-button'

/**
 * Los pies de «Cómo arrancar» (diseño §4.5 y §5.2.1): lo que se sigue
 * cargando a mano (y por qué), lo que la plataforma hace sola y el link a las
 * palabras en criollo. Server-safe; lo plegable del celular es una isla
 * (`MobileFold`).
 *
 * Son de consulta: en el celular cada tarjeta muestra su título y su bajada, y
 * la lista se abre con un toque (en la compu se ve siempre). Así la página no
 * suma tres pantallas de lectura debajo de lo que falta hacer.
 */

function GuideCard({
  id,
  title,
  description,
  className,
  children,
}: {
  id: string
  title: string
  description: string
  className?: string
  children: ReactNode
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn('card-hairline overflow-hidden rounded-xl border bg-card', className)}
    >
      <header className="space-y-0.5 border-b border-border/60 px-5 py-4">
        <h2 id={id} className="font-serif text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground text-pretty">{description}</p>
      </header>
      {children}
    </section>
  )
}

/** «Lo que sigue siendo a mano»: qué, dónde y por qué todavía no se trae solo. */
export function StaysManualCard({ base, className }: { base: string; className?: string }) {
  return (
    <GuideCard
      id="arranque-a-mano"
      title="Lo que sigue siendo a mano"
      description="Lo que todavía no se puede traer solo, dónde se carga y por qué."
      className={className}
    >
      <MobileFold
        label={`Ver las ${ONBOARDING_STAYS_MANUAL.length} cosas`}
        className="px-5 py-1"
        contentClassName="max-sm:-mx-5"
      >
        <ul className="divide-y divide-border/60 max-sm:border-t max-sm:border-border/60">
          {ONBOARDING_STAYS_MANUAL.map((task) => (
            <li key={task.title} className="space-y-1.5 px-5 py-4">
              <p className="text-sm font-medium text-foreground">{task.title}</p>
              <p className="text-sm text-muted-foreground text-pretty">{task.why}</p>
              <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <p className="text-pretty">
                  <span className="font-medium">Dónde: </span>
                  {task.where.path ? (
                    <Link
                      href={`${base}${task.where.path}`}
                      className="rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {task.where.label}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{task.where.label}</span>
                  )}
                </p>
                {task.sheet ? (
                  <SheetButton
                    sheet={task.sheet}
                    variant="outline"
                    className="h-11 w-full sm:w-auto md:h-8"
                    size="sm"
                  >
                    {task.sheetLabel ?? ACTION_TITLES[task.sheet]}
                  </SheetButton>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </MobileFold>
    </GuideCard>
  )
}

/** «Lo que hace la plataforma sola». */
export function PlatformDoesCard({ className }: { className?: string }) {
  return (
    <GuideCard
      id="arranque-sola"
      title="Lo que hace la plataforma sola"
      description="Para que cargues lo menos posible."
      className={className}
    >
      <MobileFold label={`Ver las ${PLATFORM_DOES.length} cosas`} className="px-5 py-1">
        <ul className="space-y-3 px-5 py-4 max-sm:px-0 max-sm:pt-1">
          {PLATFORM_DOES.map((text) => (
            <li key={text} className="flex items-start gap-2.5 text-sm">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="text-pretty">{text}</span>
            </li>
          ))}
        </ul>
      </MobileFold>
    </GuideCard>
  )
}

/**
 * Las palabras de ARCA y de contabilidad: un solo glosario, el de la portada («Las palabras, en
 * criollo», la idea primero). Acá va el link, no una segunda lista que dijera lo mismo de otra
 * manera.
 */
export function GlossaryLink({ base, className }: { base: string; className?: string }) {
  return (
    <p
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl bg-secondary/50 px-4 py-2.5 text-sm sm:px-5',
        className,
      )}
    >
      <span className="min-w-0 flex-1 basis-64 text-pretty">
        <span className="font-medium">¿Una palabra que no entendés?</span>{' '}
        <span className="text-muted-foreground">
          ARCA, CUIT, crédito fiscal, retención: están todas, la idea primero.
        </span>
      </span>
      <Link
        href={`${base}/guias#glosario`}
        className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-sm font-medium whitespace-nowrap text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
      >
        Las palabras, en criollo
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </p>
  )
}
