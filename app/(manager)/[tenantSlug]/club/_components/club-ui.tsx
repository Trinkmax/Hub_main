'use client'

import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import { CSS, type Transform } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import type * as React from 'react'
import { ChipGroup, FilterChip } from '@/components/ui/filter-chip'
import { contrastRatio } from '@/lib/color/contrast'
import { cn } from '@/lib/utils'

/*
 * Piezas chicas que comparten los editores del club (niveles, aliados, punch
 * cards, beneficios). Antes cada archivo tenía su `TierChip` y su asa de
 * arrastre; acá hay una sola, con el vocabulario de selección del kit.
 */

type TierLike = { id: string; name: string; color: string | null }

const LIGHT_TEXT = '#ffffff'
const DARK_TEXT = '#051c13'

/**
 * El texto que se lee sobre el color que eligió el dueño para un nivel: blanco
 * o tinta, el que tenga más contraste. Un color que no se entiende (dato viejo)
 * cae en blanco, como antes.
 */
export function readableTextOn(background: string): string {
  try {
    return contrastRatio(LIGHT_TEXT, background) >= contrastRatio(DARK_TEXT, background)
      ? LIGHT_TEXT
      : DARK_TEXT
  } catch {
    return LIGHT_TEXT
  }
}

/**
 * El color de un nivel como punto. Es dato del dueño (un hex), no un estado:
 * acompaña al nombre, nunca lo reemplaza.
 */
export function TierDot({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-2.5 shrink-0 rounded-full border border-border-strong',
        !color && 'bg-subtle-foreground',
        className,
      )}
      style={color ? { backgroundColor: color } : undefined}
    />
  )
}

/**
 * Elegir niveles (un set arbitrario, no «de tal para arriba»): chips que se
 * suman. Lo elegido se ve como en todo el kit (cartulina, contorno verde y
 * check); el color del nivel queda en el punto.
 */
export function TierToggleChips({
  tiers,
  selected,
  onToggle,
  'aria-label': ariaLabel,
  className,
}: {
  tiers: readonly TierLike[]
  selected: readonly string[]
  onToggle: (tierId: string) => void
  'aria-label': string
  className?: string
}) {
  return (
    <ChipGroup aria-label={ariaLabel} className={className}>
      {tiers.map((tier) => (
        <FilterChip
          key={tier.id}
          size="md"
          pressed={selected.includes(tier.id)}
          onPressedChange={() => onToggle(tier.id)}
        >
          <TierDot color={tier.color} />
          {tier.name}
        </FilterChip>
      ))}
    </ChipGroup>
  )
}

/**
 * El asa de una fila que se reordena arrastrando (dnd-kit). Con el teclado:
 * Espacio la levanta, las flechas la mueven y Espacio la suelta.
 */
export function DragHandle({
  label,
  attributes,
  listeners,
  className,
}: {
  /** «Reordenar Café gratis». */
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

/** El estilo de una fila arrastrable: mientras se arrastra flota (y se ve encima). */
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

/** La lista de filas: una sola cartulina con pelos entre filas (sin tarjeta por fila). */
export const ROW_LIST_CLASSES =
  'divide-y divide-border overflow-clip rounded-xl border border-border bg-card'

/** La fila que se está arrastrando flota por encima de las demás. */
export const DRAGGING_ROW_CLASSES = 'relative z-10 shadow-float'
