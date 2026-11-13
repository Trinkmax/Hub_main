/**
 * Los dos botones de la cocina — PURO y testeado.
 *
 * La caja de botones (Bluetooth o USB) llega como un teclado. Son exactamente dos:
 *   · «Siguiente» mueve el marco a la comanda que sigue;
 *   · «Avanzar» hace avanzar la comanda enmarcada, y mantenido la vuelve un paso atrás.
 */

export type KitchenButton = 'next' | 'advance'

/** Cuánto hay que mantener «Avanzar» para que deshaga en vez de avanzar. */
export const HOLD_MS = 700
/** Recién ahí se muestra el progreso: un toque normal no llega a verlo. */
export const HOLD_HINT_MS = 170

const NEXT_KEYS = new Set(['ArrowRight', 'n', 'N', 'Tab'])
const ADVANCE_KEYS = new Set(['Enter', ' ', 'Spacebar', 'a', 'A'])

/** Qué botón es una tecla. Con Ctrl, Alt o ⌘ es un atajo del navegador, no un botón. */
export function buttonForKey(
  key: string,
  modifiers: { ctrl?: boolean; alt?: boolean; meta?: boolean; shift?: boolean } = {},
): KitchenButton | null {
  if (modifiers.ctrl || modifiers.alt || modifiers.meta) return null
  // Mayúscula + Tab queda para quien navega con teclado: entra a los controles de la pantalla.
  if (key === 'Tab' && modifiers.shift) return null
  if (NEXT_KEYS.has(key)) return 'next'
  if (ADVANCE_KEYS.has(key)) return 'advance'
  return null
}

/** Qué fue una pulsación de «Avanzar» según cuánto duró. */
export function pressKind(heldMs: number): 'tap' | 'hold' {
  return heldMs >= HOLD_MS ? 'hold' : 'tap'
}

/** Cuánto del recorrido lleva una pulsación mantenida, de 0 a 1. */
export function holdProgress(heldMs: number): number {
  if (!(heldMs > 0)) return 0
  return Math.min(1, heldMs / HOLD_MS)
}
