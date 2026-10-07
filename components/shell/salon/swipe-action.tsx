'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

type SwipeActionProps = {
  children: ReactNode
  className?: string
  /** Acción que se dispara al swipear lo suficiente. */
  onAction: () => void
  /** Threshold en px para disparar la acción. Default 110. */
  threshold?: number
  /** Contenido del slot izquierdo que se revela en el swipe (label + ícono). */
  actionLabel: ReactNode
  /** Color del slot. Default destructive (terracotta). */
  tone?: 'destructive' | 'success' | 'primary'
}

const TONE_BG: Record<NonNullable<SwipeActionProps['tone']>, string> = {
  destructive: 'bg-destructive text-destructive-foreground',
  success: 'bg-success text-success-foreground',
  primary: 'bg-primary text-primary-foreground',
}

export function SwipeAction({
  children,
  className,
  onAction,
  threshold = 110,
  actionLabel,
  tone = 'destructive',
}: SwipeActionProps) {
  const startX = useRef<number | null>(null)
  const [offset, setOffset] = useState(0)
  const triggered = useRef(false)

  useEffect(() => {
    triggered.current = false
  }, [])

  const onTouchStart = (event: React.TouchEvent) => {
    startX.current = event.touches[0]?.clientX ?? null
    triggered.current = false
  }

  const onTouchMove = (event: React.TouchEvent) => {
    if (startX.current === null) return
    const x = event.touches[0]?.clientX ?? 0
    const delta = x - startX.current
    if (delta < 0) {
      setOffset(Math.max(-threshold * 1.4, delta))
    } else {
      setOffset(0)
    }
  }

  const onTouchEnd = () => {
    if (startX.current === null) return
    const should = offset <= -threshold && !triggered.current
    startX.current = null
    if (should) {
      triggered.current = true
      onAction()
    }
    setOffset(0)
  }

  const intensity = Math.min(1, Math.abs(offset) / threshold)

  return (
    <div className="relative isolate overflow-hidden rounded-xl">
      <div
        aria-hidden
        className={cn(
          'absolute inset-0 flex items-center justify-end gap-2 px-5 text-sm font-semibold uppercase tracking-wide',
          TONE_BG[tone],
        )}
        style={{ opacity: intensity }}
      >
        {actionLabel}
      </div>
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className={cn('relative z-10', className)}
        style={{
          transform: `translateX(${offset}px)`,
          transition: offset === 0 ? 'transform var(--duration-base) var(--ease-out)' : 'none',
        }}
      >
        {children}
      </div>
    </div>
  )
}
