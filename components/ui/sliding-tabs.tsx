'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// Segmented control con indicador que SE DESLIZA a la opción activa (rápido:
// duration-base, ease-out). Reutilizable para toggles carta/club, filtros, etc.
// El indicador mide la posición/ancho del tab activo y transiciona left/width.

export type SlidingTab<T extends string> = {
  value: T
  label: React.ReactNode
}

export function SlidingTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  size = 'md',
}: {
  tabs: SlidingTab<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  size?: 'sm' | 'md'
}): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)

  // Medir el tab activo tras cada render/resize para posicionar el indicador.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = () => {
      const active = list.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`)
      if (active) setPill({ left: active.offsetLeft, width: active.offsetWidth })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(list)
    return () => ro.disconnect()
  }, [value, tabs])

  const pad = size === 'sm' ? 'px-3 py-1 text-[13px]' : 'px-3.5 py-1.5 text-sm'

  return (
    <div
      ref={listRef}
      // biome-ignore lint/a11y/useSemanticElements: patrón tablist con botones
      role="tablist"
      className={cn(
        'relative inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary/60 p-1',
        className,
      )}
    >
      {pill ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-1 rounded-full bg-card shadow-sm ring-1 ring-border/50 transition-[left,width] duration-[var(--duration-base)] ease-[var(--ease-out)] motion-reduce:transition-none"
          style={{ left: pill.left, width: pill.width }}
        />
      ) : null}
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          data-value={tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            'relative z-[1] whitespace-nowrap rounded-full font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
            pad,
            value === tab.value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
