'use client'

import { type RefObject, useCallback, useEffect, useState, useSyncExternalStore } from 'react'

/** Angosto (celular parado) o bajito (celular acostado): el panel es una hoja, como en una app. */
export const TEX_PHONE_QUERY = '(max-width: 639px), (max-height: 480px)'

export function isPhoneScreen(): boolean {
  return window.matchMedia(TEX_PHONE_QUERY).matches
}

/** Tex se monta solo en el navegador, así que desde el primer render sabe en qué pantalla está. */
export function useIsPhone(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const list = window.matchMedia(TEX_PHONE_QUERY)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [])
  return useSyncExternalStore(subscribe, isPhoneScreen, () => false)
}

/** Con el dedo: los toques van más grandes y el teclado no se abre solo. */
export function isCoarsePointer(): boolean {
  return window.matchMedia('(pointer: coarse)').matches
}

/** ¿El teclado del celular está abierto? Se sale de cuánto se achicó lo visible. Puro. */
export function keyboardIsOpen(visibleHeight: number, tallestSeen: number): boolean {
  return visibleHeight < tallestSeen * 0.75
}

/**
 * En el celular, `position: fixed` queda atado a la pantalla entera y el teclado le pasa por encima: en
 * iPhone el campo de escribir quedaría tapado. Por eso la hoja se mide con lo que de verdad se ve
 * (`visualViewport`), y sigue al teclado cuando aparece.
 */
export function useSheetViewport(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [keyboard, setKeyboard] = useState(false)
  useEffect(() => {
    const viewport = window.visualViewport
    const element = ref.current
    if (!enabled || !viewport || !element) return
    let tallest = viewport.height
    let width = viewport.width
    const update = () => {
      // Con dos dedos se agranda la pantalla, no se abrió ningún teclado.
      if (viewport.scale > 1.01) return
      // Se dio vuelta el celular: la altura de antes ya no dice nada.
      if (viewport.width !== width) {
        width = viewport.width
        tallest = viewport.height
      }
      tallest = Math.max(tallest, viewport.height)
      element.style.setProperty('--tex-vv-h', `${viewport.height}px`)
      element.style.setProperty('--tex-vv-top', `${viewport.offsetTop}px`)
      setKeyboard(keyboardIsOpen(viewport.height, tallest))
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      element.style.removeProperty('--tex-vv-h')
      element.style.removeProperty('--tex-vv-top')
    }
  }, [ref, enabled])
  return keyboard
}

/** Atrás lo que está atrás de la hoja: la página no se mueve mientras se lee a Tex. */
export function useScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return
    document.documentElement.classList.add('tex-lock')
    return () => document.documentElement.classList.remove('tex-lock')
  }, [locked])
}

/** ¿Este elemento se queda quieto? Fijo, pegado, o en una pantalla que no se corre. */
function staysInPlace(element: Element, pageScrolls: boolean): boolean {
  for (
    let node: Element | null = element;
    node && node !== document.documentElement;
    node = node.parentElement
  ) {
    const style = window.getComputedStyle(node)
    if (style.position === 'fixed' || style.position === 'sticky') return true
    if (
      /(auto|scroll)/.test(style.overflowY) &&
      node.scrollHeight > node.clientHeight + 1 &&
      node !== element
    ) {
      return false
    }
  }
  return !pageScrolls
}

/**
 * Cuánto ocupa la barra de abajo de esta pantalla (las pestañas de Mensajería, la de guardar un
 * formulario), para que Tex se pare arriba y no le tape lo que se está por tocar. Lo demás de la página
 * se corre con el dedo, así que no cuenta.
 */
export function bottomBarHeight(): number {
  const { innerHeight: height, innerWidth: width } = window
  const root = document.scrollingElement
  const pageScrolls = root ? root.scrollHeight > height + 2 : false
  // Tex y los avisos, que se van solos, no son una barra.
  const top = document
    .elementsFromPoint(44, height - 16)
    .find((element) => !element.closest('[data-tex-ui],[data-sonner-toaster]'))
  let bar = 0
  for (let node: Element | null = top ?? null; node && node !== document.body; ) {
    const box = node.getBoundingClientRect()
    if (box.height > height * 0.3) break
    if (box.bottom >= height - 24 && box.width >= width * 0.8 && staysInPlace(node, pageScrolls)) {
      bar = Math.max(bar, height - box.top)
    }
    node = node.parentElement
  }
  return Math.round(bar)
}
