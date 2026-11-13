'use client'

import { useRef } from 'react'

const MOVE_TOLERANCE = 10

/**
 * «Mantener apretado» sobre un renglón. Devuelve los manejadores para el elemento y `consume()`:
 * el clic que llega al soltar pregunta si ese toque ya fue un «mantener» (y entonces no cuenta).
 * El menú contextual (clic derecho, tecla de menú, o el propio «mantener» en Android) hace lo mismo.
 */
export function useLongPress(onLongPress: () => void, ms = 480) {
  const timer = useRef<number | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  return {
    consume: () => {
      const was = fired.current
      fired.current = false
      return was
    },
    handlers: {
      onPointerDown: (event: React.PointerEvent) => {
        if (event.button !== 0) return
        fired.current = false
        origin.current = { x: event.clientX, y: event.clientY }
        clear()
        timer.current = window.setTimeout(() => {
          timer.current = null
          fired.current = true
          onLongPress()
        }, ms)
      },
      onPointerMove: (event: React.PointerEvent) => {
        const from = origin.current
        if (!from || timer.current === null) return
        // Si el dedo se mueve, está pasando la lista: no es un «mantener».
        if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > MOVE_TOLERANCE) clear()
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
      onContextMenu: (event: React.MouseEvent) => {
        event.preventDefault()
        clear()
        if (fired.current) return
        fired.current = true
        onLongPress()
      },
    },
  }
}
