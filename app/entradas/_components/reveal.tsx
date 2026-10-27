'use client'

import { type ElementType, type ReactNode, useEffect, useRef } from 'react'

/**
 * Aparece cuando entra en pantalla (una sola vez).
 *
 * Lo que ya está a la vista al cargar NO se esconde: sin JS, o si hidrata
 * tarde, todo se ve igual. Solo lo que está más abajo pasa a «pending» al
 * montar y se revela al llegar (ver [data-reveal] en entradas.css). `index`
 * escalona hermanos (70 ms cada uno).
 */
export function Reveal({
  as: Tag = 'div',
  index = 0,
  className,
  children,
}: {
  as?: ElementType
  index?: number
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const rect = el.getBoundingClientRect()
    if (rect.top < window.innerHeight * 0.92) return

    el.dataset.reveal = 'pending'
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          ;(entry.target as HTMLElement).dataset.reveal = 'shown'
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <Tag ref={ref} className={className} style={{ '--i': index } as React.CSSProperties}>
      {children}
    </Tag>
  )
}
