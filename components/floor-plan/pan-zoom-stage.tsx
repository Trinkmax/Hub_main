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
  /** Id de un elemento DOM (dentro del stage) al que encajar con "Ajustar". */
  fitTargetId?: string
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
 * El scale vigente se lee con `readStageTransform(transformRef)` durante el drag
 * (sin re-render). Los controles +/−/fit usan `zoomIn/zoomOut/centerView` por ref.
 */
export function PanZoomStage({
  width,
  height,
  transformRef,
  interactive = false,
  onBackgroundClick,
  gridSize,
  fitTargetId,
  className,
  children,
}: PanZoomStageProps) {
  const grid = gridSize ?? GRID

  const onZoomIn = () => transformRef.current?.zoomIn()
  const onZoomOut = () => transformRef.current?.zoomOut()
  // "Fit": encaja el contenido (bbox de elementos) si hay target; si no, el stage.
  const onFit = () => {
    const ref = transformRef.current
    if (!ref) return
    const target = fitTargetId ? document.getElementById(fitTargetId) : null
    if (target) ref.zoomToElement(target, undefined, 300, 'easeOut')
    else ref.centerView(undefined, 200, 'easeOut')
  }

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
            {/* Stage: tamaño = área lógica; grilla + viñeta token-driven (light + dark). */}
            <div
              className="fp-canvas relative"
              style={
                {
                  width,
                  height,
                  '--fp-grid': `${grid}px`,
                  '--fp-grid-major': `${grid * 5}px`,
                } as React.CSSProperties
              }
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

export { readStageTransform } from '@/lib/floor-plan/stage-transform'
// Re-exports para que los consumidores importen desde un único lugar junto al
// componente que los necesita (evita duplicar imports). `readStageTransform` vive
// en un módulo puro (testeable) — ver su doc para el porqué del path instance.transformState.
export { stagePointFromClient }
