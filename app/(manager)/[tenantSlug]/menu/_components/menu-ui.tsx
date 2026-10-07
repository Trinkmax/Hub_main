'use client'

import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import { CSS, type Transform } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import type * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/*
 * Piezas chicas que comparten las vistas de la carta: el asa de arrastre, el
 * estilo de lo que se arrastra y la etiqueta de un tag con su color.
 */

/**
 * El asa de una fila o tarjeta que se reordena arrastrando (dnd-kit). Con el
 * teclado: Espacio la levanta, las flechas la mueven y Espacio la suelta.
 */
export function DragHandle({
  label,
  attributes,
  listeners,
  className,
}: {
  /** «Mover Tragos». */
  label: string
  attributes: DraggableAttributes
  listeners: DraggableSyntheticListeners
  className?: string
}) {
  return (
    <button
      {...attributes}
      {...listeners}
      type="button"
      aria-label={label}
      className={cn(
        // touch-none: sin esto el gesto de arrastre en tablet scrollea la página.
        'relative hit-area grid size-9 shrink-0 cursor-grab touch-none place-items-center rounded-md text-subtle-foreground',
        'hover:bg-hover hover:text-foreground active:cursor-grabbing',
        'outline-offset-2 outline-(--ring) focus-visible:outline-2',
        className,
      )}
    >
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
  )
}

/** El estilo de lo que se arrastra: mientras se arrastra flota (y se ve encima). */
export function sortableStyle(
  transform: Transform | null,
  transition: string | undefined,
  isDragging: boolean,
): React.CSSProperties {
  return {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }
}

/** Lo que se está arrastrando flota por encima del resto. */
export const DRAGGING_CLASSES = 'relative z-10 shadow-float'

/** La lista de filas: una sola cartulina con pelos entre filas. */
export const ROW_LIST_CLASSES =
  'divide-y divide-border overflow-clip rounded-xl border border-border bg-card'

/**
 * Un tag de la carta: el color que eligió el dueño va en el punto (es dato, no
 * estado) y el texto queda en tinta, legible con cualquier color.
 */
export function TagBadge({ name, color }: { name: string; color: string }) {
  return (
    <Badge tone="neutral">
      <TagDot color={color} />
      {name}
    </Badge>
  )
}

export function TagDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('size-2 shrink-0 rounded-full border border-border-strong', className)}
      style={{ backgroundColor: color }}
    />
  )
}
