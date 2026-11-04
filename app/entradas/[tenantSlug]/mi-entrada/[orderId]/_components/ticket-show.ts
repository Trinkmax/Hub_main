'use client'

import { type RefObject, useEffect, useRef, useState } from 'react'

/**
 * La función de la entrada: lo que pasa cuando se aprueba el pago, contado con
 * cámara. Si todo pasara a la vez, la mitad ocurriría fuera de la pantalla, así que
 * va por actos y la página baja sola para seguirlos:
 *
 *   0  El papel en blanco.
 *   1  El sello: baja, golpea y deja la tinta.
 *   2  La página baja al talón y el QR se genera renglón por renglón.
 *   3  La página sigue bajando mientras se imprime el comprobante.
 *   4  Terminó: aparecen las acciones (guardar, agendar…).
 *
 * Los actos son un atributo (`data-act`) y las animaciones viven en entradas.css.
 * Si la persona toca la pantalla la cámara se queda quieta, y los actos siguen: nunca
 * se le pelea el scroll. Con «reducir movimiento» no hay función: arranca en el 4.
 */
export type ShowAct = 0 | 1 | 2 | 3 | 4

// Las duraciones de cada acto. Tienen que coincidir con entradas.css.
const BEFORE_STAMP_MS = 500
const STAMP_MS = 2200
const STAMP_IMPACT_MS = 705
const QR_MS = 3900
const RECEIPT_MS = 4500
const RECEIPT_PRINT_MS = 3400
const CAMERA_MS = 800

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const linear = (t: number) => t

/** Lleva el scroll hasta `y`. Devuelve cómo cancelarlo. */
export function glideTo(y: number, ms: number, ease: (t: number) => number = easeInOut) {
  const from = window.scrollY
  const max = document.documentElement.scrollHeight - window.innerHeight
  const to = Math.min(Math.max(y, 0), Math.max(max, 0))
  const start = performance.now()
  let frame = 0
  const step = (now: number) => {
    const progress = Math.min(1, (now - start) / ms)
    window.scrollTo({ top: from + (to - from) * ease(progress), behavior: 'instant' })
    if (progress < 1) frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
  return () => cancelAnimationFrame(frame)
}

/** Dónde dejar el scroll para que un elemento quede en el centro de la pantalla. */
export function centerOf(el: Element, at = 0.5): number {
  const rect = el.getBoundingClientRect()
  return rect.top + window.scrollY + rect.height / 2 - window.innerHeight * at
}

export function useTicketShow({
  enabled,
  qrReady,
  rootRef,
  onDone,
}: {
  enabled: boolean
  /** En la compra real el QR puede llegar un momento después de aprobarse el pago. */
  qrReady: boolean
  rootRef: RefObject<HTMLElement | null>
  onDone?: () => void
}): ShowAct {
  const [act, setAct] = useState<ShowAct>(enabled ? 0 : 4)
  const cameraFree = useRef(true)
  const cancelCamera = useRef<() => void>(() => undefined)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  const camera = (run: () => () => void) => {
    if (!cameraFree.current) return
    cancelCamera.current()
    cancelCamera.current = run()
  }

  useEffect(() => {
    if (!enabled) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setAct(4)
      return
    }
    const release = () => {
      cameraFree.current = false
      cancelCamera.current()
    }
    for (const type of ['wheel', 'touchstart', 'keydown'] as const) {
      window.addEventListener(type, release, { passive: true, once: true })
    }
    return () => {
      for (const type of ['wheel', 'touchstart', 'keydown'] as const) {
        window.removeEventListener(type, release)
      }
      cancelCamera.current()
    }
  }, [enabled])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `camera` usa solo refs
  useEffect(() => {
    if (!enabled) return
    const root = rootRef.current
    const find = (selector: string) => root?.querySelector(selector) ?? null
    const timers: Array<ReturnType<typeof setTimeout>> = []
    const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms))

    if (act === 0) {
      later(() => setAct(1), BEFORE_STAMP_MS)
    } else if (act === 1) {
      const seal = find('.ent-seal')
      if (seal) camera(() => glideTo(centerOf(seal, 0.42), 500))
      later(() => {
        if (typeof navigator.vibrate === 'function') navigator.vibrate(40)
      }, STAMP_IMPACT_MS)
      later(() => setAct(2), STAMP_MS)
    } else if (act === 2) {
      const stub = find('.ent-half-stub')
      if (stub) camera(() => glideTo(centerOf(stub), CAMERA_MS))
      if (qrReady) later(() => setAct(3), QR_MS)
    } else if (act === 3) {
      const receipt = find('.ent-receipt')
      if (!receipt) {
        setAct(4)
      } else {
        // Primero un paneo hasta donde arranca el papel; después baja al ritmo de la
        // impresora, con el renglón que se está imprimiendo siempre a la vista.
        const rect = receipt.getBoundingClientRect()
        const top = rect.top + window.scrollY
        const vh = window.innerHeight
        const start = top - vh * 0.2
        const end = top + rect.height - vh + 96
        camera(() => glideTo(start, 650))
        if (end > start) {
          later(() => camera(() => glideTo(end, RECEIPT_PRINT_MS - 250, linear)), 650)
        }
        later(() => setAct(4), RECEIPT_MS)
      }
    } else {
      const save = find('.ent-save')
      if (save) camera(() => glideTo(centerOf(save, 0.55), 1000))
      later(() => doneRef.current?.(), 1000)
    }
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [act, enabled, qrReady, rootRef])

  return act
}
