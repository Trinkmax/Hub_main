'use client'

import { useInView, useMotionValue, useSpring } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * Kinds de formato serializables — usalos en lugar de pasar funciones cuando
 * el StatCard / page sea Server Component (las funciones no cruzan RSC).
 */
export type NumberFormatKind =
  | 'integer'
  | 'decimal-1'
  | 'decimal-2'
  | 'currency-cents-ars'
  | 'percent-100'

const formatters: Record<NumberFormatKind, (n: number) => string> = {
  integer: (n) => Intl.NumberFormat('es-AR').format(Math.round(n)),
  'decimal-1': (n) =>
    Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n),
  'decimal-2': (n) =>
    Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n),
  'currency-cents-ars': (n) =>
    `$${(Math.round(n) / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`,
  'percent-100': (n) => `${Math.round(n)}%`,
}

type NumberTickerProps = {
  value: number
  decimalPlaces?: number
  durationMs?: number
  /** Función custom — solo válida en Client Components (no cruza RSC). */
  format?: (n: number) => string
  /** Kind serializable — preferí esto cuando el padre es Server Component. */
  formatKind?: NumberFormatKind
  className?: string
  startOnView?: boolean
  delayMs?: number
}

const defaultFormat = (n: number, decimals: number) =>
  Intl.NumberFormat('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n)

/**
 * Anima un número desde 0 al valor target con spring suave.
 * SSR-safe: pinta el valor final en el primer paint, anima en mount.
 * Honra `prefers-reduced-motion` (skip animación).
 */
export function NumberTicker({
  value,
  decimalPlaces = 0,
  durationMs = 800,
  format,
  formatKind,
  className,
  startOnView = false,
  delayMs = 0,
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const motionValue = useMotionValue(0)
  const stiffness = Math.max(40, Math.min(220, 16000 / durationMs))
  const damping = 25
  const springValue = useSpring(motionValue, { stiffness, damping })
  const inView = useInView(ref, { once: true, margin: '0px' })

  const formatter = useMemo(() => {
    if (format) return format
    if (formatKind) return formatters[formatKind]
    return (n: number) => defaultFormat(n, decimalPlaces)
  }, [format, formatKind, decimalPlaces])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduce) {
      el.textContent = formatter(value)
      return
    }

    if (startOnView && !inView) {
      el.textContent = formatter(0)
      return
    }

    const start = () => motionValue.set(value)
    const t = window.setTimeout(start, delayMs)
    return () => window.clearTimeout(t)
  }, [value, motionValue, inView, startOnView, formatter, delayMs])

  useEffect(() => {
    return springValue.on('change', (latest) => {
      if (ref.current) ref.current.textContent = formatter(latest)
    })
  }, [springValue, formatter])

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {formatter(value)}
    </span>
  )
}
