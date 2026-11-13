'use client'

import {
  BarGlyph,
  DoorGlyph,
  IslandGlyph,
  PillarGlyph,
  StageGlyph,
  TextGlyph,
  WallGlyph,
} from './glyphs'
import type { PaletteKind } from './use-palette-drag'

export type ElementPaletteProps = {
  /** Toque o teclado: agrega el elemento en el centro del sector. */
  onQuickAdd: (kind: PaletteKind) => void
  /** Inicia el arrastre desde la paleta (mouse y dedo). */
  onChipPointerDown: (kind: PaletteKind, label: string, e: React.PointerEvent) => void
  /** Suprime el click que dispara el navegador tras un arrastre real (evita doble alta). */
  shouldSuppressClick: () => boolean
}

// Lo que no es mesa: primero lo que más se usa para armar un salón.
const ITEMS: {
  kind: Exclude<PaletteKind, 'table'>
  label: string
  Glyph: (props: { className?: string }) => React.ReactNode
}[] = [
  { kind: 'bar', label: 'Barra', Glyph: BarGlyph },
  { kind: 'wall', label: 'Pared', Glyph: WallGlyph },
  { kind: 'pillar', label: 'Columna', Glyph: PillarGlyph },
  { kind: 'island', label: 'Isla', Glyph: IslandGlyph },
  { kind: 'door', label: 'Puerta', Glyph: DoorGlyph },
  { kind: 'stage', label: 'Escenario', Glyph: StageGlyph },
  { kind: 'text', label: 'Texto', Glyph: TextGlyph },
]

/**
 * La paleta: lo que se puede apoyar en el piso además de las mesas. Cada pieza
 * se arrastra al plano (cae donde se suelta) o se toca (cae en el centro).
 */
export function ElementPalette({
  onQuickAdd,
  onChipPointerDown,
  shouldSuppressClick,
}: ElementPaletteProps) {
  return (
    <fieldset className="fpe-rail fpe-paper">
      <legend className="fpe-sr">
        Agregar al plano: arrastrá una pieza al piso o tocala para agregarla en el centro
      </legend>
      <span className="fpe-rail-title" aria-hidden>
        Agregar
      </span>
      {ITEMS.map(({ kind, label, Glyph }) => (
        <button
          key={kind}
          type="button"
          className="fpe-tool"
          title="Arrastrala al plano o tocala"
          aria-label={`Agregar ${label.toLowerCase()}`}
          onPointerDown={(e) => onChipPointerDown(kind, label, e)}
          onClick={() => {
            if (shouldSuppressClick()) return
            onQuickAdd(kind)
          }}
        >
          <Glyph />
          {label}
        </button>
      ))}
    </fieldset>
  )
}
