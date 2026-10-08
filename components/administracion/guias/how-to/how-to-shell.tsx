'use client'

import { ChevronDown, CircleHelp } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * El plegable «¿Cómo lo bajo?» de las mini guías (diseño §5.1.4): un `<details>` con el estilo de
 * las tarjetas del panel (`components/ui` no tiene `Collapsible`). Se abre con el teclado (Enter
 * o espacio sobre el título) y el lector de pantalla anuncia si está abierto o cerrado.
 */
export function HowToShell({
  title = '¿Cómo lo bajo?',
  subtitle,
  defaultOpen = false,
  className,
  children,
}: {
  title?: string
  subtitle: string
  defaultOpen?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <details
      open={defaultOpen}
      className={cn('card-hairline group rounded-xl border bg-card', className)}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-cream-tint text-primary">
          <CircleHelp className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">{title}</span>
          <span className="block text-xs text-muted-foreground text-pretty">{subtitle}</span>
        </span>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <div className="space-y-4 border-t border-border/60 px-4 py-4 text-sm">{children}</div>
    </details>
  )
}

/** Un paso numerado de una mini guía (número en círculo, texto y, si hay, la maqueta). */
export function HowToStep({
  n,
  children,
  mock,
}: {
  n: number
  children: ReactNode
  mock?: ReactNode
}) {
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 gap-y-2">
      <span
        aria-hidden="true"
        className="flex size-7 items-center justify-center rounded-full border border-border bg-secondary/40 text-xs font-semibold tabular-nums text-muted-foreground"
      >
        {n}
      </span>
      <div className="min-w-0 space-y-2 pt-1 text-pretty">
        <div>{children}</div>
        {mock ? <div className="max-w-xl">{mock}</div> : null}
      </div>
    </li>
  )
}

/** Una línea destacada al pie («Cuándo», «Ojo»). */
export function HowToNote({
  icon,
  title,
  children,
  tone = 'info',
}: {
  icon: ReactNode
  title: string
  children: ReactNode
  tone?: 'info' | 'warning'
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 text-sm',
        tone === 'warning' ? 'border-warning/40 bg-warning/10' : 'border-info/30 bg-info/10',
      )}
    >
      <span
        className={cn('mt-0.5 shrink-0', tone === 'warning' ? 'text-warning' : 'text-info')}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0 space-y-0.5 text-pretty">
        <p className={cn('font-medium', tone === 'warning' && 'text-warning-text')}>{title}</p>
        <div className="text-muted-foreground">{children}</div>
      </div>
    </div>
  )
}
