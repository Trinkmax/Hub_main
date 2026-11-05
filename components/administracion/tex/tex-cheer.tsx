'use client'

import { useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

const CHEER_MS = 1800
const COLORS = ['#32b8f6', '#0688eb', '#7ed957', '#ffd34d', '#ff8f94', '#fffdf5']
/** Fijos, no al azar: el dibujo del festejo no cambia entre el servidor y el navegador. */
const BITS = [
  [-120, -180],
  [-70, -230],
  [-20, -260],
  [40, -240],
  [95, -200],
  [140, -150],
  [-150, -110],
  [165, -80],
  [-90, -140],
  [60, -160],
  [-35, -190],
  [115, -120],
  [10, -210],
  [-170, -60],
] as const

/** ¿Está festejando? Dura un rato después de que algo salió bien. */
export function useCheering(count: number): boolean {
  const [cheering, setCheering] = useState(false)
  const last = useRef(count)
  useEffect(() => {
    if (count === last.current) return
    last.current = count
    setCheering(true)
    const timer = setTimeout(() => setCheering(false), CHEER_MS)
    return () => clearTimeout(timer)
  }, [count])
  return cheering
}

/** Cuadraditos de colores, como en un juego viejo, solo cuando algo quedó hecho. */
export function TexCheer({ count }: { count: number }) {
  const cheering = useCheering(count)
  const reduced = useReducedMotion()
  if (!cheering || reduced) return null
  return (
    <span aria-hidden className="pointer-events-none absolute top-1/3 left-1/2 z-30">
      {BITS.map(([x, y], index) => (
        <span
          key={`${x}-${y}`}
          className="tex-bit absolute size-2"
          style={
            {
              background: COLORS[index % COLORS.length],
              '--x': `${x}px`,
              '--y': `${y}px`,
              animationDelay: `${index * 18}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  )
}
