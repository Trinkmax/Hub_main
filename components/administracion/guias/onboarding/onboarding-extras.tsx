import { ArrowRight, ChevronDown, Sparkles } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ACTION_TITLES } from '@/components/administracion/acciones/types'
import { ONBOARDING_STAYS_MANUAL, PLATFORM_DOES } from '@/lib/accounting/onboarding'
import { cn } from '@/lib/utils'
import { SheetButton } from './sheet-button'

/**
 * Los pies de la Puesta en marcha (diseño §4.5 y §5.2.1): lo que se sigue cargando a mano (y por
 * qué), lo que la plataforma hace sola y el link a las palabras en criollo. Son de consulta: van
 * plegados, para que la pantalla sea la planilla de pasos. Server-safe.
 */

function FootFold({
  id,
  title,
  className,
  children,
}: {
  id: string
  title: string
  className?: string
  children: ReactNode
}) {
  return (
    <details
      id={id}
      className={cn(
        'group/fold overflow-hidden rounded-xl border border-border/70 bg-card',
        className,
      )}
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

/** «Lo que sigue siendo a mano»: qué, dónde y por qué todavía no se trae solo. */
export function StaysManualCard({ base, className }: { base: string; className?: string }) {
  return (
    <FootFold id="arranque-a-mano" title="Lo que sigue siendo a mano" className={className}>
      <ul className="divide-y divide-border/60">
        {ONBOARDING_STAYS_MANUAL.map((task) => (
          <li key={task.title} className="space-y-1 px-3 py-3 text-sm">
            <p className="font-medium text-foreground">{task.title}</p>
            <p className="text-muted-foreground text-pretty">{task.why}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
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
                <SheetButton sheet={task.sheet} variant="outline" size="sm">
                  {task.sheetLabel ?? ACTION_TITLES[task.sheet]}
                </SheetButton>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </FootFold>
  )
}

/** «Lo que hace la plataforma sola». */
export function PlatformDoesCard({ className }: { className?: string }) {
  return (
    <FootFold id="arranque-sola" title="Lo que hace la plataforma sola" className={className}>
      <ul className="space-y-2.5 px-3 py-3">
        {PLATFORM_DOES.map((text) => (
          <li key={text} className="flex items-start gap-2.5 text-sm">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="text-pretty">{text}</span>
          </li>
        ))}
      </ul>
    </FootFold>
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
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-sm',
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
        className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-sm font-medium whitespace-nowrap text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:min-h-9"
      >
        Las palabras, en criollo
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </p>
  )
}
