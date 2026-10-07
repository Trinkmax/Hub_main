'use client'

import { Armchair, Circle, type LucideIcon, RectangleHorizontal, Square } from 'lucide-react'
import { ChipGroup, FilterChip } from '@/components/ui/filter-chip'

/** Las formas del alta en lote (`bulkCreateTablesAction`). */
export type ShapePreset = 'round' | 'square' | 'rect' | 'banquette'
/** Las formas de una mesa ya dibujada (`setElementShapeAction`). */
export type TableShape = 'rect' | 'circle' | 'banquette'

const SHAPE_ICON: Readonly<Record<ShapePreset | TableShape, LucideIcon>> = {
  square: Square,
  round: Circle,
  circle: Circle,
  rect: RectangleHorizontal,
  banquette: Armchair,
}

/**
 * Elegir la forma de una mesa: una opción entre pocas (kit HUB §3.3). Son
 * `FilterChip` en un `ChipGroup` con nombre y no un segmentado: con cuatro
 * formas el segmentado no entra en el celular (no envuelve) y los chips sí.
 * Elegida = contorno verde + check (forma, no solo color). Tocar la elegida no
 * la desmarca: siempre hay una forma.
 *
 * TODO(kit): si el kit suma un grupo de opción única que envuelva (radio con
 * aspecto de chip), esto pasa a usarlo.
 */
export function TableShapeChips<T extends ShapePreset | TableShape>({
  legend,
  options,
  value,
  onValueChange,
  disabled,
}: {
  /** El nombre del grupo para el lector de pantalla y la etiqueta visible. */
  legend: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onValueChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <span aria-hidden className="type-label text-foreground">
        {legend}
      </span>
      <ChipGroup aria-label={legend} disabled={disabled}>
        {options.map((option) => (
          <FilterChip
            key={option.value}
            icon={SHAPE_ICON[option.value]}
            pressed={value === option.value}
            onPressedChange={(pressed) => {
              if (pressed) onValueChange(option.value)
            }}
          >
            {option.label}
          </FilterChip>
        ))}
      </ChipGroup>
    </div>
  )
}
