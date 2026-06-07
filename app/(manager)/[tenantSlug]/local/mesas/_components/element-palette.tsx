'use client'

import { Box, Columns3, Square, Table2, Wine } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Kind = 'table' | 'wall' | 'pillar' | 'island' | 'bar'

export type ElementPaletteProps = {
  /** Fallback no-drag: agrega el elemento en el centro del área visible. */
  onQuickAdd: (kind: Kind) => void
}

// kind + label es-AR + ícono. "Mesa" primero (acción principal), luego decoración.
const ITEMS: { kind: Kind; label: string; Icon: typeof Box; primary?: boolean }[] = [
  { kind: 'table', label: 'Mesa', Icon: Table2, primary: true },
  { kind: 'wall', label: 'Pared', Icon: Columns3 },
  { kind: 'pillar', label: 'Columna', Icon: Box },
  { kind: 'island', label: 'Isla', Icon: Square },
  { kind: 'bar', label: 'Barra', Icon: Wine },
]

export function ElementPalette({ onQuickAdd }: ElementPaletteProps) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0">
      <legend className="sr-only">Agregar al plano (arrastrá al lienzo o tocá para agregar)</legend>
      {ITEMS.map(({ kind, label, Icon, primary }) => (
        <Button
          key={kind}
          type="button"
          variant={primary ? 'default' : 'outline'}
          size="sm"
          // HTML5 drag: el drop sobre el stage lee este dataTransfer.
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-floor-kind', kind)
            e.dataTransfer.effectAllowed = 'copy'
          }}
          // Fallback no-drag (touch simple / accesible): agrega en el centro.
          onClick={() => onQuickAdd(kind)}
          className="cursor-grab gap-1.5 active:cursor-grabbing"
          aria-label={`Agregar ${label} (arrastrá al plano o tocá para agregar en el centro)`}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </Button>
      ))}
    </fieldset>
  )
}
