'use client'

import { ChevronUp, Wallet } from 'lucide-react'
import { useCallback, useRef } from 'react'

// El "labio" del club para el cliente que TODAVÍA no es socio.
//
// Antes era un <button> con sólo `onClick`, pero dibujado EXACTAMENTE como el asa
// del cajón de la billetera (mismo pill de arrastre, mismo chevron hacia arriba):
// prometía un gesto que no existía. En iOS era peor — sin `touch-action: none`,
// Safari trataba el deslizamiento como scroll de la página y cancelaba el click,
// así que deslizar hacia arriba no hacía absolutamente NADA.
//
// Ahora el labio sigue al dedo (con resistencia elástica) y al soltar abre el
// ClubSheet por distancia o por envión, con la misma física que el cajón de la
// billetera (wallet-drawer.tsx). El tap y el teclado siguen abriendo igual.

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)' // easeOutQuint, igual que el cajón
const FLICK = 0.35 // px/ms hacia arriba: un envión abre aunque el arrastre sea corto
const OPEN_DY = 28 // px arrastrados hacia arriba para confirmar la apertura
const MAX_LIFT = 64 // tope elástico: el labio no se despega de abajo
const SETTLE_MS = 320

/** Resistencia elástica: cada px de arrastre levanta menos (asíntota en MAX_LIFT). */
function rubber(dy: number): number {
  return (1 - 1 / ((dy * 0.7) / MAX_LIFT + 1)) * MAX_LIFT
}

type Drag = { startY: number; lastY: number; lastT: number; v: number; moved: boolean }

export function ClubLip({ onOpen }: { onOpen: () => void }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  const drag = useRef<Drag | null>(null)
  // Si un gesto ya decidió (abrir o abortar), el `click` que el navegador dispara
  // después NO debe volver a abrir. Un tap puro deja esto en false → lo maneja onClick
  // (que además es el camino del teclado, donde no hay eventos de puntero).
  const handled = useRef(false)

  const lift = useCallback((px: number) => {
    const el = ref.current
    if (el) el.style.transform = px > 0 ? `translateY(${-px}px)` : ''
  }, [])

  const settle = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.transition = `transform ${SETTLE_MS}ms ${EASE}`
    el.style.transform = ''
    window.setTimeout(() => {
      if (ref.current) ref.current.style.transition = ''
    }, SETTLE_MS + 40)
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    if (ref.current) ref.current.style.transition = 'none'
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // sin puntero activo (ej. evento sintético) → seguimos sin captura
    }
    handled.current = false
    drag.current = { startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, v: 0, moved: false }
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const d = drag.current
      if (!d) return
      const dy = d.startY - e.clientY // > 0 = hacia arriba
      if (Math.abs(dy) > 4) d.moved = true
      lift(dy > 0 ? rubber(dy) : 0)
      d.v = (e.clientY - d.lastY) / Math.max(1, e.timeStamp - d.lastT)
      d.lastY = e.clientY
      d.lastT = e.timeStamp
    },
    [lift],
  )

  const release = useCallback((e: React.PointerEvent<HTMLButtonElement>): Drag | null => {
    const d = drag.current
    if (!d) return null
    drag.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // el puntero ya pudo haberse liberado
    }
    return d
  }, [])

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const d = release(e)
      if (!d) return
      settle()
      if (!d.moved) return // tap puro → lo abre onClick
      handled.current = true // hubo gesto: el click posterior no re-dispara
      const dy = d.startY - e.clientY
      if (dy > OPEN_DY || d.v < -FLICK) onOpen()
    },
    [onOpen, release, settle],
  )

  // Cancelado por el sistema (llamada entrante, gesto del SO): vuelve a su lugar, no abre.
  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const d = release(e)
      if (!d) return
      handled.current = d.moved
      settle()
    },
    [release, settle],
  )

  const onClick = useCallback(() => {
    if (handled.current) {
      handled.current = false
      return
    }
    onOpen()
  }, [onOpen])

  return (
    // Misma geometría que el labio del cajón de la billetera (wallet-drawer): para
    // el cliente es la MISMA superficie de abajo, sólo cambia qué levanta.
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
      <button
        ref={ref}
        type="button"
        aria-label="Sumate al club"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={onClick}
        className="group pointer-events-auto flex min-h-[calc(3.5rem_+_env(safe-area-inset-bottom))] w-full cursor-grab touch-none select-none flex-col items-center gap-1.5 rounded-t-[1.75rem] bg-[color:var(--brand-accent,var(--primary))] px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2.5 text-[color:var(--brand-accent-foreground,var(--primary-foreground))] shadow-[0_-24px_60px_-24px_rgba(0,0,0,0.5)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 active:cursor-grabbing active:scale-[0.995]"
      >
        <span className="h-1.5 w-10 rounded-full bg-current/40" aria-hidden />
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Wallet className="size-4" aria-hidden />
          Sumate al club
          <ChevronUp className="wallet-hint-bob size-4" aria-hidden />
        </span>
      </button>
    </nav>
  )
}
