'use client'

import { Maximize2, Minus, Plus } from 'lucide-react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import { Button } from '@/components/ui/button'
import { GRID, stagePointFromClient } from '@/lib/floor-plan/grid'

type TransformRef = React.RefObject<ReactZoomPanPinchRef | null>

export type PanZoomStageProps = {
  /** Tamaño lógico del área (px lógicos). El stage tiene exactamente este tamaño. */
  width: number
  height: number
  transformRef: TransformRef
  /** true = editor (pan excluido sobre `.floor-element`); false = live (pan/zoom libre). */
  interactive?: boolean
  /** Click en el fondo vacío del stage (deseleccionar). */
  onBackgroundClick?: () => void
  /** Tamaño de la grilla CSS de fondo (px lógicos). Default GRID. */
  gridSize?: number
  /** Clase del wrapper externo (alto del viewport, etc.). */
  className?: string
  /** FloorElements (editor) o LiveTableCards (live), posicionados absolute en coords lógicas. */
  children: React.ReactNode
}

/**
 * Wrapper compartido editor/live: `react-zoom-pan-pinch` (pan/zoom robusto) +
 * un único div "stage" de tamaño = área lógica con grilla CSS de fondo. Los hijos
 * van `position:absolute` en coords lógicas dentro del stage.
 *
 * - `interactive` (editor): el pan se EXCLUYE sobre `.floor-element` para que
 *   arrastrar una mesa no panee el lienzo (la mesa hace su propio pointer-drag).
 * - `!interactive` (live): pan/zoom libre, sin exclusiones.
 *
 * El scale vigente se lee con `transformRef.current.state.scale` durante el drag
 * (sin re-render). Los controles +/−/fit usan `zoomIn/zoomOut/centerView` por ref.
 */
export function PanZoomStage({
  width,
  height,
  transformRef,
  interactive = false,
  onBackgroundClick,
  gridSize,
  className,
  children,
}: PanZoomStageProps) {
  const grid = gridSize ?? GRID

  const onZoomIn = () => transformRef.current?.zoomIn()
  const onZoomOut = () => transformRef.current?.zoomOut()
  // "Fit": re-encuadra el stage en el viewport (centra y escala a contenido).
  const onFit = () => transformRef.current?.centerView(undefined, 200, 'easeOut')

  return (
    <div className={className ?? 'relative w-full'}>
      <div className="card-hairline relative h-[70vh] min-h-[420px] w-full overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
        <TransformWrapper
          ref={transformRef}
          initialScale={1}
          centerOnInit
          minScale={0.25}
          maxScale={4}
          limitToBounds={false}
          panning={
            interactive
              ? { excluded: ['floor-element'], velocityDisabled: true }
              : { velocityDisabled: true }
          }
          doubleClick={{ disabled: true }}
          wheel={{ step: 0.2 }}
          pinch={{ step: 5 }}
        >
          <TransformComponent
            wrapperStyle={{ width: '100%', height: '100%' }}
            contentStyle={{ width, height }}
          >
            {/* Stage: tamaño = área lógica; grilla CSS de fondo. */}
            <div
              className="relative"
              style={{
                width,
                height,
                backgroundImage:
                  'linear-gradient(to right, oklch(0.5 0.02 165 / 0.10) 1px, transparent 1px), linear-gradient(to bottom, oklch(0.5 0.02 165 / 0.10) 1px, transparent 1px)',
                backgroundSize: `${grid}px ${grid}px`,
              }}
              // Click en el stage vacío deselecciona. Si vino de un elemento, su
              // body hizo stopPropagation y el target no es el stage.
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) onBackgroundClick?.()
              }}
            >
              {children}
            </div>
          </TransformComponent>
        </TransformWrapper>
      </div>

      {/* Controles de zoom/fit (fuera del stage → no se escalan). */}
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

// Re-export del helper para que el editor lo importe desde un único lugar junto
// al componente que lo necesita (evita duplicar el import en cada consumidor).
export { stagePointFromClient }
