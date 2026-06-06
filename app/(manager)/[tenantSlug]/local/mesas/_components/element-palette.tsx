'use client'

import { Box, Columns3, Square, Table2, Wine } from 'lucide-react'
import { Button } from '@/components/ui/button'

type DecorKind = 'wall' | 'pillar' | 'island' | 'bar'

type ElementPaletteProps = {
  onAddTable: () => void
  onAddDecor: (kind: DecorKind) => void
}

// Decoración: kind + label es-AR + ícono. Orden estable (pared, columna, isla, barra).
const DECOR: { kind: DecorKind; label: string; Icon: typeof Box }[] = [
  { kind: 'wall', label: 'Pared', Icon: Columns3 },
  { kind: 'pillar', label: 'Columna', Icon: Box },
  { kind: 'island', label: 'Isla', Icon: Square },
  { kind: 'bar', label: 'Barra', Icon: Wine },
]

export function ElementPalette({ onAddTable, onAddDecor }: ElementPaletteProps) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0">
      <legend className="sr-only">Agregar al plano</legend>
      <Button type="button" variant="default" size="sm" onClick={onAddTable} className="gap-1.5">
        <Table2 className="size-4" aria-hidden />
        Mesa
      </Button>
      {DECOR.map(({ kind, label, Icon }) => (
        <Button
          key={kind}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onAddDecor(kind)}
          className="gap-1.5"
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </Button>
      ))}
    </fieldset>
  )
}
