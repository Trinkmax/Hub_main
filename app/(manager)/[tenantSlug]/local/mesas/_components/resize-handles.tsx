'use client'

import { useRef } from 'react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { RESIZE_MIN, snapToGrid } from '@/lib/floor-plan/grid'
import { cn } from '@/lib/utils'
import { readStageTransform } from './pan-zoom-stage'

type TransformRef = React.RefObject<ReactZoomPanPinchRef | null>

export type ResizeHandlesProps = {
  width: number
  height: number
  transformRef: TransformRef
  /** Rotación del elemento (grados): proyecta el delta de pantalla al eje local. */
  rotation?: number
  onResize: (size: { width: number; height: number }) => void
  onResizeEnd: (size: { width: number; height: number }) => void
}

type Axis = 'se' | 'e' | 's'

// Estado vivo del gesto (refs, no state: no re-render por move).
type DragState = {
  axis: Axis
  startX: number
  startY: number
  startW: number
  startH: number
  last: { width: number; height: number }
}

export function ResizeHandles({
  width,
  height,
  transformRef,
  rotation = 0,
  onResize,
  onResizeEnd,
}: ResizeHandlesProps) {
  const drag = useRef<DragState | null>(null)

  function compute(
    state: DragState,
    e: PointerEvent | React.PointerEvent,
  ): { width: number; height: number } {
    // Scale vigente leído del stage (sin re-render). Fallback a 1 si no montó.
    // OJO: el ref de rzpp no expone `.state` en runtime → usar readStageTransform.
    const { scale } = readStageTransform(transformRef)
    // Delta de pantalla → eje LOCAL del elemento (rotamos el delta por -rotation),
    // luego a px lógicos dividiendo por scale. Sin rotación, es el caso de siempre.
    const dxs = e.clientX - state.startX
    const dys = e.clientY - state.startY
    const rad = (rotation * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const dxLogical = (dxs * cos + dys * sin) / scale
    const dyLogical = (-dxs * sin + dys * cos) / scale
    const nextW =
      state.axis === 's' ? state.startW : Math.max(RESIZE_MIN, snapToGrid(state.startW + dxLogical))
    const nextH =
      state.axis === 'e' ? state.startH : Math.max(RESIZE_MIN, snapToGrid(state.startH + dyLogical))
    return { width: nextW, height: nextH }
  }

  function startResize(axis: Axis) {
    return (e: React.PointerEvent) => {
      // CLAVE: detener la propagación para que el pointer-drag del body del
      // FloorElement no se dispare; el resize es un gesto independiente.
      e.stopPropagation()
      e.preventDefault()
      ;(e.target as Element).setPointerCapture(e.pointerId)
      drag.current = {
        axis,
        startX: e.clientX,
        startY: e.clientY,
        startW: width,
        startH: height,
        last: { width, height },
      }

      // Handlers locales al gesto → referencias estables para add/remove.
      function handlePointerMove(ev: PointerEvent) {
        const state = drag.current
        if (!state) return
        const size = compute(state, ev)
        state.last = size
        onResize(size)
      }

      function handlePointerUpOrCancel(ev: PointerEvent) {
        const state = drag.current
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUpOrCancel)
        window.removeEventListener('pointercancel', handlePointerUpOrCancel)
        const target = ev.target as Element
        if (target.hasPointerCapture?.(ev.pointerId)) {
          target.releasePointerCapture(ev.pointerId)
        }
        drag.current = null
        if (state) onResizeEnd(state.last)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUpOrCancel)
      window.addEventListener('pointercancel', handlePointerUpOrCancel)
    }
  }

  const base = 'absolute z-20 rounded-sm border border-primary bg-background shadow-sm'

  return (
    <>
      {/* Esquina inferior-derecha (ancho + alto) */}
      <div
        role="presentation"
        aria-hidden
        onPointerDown={startResize('se')}
        className={cn(base, 'size-3 -bottom-1.5 -right-1.5 cursor-nwse-resize')}
        style={{ touchAction: 'none' }}
      />
      {/* Borde derecho (solo ancho) */}
      <div
        role="presentation"
        aria-hidden
        onPointerDown={startResize('e')}
        className={cn(base, 'h-3 w-2.5 top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize')}
        style={{ touchAction: 'none' }}
      />
      {/* Borde inferior (solo alto) */}
      <div
        role="presentation"
        aria-hidden
        onPointerDown={startResize('s')}
        className={cn(base, 'h-2.5 w-3 left-1/2 -bottom-1.5 -translate-x-1/2 cursor-ns-resize')}
        style={{ touchAction: 'none' }}
      />
    </>
  )
}
