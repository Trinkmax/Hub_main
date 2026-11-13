'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { buttonForKey, HOLD_HINT_MS, HOLD_MS, pressKind } from '@/lib/pos/kitchen/buttons'

type Handlers = {
  onNext: () => void
  /** Toque corto de «Avanzar». */
  onAdvance: () => void
  /** «Avanzar» mantenido. */
  onUndo: () => void
  /** Cualquier pulsación: destraba el sonido y cierra avisos. */
  onPress: () => void
}

type Options = Handlers & {
  /** Apagado mientras hay un menú abierto: ahí las teclas son del menú. */
  enabled: boolean
}

export type TwoButtons = {
  /** Se está manteniendo «Avanzar» lo suficiente como para mostrar el progreso. */
  holding: boolean
  /** Para los botones en pantalla: apretar, soltar y arrepentirse. */
  down: (source: string) => void
  up: (source: string) => void
  cancel: () => void
}

/**
 * Escucha los dos botones de la cocina, lleguen del teclado (la caja de botones) o de la pantalla.
 *
 * «Avanzar» actúa al SOLTAR: es la única forma de distinguir un toque de una pulsación mantenida sin
 * hacer y deshacer. El deshacer, en cambio, sale solo al llegar al tiempo, sin esperar a que suelten.
 */
export function useTwoButtons({
  enabled,
  onNext,
  onAdvance,
  onUndo,
  onPress,
}: Options): TwoButtons {
  const [holding, setHolding] = useState(false)
  const press = useRef<{ source: string; at: number; fired: boolean } | null>(null)
  const timers = useRef<{ hint: number | null; hold: number | null }>({ hint: null, hold: null })
  /** Quien navega con teclado entró a los controles (Mayúscula + Tab): ahí las teclas son las de siempre. */
  const inControls = useRef(false)

  // Siempre la última versión de lo que hay que hacer, sin volver a enganchar el teclado.
  const handlers = useRef<Handlers>({ onNext, onAdvance, onUndo, onPress })
  useEffect(() => {
    handlers.current = { onNext, onAdvance, onUndo, onPress }
  }, [onNext, onAdvance, onUndo, onPress])

  const clearTimers = useCallback(() => {
    if (timers.current.hint !== null) window.clearTimeout(timers.current.hint)
    if (timers.current.hold !== null) window.clearTimeout(timers.current.hold)
    timers.current = { hint: null, hold: null }
  }, [])

  const cancel = useCallback(() => {
    clearTimers()
    press.current = null
    setHolding(false)
  }, [clearTimers])

  const down = useCallback(
    (source: string) => {
      if (press.current) return
      const current = { source, at: performance.now(), fired: false }
      press.current = current
      clearTimers()
      timers.current.hint = window.setTimeout(() => setHolding(true), HOLD_HINT_MS)
      timers.current.hold = window.setTimeout(() => {
        if (press.current !== current) return
        current.fired = true
        setHolding(false)
        handlers.current.onUndo()
      }, HOLD_MS)
    },
    [clearTimers],
  )

  const up = useCallback(
    (source: string) => {
      const current = press.current
      if (!current || current.source !== source) return
      clearTimers()
      press.current = null
      setHolding(false)
      if (current.fired) return
      // En un equipo lento el temporizador puede llegar tarde: lo que vale es cuánto duró la pulsación.
      if (pressKind(performance.now() - current.at) === 'hold') handlers.current.onUndo()
      else handlers.current.onAdvance()
    },
    [clearTimers],
  )

  useEffect(() => {
    if (!enabled) {
      cancel()
      return
    }

    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return
      if (event.key === 'Tab' && event.shiftKey) {
        inControls.current = true
        return
      }
      const focused = document.activeElement
      const hasFocus = focused instanceof HTMLElement && focused !== document.body
      if (event.key === 'Escape') {
        inControls.current = false
        if (hasFocus) focused.blur()
        return
      }
      // Con el foco puesto a mano en un control, Tab, Enter y Espacio hacen lo de siempre.
      if (inControls.current && hasFocus) return
      inControls.current = false

      const button = buttonForKey(event.key, {
        ctrl: event.ctrlKey,
        alt: event.altKey,
        meta: event.metaKey,
        shift: event.shiftKey,
      })
      if (!button) return
      event.preventDefault()
      // Un toque en la pantalla pudo dejar el foco en un botón: que Enter no lo vuelva a apretar.
      if (hasFocus) focused.blur()
      if (event.repeat) return
      handlers.current.onPress()
      if (button === 'next') handlers.current.onNext()
      else down(`key:${event.code || event.key}`)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (inControls.current) return
      if (buttonForKey(event.key) !== 'advance') return
      event.preventDefault()
      up(`key:${event.code || event.key}`)
    }

    const onPointerDown = () => {
      inControls.current = false
    }
    const onHidden = () => {
      if (document.hidden) cancel()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', cancel)
    window.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('visibilitychange', onHidden)
      clearTimers()
    }
  }, [enabled, cancel, clearTimers, down, up])

  return { holding, down, up, cancel }
}
