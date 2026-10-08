import { Sparkles } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ACTION_TITLES } from '@/components/administracion/acciones/types'
import {
  ONBOARDING_GLOSSARY,
  ONBOARDING_STAYS_MANUAL,
  PLATFORM_DOES,
} from '@/lib/accounting/onboarding'
import { cn } from '@/lib/utils'
import { SheetButton } from './sheet-button'

/**
 * Los pies de «Cómo arrancar» (diseño §4.5 y §5.2.1): lo que se sigue
 * cargando a mano (y por qué), lo que la plataforma hace sola y las palabras
 * de ARCA y de contabilidad en palabras simples. Server-safe.
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
        <p className="text-xs text-muted-foreground text-pretty">{description}</p>
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
      <ul className="divide-y divide-border/60">
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
                    className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
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
                  {ACTION_TITLES[task.sheet]}
                </SheetButton>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
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
      <ul className="space-y-3 px-5 py-4">
        {PLATFORM_DOES.map((text) => (
          <li key={text} className="flex items-start gap-2.5 text-sm">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="text-pretty">{text}</span>
          </li>
        ))}
      </ul>
    </GuideCard>
  )
}

/** «Palabras que vas a ver»: cada término de ARCA o de contabilidad, en criollo. */
export function GlossaryCard({ className }: { className?: string }) {
  return (
    <GuideCard
      id="arranque-palabras"
      title="Palabras que vas a ver"
      description="Lo que quiere decir cada una, sin vueltas."
      className={className}
    >
      <dl className="grid gap-x-8 gap-y-4 px-5 py-4 sm:grid-cols-2">
        {ONBOARDING_GLOSSARY.map((entry) => (
          <div key={entry.term} className="space-y-0.5">
            <dt className="text-sm font-medium text-foreground">{entry.term}</dt>
            <dd className="text-sm text-muted-foreground text-pretty">{entry.meaning}</dd>
          </div>
        ))}
      </dl>
    </GuideCard>
  )
}
