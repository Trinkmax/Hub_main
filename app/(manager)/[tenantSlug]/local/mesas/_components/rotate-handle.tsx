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
  /** Con teclado (Enter / Espacio sobre la manija): un paso de 15°. */
  onStep: () => void
}

/**
 * Manija de giro: un botón redondo sobre el borde de arriba de la caja.
 * Calcula el ángulo centro→puntero (independiente de zoom/pan) y gira en vivo;
 * con Shift salta de a 15°. Mismo patrón de gesto que ResizeHandles
 * (setPointerCapture + listeners en window).
 */
export function RotateHandle({ boxRef, onRotate, onRotateEnd, onStep }: RotateHandleProps) {
  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    let last = 0
    // Solo commiteamos si el puntero se movió (un click sin arrastre NO debe
    // resetear la rotación a 0° — espejo del DRAG_THRESHOLD del body-drag).
    let moved = false

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
    <div className="fpe-rotate">
      {/* Tallo que conecta la manija con la caja. */}
      <span aria-hidden className="fpe-rotate-stem" />
      <button
        type="button"
        onPointerDown={onPointerDown}
        onClick={(e) => {
          if (e.detail === 0) onStep()
        }}
        aria-label="Girar (arrastrá; con Enter gira 15 grados)"
        title="Girar (con Shift, de a 15°)"
        className="fpe-rotate-knob"
      >
        <RotateCw aria-hidden />
      </button>
    </div>
  )
}
