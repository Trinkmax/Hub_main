import type * as React from 'react'
import { cn } from '@/lib/utils'

type SeparatorProps = React.ComponentProps<'div'> & {
  orientation?: 'horizontal' | 'vertical'
  /**
   * `true` (default): es solo un pelo visual y los lectores de pantalla no lo
   * anuncian. `false` cuando separa grupos con significado (un menú, una
   * barra de herramientas).
   */
  decorative?: boolean
}

/**
 * Un pelo de 1 px en `--border` (§3.5). Server-safe: la misma semántica que el
 * primitivo de Radix (`role="none"` si es decorativo; `role="separator"` y
 * `aria-orientation` si no) sin traer código de cliente para una línea.
 */
function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: SeparatorProps) {
  const semantic = decorative
    ? { role: 'none' as const }
    : {
        role: 'separator' as const,
        // horizontal es el valor implícito de role="separator": solo se aclara el vertical.
        'aria-orientation': orientation === 'vertical' ? ('vertical' as const) : undefined,
      }
  return (
    <div
      data-slot="separator"
      data-orientation={orientation}
      {...semantic}
      className={cn(
        'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        className,
      )}
      {...props}
    />
  )
}

export type { SeparatorProps }
export { Separator }
