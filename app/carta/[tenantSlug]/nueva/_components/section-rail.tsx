'use client'

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { CartaSection } from '@/lib/menu/carta'
import { cn } from '@/lib/utils'

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * Las pestañas de las secciones de un rubro. Se quedan pegadas arriba mientras se recorre la página y
 * marcan dónde está parado quien mira: la elegida va rellena, y el relleno se desliza de una a otra.
 * La tira se corre sola para que la elegida quede a la vista.
 */
export function SectionRail({
  sections,
  activeId,
  onSelect,
  className,
}: {
  sections: CartaSection[]
  activeId: string | null
  onSelect: (section: CartaSection) => void
  className?: string
}): React.JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)
  /** La primera vez el relleno aparece en su lugar, sin deslizarse desde la esquina. */
  const placed = useRef(false)

  const placePill = useCallback(() => {
    const scroller = scrollerRef.current
    const pill = pillRef.current
    if (!scroller || !pill) return
    const chip = activeId
      ? scroller.querySelector<HTMLElement>(`[data-chip="${CSS.escape(activeId)}"]`)
      : null
    if (!chip) {
      pill.style.opacity = '0'
      return
    }
    if (!placed.current) pill.style.transition = 'none'
    pill.style.opacity = '1'
    pill.style.width = `${chip.offsetWidth}px`
    pill.style.transform = `translateX(${chip.offsetLeft}px)`
    if (!placed.current) {
      void pill.offsetWidth
      pill.style.transition = ''
      placed.current = true
    }
  }, [activeId])

  useIsoLayoutEffect(() => {
    placePill()
  }, [placePill])

  // Si cambian los anchos (giro del celular, la letra termina de cargar), el relleno se reubica.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const observer = new ResizeObserver(() => placePill())
    observer.observe(scroller)
    for (const chip of scroller.querySelectorAll('[data-chip]')) observer.observe(chip)
    return () => observer.disconnect()
  }, [placePill])

  // La elegida, al centro de la tira.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !activeId) return
    const chip = scroller.querySelector<HTMLElement>(`[data-chip="${CSS.escape(activeId)}"]`)
    if (!chip) return
    const target = chip.offsetLeft - (scroller.clientWidth - chip.offsetWidth) / 2
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scroller.scrollTo({ left: Math.max(0, target), behavior: reduce ? 'auto' : 'smooth' })
  }, [activeId])

  return (
    <div
      ref={scrollerRef}
      className={cn('carta-scroller relative flex items-center gap-1 px-3 sm:px-5', className)}
    >
      <span
        ref={pillRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-1/2 -mt-5 h-10 rounded-full bg-(--carta-green) opacity-0 transition-[transform,width,opacity] duration-[420ms] ease-(--carta-ease) motion-reduce:transition-none"
      />
      {sections.map((section) => {
        const active = section.id === activeId
        return (
          <button
            key={section.id}
            type="button"
            data-chip={section.id}
            aria-current={active ? 'true' : undefined}
            onClick={() => onSelect(section)}
            className={cn(
              'carta-focus relative h-10 shrink-0 rounded-full px-4 text-[0.875rem] font-semibold tracking-[-0.01em] transition-colors duration-200',
              active ? 'text-(--carta-on-green)' : 'text-(--carta-soft)',
            )}
          >
            {section.title}
          </button>
        )
      })}
      {/* Un poco de aire al final: la última pestaña no queda pegada al borde. */}
      <span aria-hidden className="w-1 shrink-0" />
    </div>
  )
}
