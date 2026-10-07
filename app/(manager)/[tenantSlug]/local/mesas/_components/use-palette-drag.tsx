'use client'

import { useRef } from 'react'

type Kind = 'table' | 'wall' | 'pillar' | 'island' | 'bar' | 'door' | 'text' | 'stage'

type TransformRef = React.RefObject<HTMLDivElement | null>

export type UsePaletteDragArgs = {
  /** Wrapper del stage (para medir su rect y validar que el drop cae adentro). */
  wrapperRef: TransformRef
  /** Crea el elemento en el punto de pantalla soltado (el editor convierte a coords lógicas). */
  onDrop: (kind: Kind, clientX: number, clientY: number) => void
}

// Umbral de pantalla para distinguir tap (agregar al centro) de drag (soltar en el punto).
const THRESHOLD = 6

/**
 * Drag-from-palette con **pointer events** (funciona en mouse Y touch — el HTML5
 * drag-and-drop no dispara en tablet/celular). Pinta un "ghost" siguiendo al
 * puntero de forma imperativa (sin re-render por frame → listeners estables, como
 * el resize). Al soltar dentro del stage llama `onDrop`. Un tap (sin mover) NO
 * dropea: lo maneja el `onClick` de la chip (agregar al centro), y este hook
 * suprime ese click cuando hubo un drag real (`shouldSuppressClick`).
 */
export function usePaletteDrag({ wrapperRef, onDrop }: UsePaletteDragArgs) {
  const ghostRef = useRef<HTMLDivElement>(null)
  // Tras un drag real, el `click` que sigue (mouse/touch) se ignora una vez.
  const suppressClick = useRef(false)

  const onChipPointerDown = (kind: Kind, label: string, e: React.PointerEvent) => {
    if (e.button !== 0) return
    const startX = e.clientX
    const startY = e.clientY
    let moved = false
    const ghost = ghostRef.current

    function move(ev: PointerEvent) {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.hypot(dx, dy) < THRESHOLD) return
      moved = true
      if (ghost) {
        ghost.textContent = label
        ghost.style.display = 'flex'
        // Offset leve respecto al puntero/dedo para que el ghost no quede tapado.
        ghost.style.transform = `translate3d(${ev.clientX + 10}px, ${ev.clientY + 10}px, 0)`
      }
    }

    function up(ev: PointerEvent) {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (ghost) ghost.style.display = 'none'
      if (!moved) return
      // pointercancel (gesto interrumpido por el sistema): abortar sin dropear ni
      // suprimir el click — no le sigue un click, así no se "pega" suppressClick.
      if (ev.type !== 'pointerup') return
      // Hubo drag real → suprimir el click que dispara el navegador a continuación.
      suppressClick.current = true
      const wrap = wrapperRef.current
      if (!wrap) return
      const r = wrap.getBoundingClientRect()
      const inside =
        ev.clientX >= r.left &&
        ev.clientX <= r.right &&
        ev.clientY >= r.top &&
        ev.clientY <= r.bottom
      if (inside) onDrop(kind, ev.clientX, ev.clientY)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  /** Devuelve true (y se auto-resetea) si el click viene de un drag recién terminado. */
  const shouldSuppressClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false
      return true
    }
    return false
  }

  // Ghost único, fixed y oculto por default; se muestra/posiciona imperativamente.
  const ghostNode = (
    <div
      ref={ghostRef}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[60] hidden select-none items-center rounded-md border border-primary/30 bg-primary px-2 py-1 text-xs font-medium text-primary-foreground shadow-lg"
      style={{ display: 'none' }}
    />
  )

  return { onChipPointerDown, shouldSuppressClick, ghostNode }
}
