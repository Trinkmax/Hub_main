import type * as React from 'react'
import { cn } from '@/lib/utils'

export type PageShellWidth = 'compact' | 'comfortable' | 'default' | 'wide' | 'full'

// Atributos de HTMLElement: la raíz puede ser `<div>` o `<section>`.
export type PageShellProps = Omit<React.HTMLAttributes<HTMLElement>, 'children'> & {
  children: React.ReactNode
  /** `compact` 3xl · `comfortable` 6xl · `default` 7xl · `wide` screen-2xl · `full` sin tope. */
  width?: PageShellWidth
  /** Sin relleno lateral, para layouts que van de borde a borde (kanban, plano). */
  flush?: boolean
  /** `section` cuando la página es una región con nombre propio. Nunca `main`: lo pone el shell. */
  as?: 'div' | 'section'
}

const WIDTH_CLASS: Readonly<Record<PageShellWidth, string>> = {
  compact: 'max-w-3xl',
  comfortable: 'max-w-6xl',
  default: 'max-w-7xl',
  wide: 'max-w-screen-2xl',
  full: 'max-w-none',
}

/**
 * El contenedor de toda página del panel: ancho, relleno y aire entre bloques.
 * Reemplaza los `mx-auto max-w-* space-y-6 px-4 py-8` escritos a mano.
 *
 * - 32 px entre bloques (antes 24): la jerarquía se arma con aire (§1.1).
 * - Columna flex con `gap`, no `space-y`: el aire no depende de que el hijo
 *   sea un bloque ni se suma a sus márgenes.
 * - No es `<main>`: el `<main id="contenido">` lo pone el shell (un `<main>`
 *   anidado rompe el salto al contenido y los puntos de referencia).
 */
export function PageShell({
  children,
  width = 'default',
  flush = false,
  as: Comp = 'div',
  className,
  ...props
}: PageShellProps) {
  return (
    <Comp
      data-slot="page-shell"
      className={cn(
        'mx-auto flex w-full flex-col gap-8 py-6 sm:py-8',
        WIDTH_CLASS[width],
        !flush && 'px-4 sm:px-6 lg:px-8',
        className,
      )}
      {...props}
    >
      {children}
    </Comp>
  )
}
