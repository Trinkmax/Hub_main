'use client'

import { type RefObject, useEffect, useLayoutEffect, useState } from 'react'
import { columnsFor, DESIGN, type KitchenMode, modeFor, unitFor } from '@/lib/pos/kitchen/layout'

/**
 * La hora de la base, avanzando acá. El reloj de una tele o de una tablet puede estar corrido: los
 * minutos de cada comanda se cuentan contra la hora que mandó el servidor.
 */
export function useServerNow(serverNow: string, everyMs = 5000): number {
  const [now, setNow] = useState(() => Date.parse(serverNow))
  useEffect(() => {
    const offset = Date.parse(serverNow) - Date.now()
    setNow(Date.now() + offset)
    const timer = window.setInterval(() => setNow(Date.now() + offset), everyMs)
    return () => window.clearInterval(timer)
  }, [serverNow, everyMs])
  return now
}

/** Que la pantalla no se apague sola. Si el navegador no puede, no pasa nada. */
export function useWakeLock(): void {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let gone = false
    const request = async () => {
      if (gone || lock || document.hidden) return
      try {
        const next = await navigator.wakeLock.request('screen')
        if (gone) {
          void next.release().catch(() => {})
          return
        }
        lock = next
        next.addEventListener('release', () => {
          if (lock === next) lock = null
        })
      } catch {
        // batería baja, pestaña sin foco o permiso negado: se vuelve a intentar al volver
      }
    }
    // El navegador lo suelta al esconder la pestaña: hay que pedirlo de nuevo al volver.
    const onVisibility = () => {
      if (!document.hidden) void request()
    }
    void request()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      gone = true
      document.removeEventListener('visibilitychange', onVisibility)
      void lock?.release().catch(() => {})
      lock = null
    }
  }, [])
}

export type KitchenLayout = {
  mode: KitchenMode
  /** Cuántos lugares tiene el riel. En la lista no hay límite. */
  slots: number
  /** La unidad en px (ver `lib/pos/kitchen/layout.ts`). `null` hasta medir: manda el CSS. */
  unit: number | null
  /** Ancho de un lugar y alto libre para una comanda, en unidades. */
  column: number
  room: number
}

/**
 * Mide la pantalla y el riel. Arranca suponiendo la tele (riel de cuatro), que es para lo que se
 * dibujó; en cualquier otra pantalla se corrige antes del primer cuadro.
 */
export function useKitchenLayout(rail: RefObject<HTMLElement | null>): KitchenLayout {
  const [layout, setLayout] = useState<KitchenLayout>({
    mode: 'rail',
    slots: 4,
    unit: null,
    column: 453,
    room: 770,
  })

  useLayoutEffect(() => {
    const measure = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      const unit = unitFor(width, height)
      const mode = modeFor(width, height)
      const element = rail.current
      const railWidth = element?.clientWidth ?? width
      const slots = mode === 'list' ? Number.MAX_SAFE_INTEGER : columnsFor(railWidth, unit)
      const columns = mode === 'list' ? 1 : slots
      const column = Math.round((railWidth / unit - DESIGN.gap * (columns - 1)) / columns)
      let room = 0
      if (element && mode === 'rail') {
        const style = window.getComputedStyle(element)
        const inner =
          element.clientHeight -
          (Number.parseFloat(style.paddingTop) || 0) -
          (Number.parseFloat(style.paddingBottom) || 0)
        room = Math.max(0, Math.round(inner / unit))
      }
      setLayout((prev) =>
        prev.mode === mode &&
        prev.slots === slots &&
        prev.unit === unit &&
        prev.column === column &&
        prev.room === room
          ? prev
          : { mode, slots, unit, column, room },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (rail.current) observer.observe(rail.current)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [rail])

  return layout
}

/**
 * Los talones que no entran en su fila no se muestran cortados: se esconden enteros y se cuenta
 * cuántos son, para decirlo con un «+N». Devuelve esa cuenta.
 */
export function useClipped(list: RefObject<HTMLElement | null>, key: string): number {
  const [hidden, setHidden] = useState(0)

  useLayoutEffect(() => {
    const element = list.current
    // `key` no se usa adentro: está para volver a medir cuando cambia lo que hay en la fila.
    void key
    if (!element) {
      setHidden(0)
      return
    }
    const measure = () => {
      const from = element.scrollLeft
      const to = from + element.clientWidth
      let count = 0
      for (const child of element.children) {
        if (!(child instanceof HTMLElement)) continue
        const out = child.offsetLeft < from - 0.5 || child.offsetLeft + child.offsetWidth > to + 0.5
        child.toggleAttribute('data-clipped', out)
        if (out) count += 1
      }
      setHidden((prev) => (prev === count ? prev : count))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    element.addEventListener('scroll', measure, { passive: true })
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', measure)
    }
  }, [list, key])

  return hidden
}
