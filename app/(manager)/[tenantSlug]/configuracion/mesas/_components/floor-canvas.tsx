'use client'

import { Maximize2, Minus, Plus } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { GRID } from '@/lib/floor-plan/grid'
import type { AreaRow, ElementRow } from '@/lib/floor-plan/queries'
import { FloorElement } from './floor-element'

export type FloorCanvasProps = {
  area: AreaRow
  elements: ElementRow[]
  scale: number
  pan: { x: number; y: number }
  selectedId: string | null
  onSelectElement: (id: string | null) => void
  onResizeEnd: (id: string, geom: { width: number; height: number }) => void
  onZoomIn?: () => void
  onZoomOut?: () => void
  onFit?: () => void
}

export function FloorCanvas({
  area,
  elements,
  scale,
  pan,
  selectedId,
  onSelectElement,
  onResizeEnd,
  onZoomIn,
  onZoomOut,
  onFit,
}: FloorCanvasProps) {
  // Capa 1: viewport. SIN transform → límite de medición de DndContext y
  // offsetParent del restrictToParent.
  const viewportRef = useRef<HTMLDivElement>(null)

  return (
    <div className="relative w-full">
      <div
        ref={viewportRef}
        className="card-hairline relative h-[70vh] min-h-[420px] w-full overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm"
      >
        {/* Capa 2: stage. transform translate+scale; tamaño = área lógica. */}
        <div
          className="absolute left-0 top-0"
          style={{
            width: area.width,
            height: area.height,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transformOrigin: '0 0',
            // Grilla lógica en px del área (se escala con el stage).
            backgroundImage:
              'linear-gradient(to right, oklch(0.5 0.02 165 / 0.10) 1px, transparent 1px), linear-gradient(to bottom, oklch(0.5 0.02 165 / 0.10) 1px, transparent 1px)',
            backgroundSize: `${GRID}px ${GRID}px`,
          }}
          // Click en el stage vacío deselecciona. Si el click vino de un elemento,
          // su body hace stopPropagation / el target no es el stage.
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onSelectElement(null)
          }}
        >
          {/* Capa 3: elementos en px lógicos (el stage ya está escalado). */}
          {elements.map((element) => (
            <FloorElement
              key={element.id}
              element={element}
              selected={element.id === selectedId}
              scale={scale}
              onSelect={onSelectElement}
              onResizeEnd={onResizeEnd}
            />
          ))}
        </div>
      </div>

      {/* Controles de zoom/pan (fuera del stage → no se escalan). */}
      <div className="absolute bottom-3 right-3 flex flex-col items-center gap-1 rounded-xl border border-border/60 bg-card/95 p-1 shadow-md backdrop-blur-sm">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={onZoomIn}
          aria-label="Acercar"
        >
          <Plus className="size-4" aria-hidden />
        </Button>
        <span
          className="text-center text-[10px] font-medium tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {Math.round(scale * 100)}%
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={onZoomOut}
          aria-label="Alejar"
        >
          <Minus className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={onFit}
          aria-label="Ajustar a la pantalla"
        >
          <Maximize2 className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}
