'use client'

import {
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from 'react'
import { cn } from '@/lib/utils'

/**
 * El único tooltip de un gráfico de Administración. Envuelve el dibujo (que
 * llega ya hecho del server) y muestra el dato de cualquier hijo que traiga
 * `data-tip-title`, `data-tip-value` y, si hace falta, `data-tip-sub`.
 *
 * - **Agrega, nunca esconde**: todo lo que dice ya está en la leyenda-tabla y
 *   en el `aria-label` de la marca. Por eso el globito va `aria-hidden`.
 * - **No hay que acertarle a la marca**: si el dedo o el mouse caen en el aire,
 *   toma la marca más cercana (hasta `snap` px). Una columna de 5 px en un mes
 *   de 31 días se lee igual, y arrastrando el dedo se recorre el mes
 *   (`touch-action: pan-y`: la página sigue bajando con el dedo en vertical).
 * - **Teclado**: cada marca es una parada de Tab (la deja así el server); con
 *   las flechas, Inicio y Fin se pasa de una a otra y Escape cierra.
 * - **Sin estado de React**: el texto se escribe con `textContent` (las
 *   etiquetas son nombres de proveedores y cajas: datos, nunca HTML) y la
 *   posición con `transform`. Mover el mouse no vuelve a renderizar nada.
 * - **Capa superior del navegador** (`popover="manual"`): el globito no lo
 *   recorta una tarjeta con `overflow-hidden` ni lo corre un padre con
 *   `transform` (`stagger-item`, `press-lift`). Si el navegador no tiene
 *   `showPopover`, queda `fixed` y listo.
 * - La marca activa recibe `data-tip-active` para que el dibujo la resalte
 *   (`group-data-[tip-active]/mark:…`).
 */

const MARK = '[data-tip-title]'
const ANCHOR = '[data-tip-anchor]'
/** Aire entre el globito y la marca, y contra el borde de la pantalla. */
const GAP = 8

export type ChartTipProps = {
  children: ReactNode
  className?: string
  /**
   * `true` (default): arrastrar el dedo en horizontal recorre las marcas.
   * `false` para dibujos que no son una fila de columnas o que viven dentro de
   * algo que se desliza de costado.
   */
  scrub?: boolean
  /** Hasta cuántos px de una marca cuenta como tocarla. */
  snap?: number
}

export function ChartTip({ children, className, scrub = true, snap = 16 }: ChartTipProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLParagraphElement>(null)
  const valueRef = useRef<HTMLParagraphElement>(null)
  const subRef = useRef<HTMLParagraphElement>(null)
  const activeRef = useRef<HTMLElement | null>(null)

  const hide = useCallback(() => {
    const tip = tipRef.current
    activeRef.current?.removeAttribute('data-tip-active')
    activeRef.current = null
    if (!tip) return
    tip.removeAttribute('data-open')
    try {
      tip.hidePopover?.()
    } catch {
      // Ya estaba cerrado: no hay nada que hacer.
    }
  }, [])

  const show = useCallback((mark: HTMLElement) => {
    const tip = tipRef.current
    if (!tip || activeRef.current === mark) return
    activeRef.current?.removeAttribute('data-tip-active')
    activeRef.current = mark
    mark.setAttribute('data-tip-active', '')

    const write = (el: HTMLElement | null, text: string | undefined) => {
      if (!el) return
      el.textContent = text ?? ''
      el.hidden = !text
    }
    write(titleRef.current, mark.dataset.tipTitle)
    write(valueRef.current, mark.dataset.tipValue)
    write(subRef.current, mark.dataset.tipSub)

    tip.setAttribute('data-open', '')
    try {
      tip.showPopover?.()
    } catch {
      // Ya estaba abierto (otra marca del mismo gráfico): solo cambia de lugar.
    }

    // Arriba de lo que se ve de la marca (la barra, el punto) y centrado; si no
    // entra arriba, abajo. Nunca se sale de la pantalla por los costados.
    const anchor = mark.querySelector<HTMLElement>(ANCHOR) ?? mark
    const rect = anchor.getBoundingClientRect()
    const width = tip.offsetWidth
    const height = tip.offsetHeight
    const maxX = Math.max(GAP, window.innerWidth - width - GAP)
    const x = Math.min(maxX, Math.max(GAP, rect.left + rect.width / 2 - width / 2))
    const above = rect.top - height - GAP
    const y = above >= GAP ? above : rect.bottom + GAP
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
  }, [])

  /** La marca bajo el puntero o, si cayó en el aire, la más cercana. */
  const markAt = useCallback(
    (target: EventTarget | null, clientX: number, clientY: number): HTMLElement | null => {
      const root = rootRef.current
      if (!root) return null
      if (target instanceof Element) {
        const direct = target.closest<HTMLElement>(MARK)
        if (direct && root.contains(direct)) return direct
      }
      let best: HTMLElement | null = null
      let bestDistance = snap
      for (const el of root.querySelectorAll<HTMLElement>(MARK)) {
        const r = el.getBoundingClientRect()
        const dx = Math.max(r.left - clientX, 0, clientX - r.right)
        const dy = Math.max(r.top - clientY, 0, clientY - r.bottom)
        const distance = Math.hypot(dx, dy)
        if (distance < bestDistance) {
          best = el
          bestDistance = distance
        }
      }
      return best
    },
    [snap],
  )

  // Con el dedo el globito queda puesto al soltar (no hay «hover» del que
  // salir): se va al tocar afuera o al desplazar la página, que lo dejaría
  // apuntando a cualquier lado.
  useEffect(() => {
    const onOutside = (e: Event) => {
      const root = rootRef.current
      if (!activeRef.current || !root) return
      if (e.target instanceof Node && root.contains(e.target)) return
      hide()
    }
    const onScroll = () => {
      if (activeRef.current) hide()
    }
    document.addEventListener('pointerdown', onOutside)
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('pointerdown', onOutside)
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onScroll)
      hide()
    }
  }, [hide])

  function onPointer(e: PointerEvent<HTMLDivElement>) {
    const mark = markAt(e.target, e.clientX, e.clientY)
    if (mark) show(mark)
    else if (e.pointerType === 'mouse') hide()
  }

  function onPointerLeave(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse') return
    // Si el foco del teclado sigue en una marca, el globito vuelve a ella.
    const focused = document.activeElement
    const root = rootRef.current
    if (focused instanceof HTMLElement && root?.contains(focused) && focused.matches(MARK)) {
      show(focused)
    } else hide()
  }

  function onFocus(e: FocusEvent<HTMLDivElement>) {
    const mark = e.target.closest<HTMLElement>(MARK)
    if (mark) show(mark)
  }

  function onBlur(e: FocusEvent<HTMLDivElement>) {
    const next = e.relatedTarget
    if (next instanceof HTMLElement && next.closest(MARK) && rootRef.current?.contains(next)) return
    hide()
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      hide()
      return
    }
    const root = rootRef.current
    const current = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(MARK) : null
    if (!root || !current) return
    const marks = Array.from(root.querySelectorAll<HTMLElement>(MARK))
    const at = marks.indexOf(current)
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = at + 1
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = at - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = marks.length - 1
    else return
    const target = marks[next]
    if (!target) return
    // Las flechas mueven el foco entre marcas, no la página.
    e.preventDefault()
    target.focus()
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: solo escucha; lo que se enfoca y se lee son las marcas de adentro, cada una con su rol y su aria-label
    <div
      ref={rootRef}
      className={cn('relative', scrub && 'touch-pan-y', className)}
      onPointerMove={onPointer}
      onPointerDown={onPointer}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      {children}
      <div
        ref={tipRef}
        popover="manual"
        aria-hidden="true"
        className="pointer-events-none fixed top-0 right-auto bottom-auto left-0 z-50 m-0 hidden w-max max-w-[min(16rem,calc(100vw-1rem))] overflow-visible rounded-md border border-border bg-popover px-2.5 py-2 text-left text-xs leading-snug text-popover-foreground shadow-[0_8px_32px_-12px_rgb(0_0_0/0.5)] data-[open]:block"
      >
        <p ref={titleRef} className="text-[11px] text-muted-foreground" />
        <p ref={valueRef} className="font-medium tabular-nums" />
        <p ref={subRef} className="whitespace-pre-line tabular-nums text-muted-foreground" />
      </div>
    </div>
  )
}
