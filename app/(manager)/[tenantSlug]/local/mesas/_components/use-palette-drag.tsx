'use client'

import { useRef } from 'react'

export type PaletteKind = 'table' | 'wall' | 'pillar' | 'island' | 'bar' | 'door' | 'text' | 'stage'

export type UsePaletteDragArgs = {
  /** El tablero del plano (para medirlo y validar que se soltó adentro). */
  wrapperRef: React.RefObject<HTMLDivElement | null>
  /** Crea el elemento en el punto de pantalla soltado (el editor convierte a coords lógicas). */
  onDrop: (kind: PaletteKind, clientX: number, clientY: number) => void
  /** Cuánto va a ocupar en pantalla lo que se arrastra (su tamaño por el zoom actual). */
  footprint: (kind: PaletteKind) => { width: number; height: number; round: boolean }
}

// Umbral de pantalla para distinguir tap (agregar al centro) de drag (soltar en el punto).
const THRESHOLD = 6

/**
 * Arrastrar desde la paleta con **pointer events** (funciona con mouse Y con
 * dedo — el drag-and-drop de HTML5 no dispara en tablet/celular). Lo que sigue
 * al puntero es la HUELLA de lo que va a caer (su tamaño real con el zoom
 * actual), pintada a mano, sin render por cuadro. Al soltar sobre el tablero
 * llama `onDrop`. Un toque sin mover NO suelta nada: lo maneja el `onClick` del
 * botón (agregar al centro), y este hook suprime ese click cuando hubo un
 * arrastre de verdad (`shouldSuppressClick`).
 */
export function usePaletteDrag({ wrapperRef, onDrop, footprint }: UsePaletteDragArgs) {
  const ghostRef = useRef<HTMLDivElement>(null)
  const ghostLabelRef = useRef<HTMLSpanElement>(null)
  // Tras un drag real, el `click` que sigue (mouse/touch) se ignora una vez.
  const suppressClick = useRef(false)

  const onChipPointerDown = (kind: PaletteKind, label: string, e: React.PointerEvent) => {
    if (e.button !== 0) return
    const startX = e.clientX
    const startY = e.clientY
    let moved = false
    const ghost = ghostRef.current
    let half = { w: 0, h: 0 }

    function move(ev: PointerEvent) {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.hypot(dx, dy) < THRESHOLD) return
      if (ghost && !moved) {
        const size = footprint(kind)
        const width = Math.max(28, size.width)
        const height = Math.max(20, size.height)
        half = { w: width / 2, h: height / 2 }
        ghost.style.width = `${width}px`
        ghost.style.height = `${height}px`
        ghost.style.borderRadius = size.round ? '50%' : '10px'
        if (ghostLabelRef.current) ghostLabelRef.current.textContent = label
        ghost.style.display = 'flex'
      }
      moved = true
      // Centrada en el puntero: ahí mismo va a quedar el centro del elemento.
      if (ghost) {
        ghost.style.transform = `translate3d(${ev.clientX - half.w}px, ${ev.clientY - half.h}px, 0)`
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

  // Una sola huella, fija y oculta; se muestra y se mueve a mano.
  const ghostNode = (
    <div ref={ghostRef} aria-hidden className="fpe-ghost">
      <span ref={ghostLabelRef} />
    </div>
  )

  return { onChipPointerDown, shouldSuppressClick, ghostNode }
}
