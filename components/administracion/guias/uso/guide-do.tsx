'use client'

import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useAccountingOptional } from '@/components/administracion/accounting-provider'
import type { GuideTarget } from '@/lib/accounting/guides'
import { cn } from '@/lib/utils'

/**
 * «Hacerlo ahora»: el botón de la guía que abre la pantalla o la hoja REAL donde se hace lo que
 * se acaba de leer. Una hoja se abre sobre la misma guía (`?accion=`), así al cerrarla seguís
 * donde estabas leyendo.
 *
 * No se dibuja en modo lectura (la contadora no ve ninguna puerta de carga) ni fuera de
 * Administración (sin el provider no hay hojas).
 */

const BASE =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-sm font-medium transition-[background-color,border-color,scale] duration-(--duration-fast) ease-(--ease-out) active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:active:scale-100'

const LOOK = {
  /** El principal de un bloque. */
  solid: 'bg-primary px-4 text-primary-foreground shadow-xs hover:bg-primary/90',
  /** Uno entre varios: no compite con el principal de la pantalla. */
  soft: 'border border-border/70 bg-card px-3.5 text-foreground hover:bg-cream-tint',
  /** Sobre el panel verde, callado. */
  onHero:
    'bg-white/10 px-3.5 text-adm-hero-fg hover:bg-white/16 focus-visible:ring-offset-adm-hero',
  /** Sobre el panel verde, el que te toca. */
  gold: 'bg-adm-gold px-4 font-semibold text-adm-hero-2 shadow-xs hover:bg-adm-gold/90 focus-visible:ring-offset-adm-hero',
} as const

export function GuideDo({
  target,
  look = 'soft',
  className,
  children,
}: {
  target: GuideTarget
  look?: keyof typeof LOOK
  className?: string
  children: ReactNode
}) {
  const ctx = useAccountingOptional()
  if (!ctx || ctx.readOnly) return null
  // 44 px en el celular (se toca con el dedo), 36 px con mouse.
  const classes = cn(BASE, 'h-11 md:h-9', LOOK[look], className)
  if (target.kind === 'route') {
    return (
      <Link
        href={`/${ctx.tenantSlug}/administracion${target.path}`}
        className={classes}
        // La guía es larga: llegando desde abajo, la pantalla nueva (más corta) heredaba el
        // scroll recortado y en el celular Gastos fijos abría mostrando su final. Se sale desde
        // arriba, así siempre se llega a su título.
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          window.scrollTo({ top: 0, behavior: 'instant' })
        }}
      >
        {children}
        <ArrowRight aria-hidden className="size-4" />
      </Link>
    )
  }
  const { sheet } = target
  return (
    <button type="button" onClick={() => ctx.openAction(sheet)} className={classes}>
      {children}
      <ArrowRight aria-hidden className="size-4" />
    </button>
  )
}
