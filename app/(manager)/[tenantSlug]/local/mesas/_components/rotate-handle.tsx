'use client'

import { RotateCw } from 'lucide-react'
import { angleFromCenter, snapRotation } from '@/lib/floor-plan/grid'

export type RotateHandleProps = {
  /** Caja del elemento (su centro es el pivote de rotación). */
  boxRef: React.RefObject<HTMLDivElement | null>
  /** Rotación viva durante el gesto (sin commit). */
  onRotate: (deg: number) => void
  /** Rotación final al soltar (commit). Shift snapea a múltiplos de 15°. */
  onRotateEnd: (deg: number) => void
}

/**
 * Handle de rotación: un botón circular sobre el borde superior de la caja.
 * Calcula el ángulo centro→puntero (independiente de zoom/pan) y rota en vivo;
 * con Shift snapea a 15°. Mismo patrón de gesto que ResizeHandles
 * (setPointerCapture + listeners en window).
 */
export function RotateHandle({ boxRef, onRotate, onRotateEnd }: RotateHandleProps) {
  let last = 0
  // Solo commiteamos si el puntero se movió (un click sin arrastre NO debe
  // resetear la rotación a 0° — espejo del DRAG_THRESHOLD del body-drag).
  let moved = false

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)

    function move(ev: PointerEvent) {
      const node = boxRef.current
      if (!node) return
      const r = node.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      let deg = angleFromCenter(cx, cy, ev.clientX, ev.clientY)
      if (ev.shiftKey) deg = snapRotation(deg)
      last = deg
      moved = true
      onRotate(deg)
    }
    function up(ev: PointerEvent) {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const target = ev.target as Element
      if (target.hasPointerCapture?.(ev.pointerId)) target.releasePointerCapture(ev.pointerId)
      if (moved) onRotateEnd(last)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <div className="absolute -top-8 left-1/2 z-30 -translate-x-1/2">
      {/* Tallo que conecta el handle con la caja. */}
      <span
        aria-hidden
        className="absolute left-1/2 top-5 h-3 w-px -translate-x-1/2 bg-primary/60"
      />
      <button
        type="button"
        onPointerDown={onPointerDown}
        aria-label="Rotar"
        title="Rotar (Shift = 15°)"
        className="grid size-5 cursor-grab place-items-center rounded-full border border-primary bg-background text-primary shadow-sm transition-colors hover:bg-primary hover:text-primary-foreground active:cursor-grabbing"
        style={{ touchAction: 'none' }}
      >
        <RotateCw className="size-3" aria-hidden />
      </button>
    </div>
  )
}
