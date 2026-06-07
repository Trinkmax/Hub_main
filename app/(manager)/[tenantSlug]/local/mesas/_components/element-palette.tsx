'use client'

import { Box, Columns3, Square, Table2, Wine } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Kind = 'table' | 'wall' | 'pillar' | 'island' | 'bar'

export type ElementPaletteProps = {
  /** Fallback tap/teclado: agrega el elemento en el centro del área visible. */
  onQuickAdd: (kind: Kind) => void
  /** Inicia el drag-from-palette por pointer (mouse + touch). */
  onChipPointerDown: (kind: Kind, label: string, e: React.PointerEvent) => void
  /** Suprime el click que dispara el navegador tras un drag real (evita doble alta). */
  shouldSuppressClick: () => boolean
}

// kind + label es-AR + ícono. "Mesa" primero (acción principal), luego decoración.
const ITEMS: { kind: Kind; label: string; Icon: typeof Box; primary?: boolean }[] = [
  { kind: 'table', label: 'Mesa', Icon: Table2, primary: true },
  { kind: 'wall', label: 'Pared', Icon: Columns3 },
  { kind: 'pillar', label: 'Columna', Icon: Box },
  { kind: 'island', label: 'Isla', Icon: Square },
  { kind: 'bar', label: 'Barra', Icon: Wine },
]

export function ElementPalette({
  onQuickAdd,
  onChipPointerDown,
  shouldSuppressClick,
}: ElementPaletteProps) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0">
      <legend className="sr-only">Agregar al plano (arrastrá al lienzo o tocá para agregar)</legend>
      {ITEMS.map(({ kind, label, Icon, primary }) => (
        <Button
          key={kind}
          type="button"
          variant={primary ? 'default' : 'outline'}
          size="sm"
          // Drag por pointer (mouse + touch); el drop sobre el stage crea el elemento.
          onPointerDown={(e) => onChipPointerDown(kind, label, e)}
          // tap/teclado → agregar al centro. Si vino de un drag real, el hook lo suprime.
          onClick={() => {
            if (shouldSuppressClick()) return
            onQuickAdd(kind)
          }}
          // touch-none: que el drag de la chip no dispare scroll en tablet/celular.
          className="cursor-grab touch-none gap-1.5 active:cursor-grabbing"
          aria-label={`Agregar ${label} (arrastrá al plano o tocá para agregar en el centro)`}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </Button>
      ))}
    </fieldset>
  )
}
