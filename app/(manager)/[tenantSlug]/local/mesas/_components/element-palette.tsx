'use client'

import { Plus } from 'lucide-react'
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
  /** Toque o teclado: agrega el elemento en un lugar libre de lo que se está mirando. */
  onQuickAdd: (kind: PaletteKind) => void
  /** Inicia el arrastre desde la paleta (mouse y dedo). */
  onChipPointerDown: (kind: PaletteKind, label: string, e: React.PointerEvent) => void
  /** Suprime el click que dispara el navegador tras un arrastre real (evita doble alta). */
  shouldSuppressClick: () => boolean
  /** «Varias mesas», con su ventanita: va al lado de «Mesa». */
  bulk: React.ReactNode
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
 * La paleta: todo lo que se apoya en el piso, en una tira al costado del tablero. Arriba la mesa, que es
 * lo que más se agrega (en tinta, para que se vea primero); abajo lo construido. Cada pieza se arrastra
 * al plano (cae donde se suelta) o se toca (cae en un lugar libre, nunca encima de otra).
 */
export function ElementPalette({
  onQuickAdd,
  onChipPointerDown,
  shouldSuppressClick,
  bulk,
}: ElementPaletteProps) {
  return (
    <fieldset className="fpe-rail fpe-paper">
      <legend className="fpe-sr">
        Agregar al plano: arrastrá una pieza al piso o tocala para agregarla en un lugar libre
      </legend>
      <button
        type="button"
        className="fpe-tool fpe-tool-main"
        title="Tocala para agregar una mesa, o arrastrala al plano"
        aria-label="Agregar mesa"
        onPointerDown={(e) => onChipPointerDown('table', 'Mesa', e)}
        onClick={() => {
          if (shouldSuppressClick()) return
          onQuickAdd('table')
        }}
      >
        <Plus aria-hidden />
        Mesa
      </button>
      {bulk}
      <span className="fpe-rail-sep" aria-hidden />
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
