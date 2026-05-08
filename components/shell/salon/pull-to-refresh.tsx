'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

const THRESHOLD = 80 // px que hay que tirar para disparar
const MAX_PULL = 140

/**
 * Wrapper que escucha pull-to-refresh nativo en mobile.
 * - Solo se activa si el scroll está en el tope (scrollTop === 0).
 * - Threshold 80px, max stretch 140px.
 * - Llama `router.refresh()` por default (revalida la ruta server-rendered).
 */
export function PullToRefresh({
  children,
  onRefresh,
}: {
  children: ReactNode
  onRefresh?: () => Promise<void> | void
}) {
  const router = useRouter()
  const startY = useRef<number | null>(null)
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      if (onRefresh) {
        await onRefresh()
      } else {
        router.refresh()
      }
    } finally {
      setTimeout(() => setRefreshing(false), 600)
    }
  }, [onRefresh, router])

  useEffect(() => {
    const onTouchStart = (event: TouchEvent) => {
      if (window.scrollY > 0) return
      startY.current = event.touches[0]?.clientY ?? null
    }

    const onTouchMove = (event: TouchEvent) => {
      if (startY.current === null) return
      const currentY = event.touches[0]?.clientY ?? 0
      const delta = currentY - startY.current
      if (delta <= 0 || window.scrollY > 0) {
        setPullDistance(0)
        return
      }
      const damped = Math.min(MAX_PULL, delta * 0.55)
      setPullDistance(damped)
    }

    const onTouchEnd = () => {
      if (startY.current === null) return
      const should = pullDistance >= THRESHOLD && !refreshing
      startY.current = null
      setPullDistance(0)
      if (should) {
        void handleRefresh()
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [pullDistance, refreshing, handleRefresh])

  const opacity = Math.min(1, pullDistance / THRESHOLD)
  const ready = pullDistance >= THRESHOLD

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-14 z-10 flex justify-center"
        style={{
          transform: `translateY(${refreshing ? THRESHOLD * 0.4 : pullDistance * 0.5}px)`,
          opacity: refreshing ? 1 : opacity,
          transition: refreshing ? 'transform var(--duration-base)' : 'none',
        }}
      >
        <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/90 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
          <Loader2
            className={`size-3.5 ${refreshing ? 'animate-spin text-primary' : ready ? 'text-primary' : ''}`}
            aria-hidden
          />
          {refreshing ? 'Actualizando…' : ready ? 'Soltá para actualizar' : 'Tirá para actualizar'}
        </div>
      </div>
      <div
        style={{
          transform: refreshing
            ? `translateY(${THRESHOLD * 0.5}px)`
            : `translateY(${pullDistance * 0.5}px)`,
          transition: refreshing || pullDistance === 0 ? 'transform var(--duration-base)' : 'none',
        }}
      >
        {children}
      </div>
    </>
  )
}
