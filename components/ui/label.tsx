'use client'

import * as LabelPrimitive from '@radix-ui/react-label'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export type LabelProps = React.ComponentProps<typeof LabelPrimitive.Root> & {
  /**
   * Agrega « (opcional)» en texto de apoyo. En es-AR se marca lo opcional, no
   * lo obligatorio: sin asteriscos.
   */
  optional?: boolean
}

/**
 * Etiqueta de campo (§3.2): `type-label` (13/18, 500) en tinta. Adentro de un
 * `Field` la pone el Field; suelta sirve como siempre con `htmlFor`.
 *
 * Mantiene `flex items-center gap-2`: hay etiquetas que llevan un ícono o la
 * casilla adentro. El `font-medium` explícito queda para que un `text-xs` del
 * que llama (que `cn()` resuelve sacando el `type-label`) no le baje el peso.
 */
function Label({ className, optional = false, children, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'flex items-center gap-2 type-label font-medium text-foreground select-none',
        'group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50',
        'group-data-[disabled=true]/field:opacity-50',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      {optional ? (
        // -ms-1 deja 4 px (un espacio) en vez de los 8 del gap. El espacio del
        // texto no se ve (arranca la caja) pero el lector lo usa: «Teléfono (opcional)».
        <span data-slot="label-optional" className="-ms-1 font-normal text-subtle-foreground">
          {' (opcional)'}
        </span>
      ) : null}
    </LabelPrimitive.Root>
  )
}

export { Label }
