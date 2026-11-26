/**
 * El teclado numérico de cada estación — PURO y testeado (`tests/lib/pos-kitchen-keypad.test.ts`).
 *
 * Cada estación (cocina, barra, pizzeros) marca los estados con un teclado numérico USB, sin tocar la
 * pantalla. Se usa como una calculadora: el número de la mesa y Enter.
 *
 *   12 Enter   la comanda de la mesa 12 avanza un paso (Nuevo → En preparación → Listo)
 *   Enter      avanza la que está enmarcada (la más vieja sin terminar: lo próximo que tiene que salir)
 *   12 +       la 12 queda lista de una (una gaseosa no pasa por «en preparación»)
 *   12 −       la 12 vuelve un paso atrás (también si ya estaba en «Listos»)
 *   −          recién apretado Enter: deshace eso. Si no, vuelve atrás la enmarcada
 *   .  ó  ⌫    borra lo tecleado
 *   *  /       en el pase (varias estaciones en una tele): pasa a la estación siguiente / anterior
 *   flechas    mueven el marco (el control remoto de un TV box también sirve)
 *
 * Mientras se teclea, el marco salta a esa mesa: se ve cuál va a cambiar ANTES de apretar Enter.
 *
 * Las teclas se reconocen por su lugar físico (`code`), no por lo que escriben: con «Bloq Num» apagado
 * el 4 del teclado numérico manda «flecha izquierda», y tiene que seguir siendo un 4.
 */

export type KeypadKey =
  | { kind: 'digit'; digit: string }
  | { kind: 'enter' }
  | { kind: 'ready' }
  | { kind: 'back' }
  | { kind: 'clear' }
  | { kind: 'pane'; step: 1 | -1 }
  | { kind: 'move'; direction: 'up' | 'down' | 'left' | 'right' }

type KeyEventLike = {
  key: string
  code?: string
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

const ARROWS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
} as const

/** Qué tecla del teclado de cocina es. Con Ctrl, Alt o ⌘ es un atajo del navegador: no es nuestra. */
export function keypadKey(event: KeyEventLike): KeypadKey | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null
  const code = event.code ?? ''

  // El teclado numérico, por lugar: vale con «Bloq Num» prendido o apagado.
  const numpad = /^Numpad(\d)$/.exec(code)
  if (numpad?.[1] !== undefined) return { kind: 'digit', digit: numpad[1] }
  if (code === 'NumpadEnter') return { kind: 'enter' }
  if (code === 'NumpadAdd') return { kind: 'ready' }
  if (code === 'NumpadSubtract') return { kind: 'back' }
  if (code === 'NumpadDecimal' || code === 'NumpadComma') return { kind: 'clear' }
  if (code === 'NumpadMultiply') return { kind: 'pane', step: 1 }
  if (code === 'NumpadDivide') return { kind: 'pane', step: -1 }

  // Cualquier otro teclado (una notebook, la botonera de flechas, el control de un TV box).
  const key = event.key
  if (/^\d$/.test(key)) return { kind: 'digit', digit: key }
  if (key === 'Enter' || key === ' ' || key === 'Spacebar') return { kind: 'enter' }
  if (key === '+') return { kind: 'ready' }
  if (key === '-') return { kind: 'back' }
  if (key === 'Backspace' || key === 'Delete' || key === 'Clear' || key === '.' || key === ',') {
    return { kind: 'clear' }
  }
  if (key === '*') return { kind: 'pane', step: 1 }
  if (key === '/') return { kind: 'pane', step: -1 }
  // Mayúscula + Tab queda para quien navega con teclado: entra a los controles de la pantalla.
  if (key === 'Tab') return event.shiftKey ? null : { kind: 'pane', step: 1 }
  if (key in ARROWS) return { kind: 'move', direction: ARROWS[key as keyof typeof ARROWS] }
  return null
}

/** Lo que se lleva tecleado y cuándo fue la última tecla. */
export type KeypadState = { typed: string; at: number }
export const KEYPAD_IDLE: KeypadState = { typed: '', at: 0 }

/** Un número a medio teclear se olvida solo: nadie avanza una mesa por un dígito de hace un rato. */
export const TYPED_FORGET_MS = 6000
/** Las mesas tienen hasta tres cifras. Una cuarta empieza un número nuevo. */
export const TYPED_MAX = 3

export type KeypadAction =
  /** Se tecleó una cifra: el marco va a esa mesa, si está. */
  | { type: 'preview'; typed: string }
  /** Enter: un paso adelante. Sin número, la enmarcada. */
  | { type: 'advance'; typed: string | null }
  /** +: lista de una. */
  | { type: 'ready'; typed: string | null }
  /** −: un paso atrás (o deshacer lo último, si no hay número). */
  | { type: 'back'; typed: string | null }
  /** Se borró lo tecleado. */
  | { type: 'clear' }
  | { type: 'pane'; step: 1 | -1 }
  | { type: 'move'; direction: 'up' | 'down' | 'left' | 'right' }

/** Lo tecleado que todavía vale (lo viejo se olvida). */
export function liveTyped(state: KeypadState, nowMs: number): string {
  return state.typed !== '' && nowMs - state.at <= TYPED_FORGET_MS ? state.typed : ''
}

/** Una tecla: cómo queda lo tecleado y qué hay que hacer. */
export function keypadPress(
  state: KeypadState,
  key: KeypadKey,
  nowMs: number,
): { state: KeypadState; action: KeypadAction } {
  const typed = liveTyped(state, nowMs)
  switch (key.kind) {
    case 'digit': {
      // Un cero adelante vale (los códigos propios de lo que no tiene mesa: «01»).
      const next = typed.length >= TYPED_MAX ? key.digit : typed + key.digit
      return { state: { typed: next, at: nowMs }, action: { type: 'preview', typed: next } }
    }
    case 'enter':
      return { state: KEYPAD_IDLE, action: { type: 'advance', typed: typed || null } }
    case 'ready':
      return { state: KEYPAD_IDLE, action: { type: 'ready', typed: typed || null } }
    case 'back':
      return { state: KEYPAD_IDLE, action: { type: 'back', typed: typed || null } }
    case 'clear':
      return { state: KEYPAD_IDLE, action: { type: 'clear' } }
    case 'pane':
      return { state: KEYPAD_IDLE, action: { type: 'pane', step: key.step } }
    case 'move':
      return { state: KEYPAD_IDLE, action: { type: 'move', direction: key.direction } }
  }
}

/** Cuánto dura la ventana de «− deshace lo último» después de una acción. */
export const UNDO_WINDOW_MS = 7000
