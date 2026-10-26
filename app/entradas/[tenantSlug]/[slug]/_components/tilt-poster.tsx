'use client'

import { type ReactNode, useEffect, useRef } from 'react'

/**
 * El afiche sigue al mouse con un poco de inercia (como un cartel colgado que
 * se mueve), solo con mouse fino y sin «reducir movimiento». Es decoración:
 * con el dedo o sin JS queda quieto y no pasa nada.
 *
 * Interpolación propia con requestAnimationFrame (resorte crítico simple) y
 * transform directo sobre el elemento: nada de estado de React por frame.
 */
export function TiltPoster({ children, className }: { children: ReactNode; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = wrap.current
    const target = card.current
    if (!el || !target) return
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!fine || reduce) return

    let raf = 0
    let goalX = 0
    let goalY = 0
    let x = 0
    let y = 0

    const tick = () => {
      x += (goalX - x) * 0.12
      y += (goalY - y) * 0.12
      target.style.transform = `perspective(900px) rotateX(${y.toFixed(2)}deg) rotateY(${x.toFixed(2)}deg)`
      if (Math.abs(goalX - x) > 0.01 || Math.abs(goalY - y) > 0.01) {
        raf = requestAnimationFrame(tick)
      } else {
        raf = 0
      }
    }
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick)
    }
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width - 0.5
      const py = (e.clientY - r.top) / r.height - 0.5
      goalX = px * 14
      goalY = -py * 12
      kick()
    }
    const onLeave = () => {
      goalX = 0
      goalY = 0
      kick()
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div ref={wrap} className={className}>
      <div ref={card} className="will-change-transform [transform-style:preserve-3d]">
        {children}
      </div>
    </div>
  )
}
