'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TotalEntry } from '@/lib/pos/kitchen/cards'
import { fitCount } from '@/lib/pos/kitchen/layout'

/**
 * La tira de arriba: cuánto hay que hacer de cada cosa entre todas las comandas, de más a menos.
 * «8 Bacon · 5 Lomito · 3 Papas»: se cocina por tanda y se emplata por mesa.
 *
 * En la tele ocupa dos renglones fijos; si no entra todo, lo que menos se repite queda en un «+N».
 * En el celular es una sola línea que se corre con el dedo (ahí no se recorta nada).
 */
export function KitchenTotals({ totals, scroll }: { totals: TotalEntry[]; scroll: boolean }) {
  const list = useRef<HTMLUListElement>(null)
  const measuredWidth = useRef(0)
  const key = useMemo(() => totals.map((t) => `${t.menuItemId}:${t.quantity}`).join('|'), [totals])
  // Cuántos entran, medido para este contenido. Sin medida se dibujan todos (y así se miden).
  const [fit, setFit] = useState<{ key: string; count: number } | null>(null)
  const measured = !scroll && fit !== null && fit.key === key
  const count = measured ? fit.count : totals.length
  const empty = totals.length === 0

  useLayoutEffect(() => {
    const element = list.current
    if (!element || scroll || measured || empty) return
    const items = [...element.querySelectorAll<HTMLElement>('[data-total]')]
    const lineHeight = items[0]?.offsetHeight ?? 0
    if (lineHeight === 0) return
    const gap = Number.parseFloat(window.getComputedStyle(element).columnGap) || 0
    const more = element.querySelector<HTMLElement>('[data-more]')?.offsetWidth ?? 0
    measuredWidth.current = element.clientWidth
    setFit({
      key,
      count: fitCount(
        items.map((item) => item.offsetWidth),
        element.clientWidth,
        gap,
        Math.max(1, Math.round(element.clientHeight / lineHeight)),
        more,
      ),
    })
  }, [key, scroll, measured, empty])

  // Si cambia el ancho o llega la letra, la medida anterior no sirve.
  useEffect(() => {
    const element = list.current
    if (!element || scroll || empty) return
    const observer = new ResizeObserver(() => {
      if (Math.abs(element.clientWidth - measuredWidth.current) >= 1) setFit(null)
    })
    observer.observe(element)
    let alive = true
    void document.fonts?.ready.then(() => {
      if (alive) setFit(null)
    })
    return () => {
      alive = false
      observer.disconnect()
    }
  }, [scroll, empty])

  if (empty) {
    return <p className="kds-totals is-empty">Nada para preparar ahora.</p>
  }

  const hidden = totals.length - count
  return (
    <ul
      ref={list}
      className="kds-totals"
      aria-label="Para preparar ahora, entre todas las comandas"
    >
      {totals.slice(0, count).map((total) => (
        <li key={total.menuItemId} className="kds-total" data-total>
          <b>{total.quantity}</b>
          <span>{total.name}</span>
        </li>
      ))}
      {/* Está siempre, aunque no se vea: su ancho dice cuánto lugar hay que guardarle. */}
      <li className="kds-total is-more" data-more data-shown={hidden > 0 ? 'true' : undefined}>
        <b>+{hidden > 0 ? hidden : totals.length}</b>
        <span className="sr-only"> productos más</span>
      </li>
    </ul>
  )
}
