'use client'

import { ChevronDown, ChevronRight } from 'lucide-react'
import { Collapsible as CollapsiblePrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * Un bloque que se abre y se cierra (kit HUB §3.5): «¿Cómo se calcula?»,
 * «Reglas avanzadas». Reemplaza los `<details>` estilados a mano.
 *
 * Es el patrón «disclosure» de la APG sobre `Collapsible` de Radix: el
 * disparador es un `<button>` con `aria-expanded` y `aria-controls`, Enter y
 * Espacio lo abren y lo cierran, y lo de adentro sale del árbol de
 * accesibilidad cerrado. Abre en el lugar, sin animar el alto: se toca para
 * leer, no para mirar cómo se despliega (el chevron gira en 150 ms; con
 * «reducir movimiento», al instante).
 *
 * - `variant="card"` (default): una tarjeta con el título como fila de 44 px
 *   (con `description` debajo y un ícono opcional adelante) y el chevron
 *   abajo a la derecha. El contenido va abajo, con un pelo arriba.
 * - `variant="inline"`: la ayuda chica adentro de un texto o de una ficha: un
 *   link-botón apagado de 12 px con el chevron adelante; el contenido abre
 *   abajo, alineado con el texto.
 *
 * Para armar uno propio están las piezas: `Collapsible`, `CollapsibleTrigger`
 * y `CollapsibleContent` (las de Radix con `data-slot`).
 */

function Collapsible(props: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger(props: React.ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
}

function CollapsibleContent(props: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return <CollapsiblePrimitive.Content data-slot="collapsible-content" {...props} />
}

export type DisclosureProps = Omit<
  React.ComponentProps<typeof CollapsiblePrimitive.Root>,
  'title' | 'asChild'
> & {
  /** Lo que se lee cerrado: «¿Cómo se calcula?», «Reglas avanzadas». */
  title: React.ReactNode
  /** `card`: una línea debajo del título, también cerrado («2 activas»). */
  description?: React.ReactNode
  /**
   * `card`: un ícono de 16 px adelante del título, apagado. Va como elemento
   * (`icon={<CircleHelp />}`) y no como componente: así cruza desde un Server
   * Component (una página) a este, que es cliente.
   */
  icon?: React.ReactNode
  /** Default `card`. */
  variant?: 'card' | 'inline'
  /** Clases del contenido (el de `card` trae `p-4` y el pelo de arriba). */
  contentClassName?: string
}

/** Lo que gira: en `card` apunta abajo y da media vuelta; en `inline` apunta a la derecha y baja. */
const CHEVRON_MOTION =
  'shrink-0 text-muted-foreground transition-[rotate] duration-(--duration-quick) ease-(--ease-ui) motion-reduce:transition-none'

function Disclosure({
  title,
  description,
  icon,
  variant = 'card',
  contentClassName,
  className,
  children,
  ...props
}: DisclosureProps) {
  if (variant === 'inline') {
    return (
      <Collapsible
        data-variant="inline"
        className={cn('group/disclosure type-caption', className)}
        {...props}
      >
        <CollapsibleTrigger
          className={cn(
            'inline-flex cursor-pointer items-center gap-1 rounded-sm text-start text-muted-foreground',
            'outline-offset-2 outline-(--ring) hover:text-foreground focus-visible:outline-2',
            'pointer-coarse:min-h-11',
          )}
        >
          <ChevronRight
            aria-hidden="true"
            className={cn('size-3.5 group-data-[state=open]/disclosure:rotate-90', CHEVRON_MOTION)}
          />
          {title}
        </CollapsibleTrigger>
        <CollapsibleContent className={cn('mt-2 ps-[1.125rem]', contentClassName)}>
          {children}
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <Collapsible
      data-variant="card"
      className={cn('group/disclosure rounded-xl border border-border bg-card', className)}
      {...props}
    >
      <CollapsibleTrigger
        className={cn(
          'flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-start',
          // Abierto, solo las esquinas de arriba: abajo sigue el contenido.
          'group-data-[state=open]/disclosure:rounded-b-none',
          'outline-(--ring) -outline-offset-2 hover:bg-hover focus-visible:outline-2',
        )}
      >
        {icon ? (
          <span
            aria-hidden="true"
            data-slot="disclosure-icon"
            className="flex shrink-0 text-muted-foreground [&_svg]:size-4"
          >
            {icon}
          </span>
        ) : null}
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="type-label text-foreground">{title}</span>
          {description ? (
            <span className="type-small text-pretty text-muted-foreground">{description}</span>
          ) : null}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn('size-4 group-data-[state=open]/disclosure:rotate-180', CHEVRON_MOTION)}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn('border-t border-border p-4', contentClassName)}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger, Disclosure }
