import { describe, expect, it } from 'vitest'
import {
  KEYPAD_IDLE,
  type KeypadState,
  keypadKey,
  keypadPress,
  liveTyped,
  TYPED_FORGET_MS,
} from '@/lib/pos/kitchen/keypad'

const key = (k: string, code?: string) => keypadKey({ key: k, code })

describe('qué tecla es', () => {
  it('el teclado numérico se reconoce por lugar, con «Bloq Num» prendido o apagado', () => {
    expect(key('4', 'Numpad4')).toEqual({ kind: 'digit', digit: '4' })
    // Apagado, el 4 manda «flecha izquierda»: sigue siendo un 4.
    expect(key('ArrowLeft', 'Numpad4')).toEqual({ kind: 'digit', digit: '4' })
    expect(key('Insert', 'Numpad0')).toEqual({ kind: 'digit', digit: '0' })
    expect(key('Enter', 'NumpadEnter')).toEqual({ kind: 'enter' })
    expect(key('+', 'NumpadAdd')).toEqual({ kind: 'ready' })
    expect(key('-', 'NumpadSubtract')).toEqual({ kind: 'back' })
    expect(key('Delete', 'NumpadDecimal')).toEqual({ kind: 'clear' })
    expect(key('*', 'NumpadMultiply')).toEqual({ kind: 'pane', step: 1 })
    expect(key('/', 'NumpadDivide')).toEqual({ kind: 'pane', step: -1 })
  })

  it('cualquier otro teclado también sirve', () => {
    expect(key('7', 'Digit7')).toEqual({ kind: 'digit', digit: '7' })
    expect(key('Enter', 'Enter')).toEqual({ kind: 'enter' })
    expect(key(' ', 'Space')).toEqual({ kind: 'enter' })
    expect(key('Backspace', 'Backspace')).toEqual({ kind: 'clear' })
    expect(key('ArrowLeft', 'ArrowLeft')).toEqual({ kind: 'move', direction: 'left' })
    expect(key('ArrowDown', 'ArrowDown')).toEqual({ kind: 'move', direction: 'down' })
    expect(key('Tab', 'Tab')).toEqual({ kind: 'pane', step: 1 })
  })

  it('lo que no es del teclado de cocina se deja pasar', () => {
    expect(key('a', 'KeyA')).toBeNull()
    expect(key('F5', 'F5')).toBeNull()
    expect(keypadKey({ key: '7', code: 'Numpad7', ctrlKey: true })).toBeNull()
    expect(keypadKey({ key: 'r', code: 'KeyR', metaKey: true })).toBeNull()
    // Mayúscula + Tab es de quien navega con teclado.
    expect(keypadKey({ key: 'Tab', code: 'Tab', shiftKey: true })).toBeNull()
  })
})

describe('lo que se teclea', () => {
  const press = (state: KeypadState, k: string, code: string, at: number) => {
    const found = keypadKey({ key: k, code })
    if (!found) throw new Error('tecla sin uso')
    return keypadPress(state, found, at)
  }

  it('las cifras se van sumando y el marco las sigue', () => {
    const one = press(KEYPAD_IDLE, '1', 'Numpad1', 1000)
    expect(one.action).toEqual({ type: 'preview', typed: '1' })
    const two = press(one.state, '2', 'Numpad2', 1300)
    expect(two.action).toEqual({ type: 'preview', typed: '12' })
    expect(two.state.typed).toBe('12')
  })

  it('Enter con número avanza esa mesa y limpia; sin número, la enmarcada', () => {
    const typed = press(press(KEYPAD_IDLE, '1', 'Numpad1', 0).state, '2', 'Numpad2', 100)
    const enter = press(typed.state, 'Enter', 'NumpadEnter', 200)
    expect(enter.action).toEqual({ type: 'advance', typed: '12' })
    expect(enter.state).toEqual(KEYPAD_IDLE)
    expect(press(KEYPAD_IDLE, 'Enter', 'NumpadEnter', 300).action).toEqual({
      type: 'advance',
      typed: null,
    })
  })

  it('+ la deja lista de una y − la vuelve atrás', () => {
    const seven = press(KEYPAD_IDLE, '7', 'Numpad7', 0).state
    expect(press(seven, '+', 'NumpadAdd', 100).action).toEqual({ type: 'ready', typed: '7' })
    expect(press(seven, '-', 'NumpadSubtract', 100).action).toEqual({ type: 'back', typed: '7' })
    expect(press(KEYPAD_IDLE, '-', 'NumpadSubtract', 100).action).toEqual({
      type: 'back',
      typed: null,
    })
  })

  it('una cuarta cifra empieza un número nuevo', () => {
    let state = KEYPAD_IDLE
    for (const digit of ['1', '0', '4']) state = press(state, digit, `Numpad${digit}`, 0).state
    expect(state.typed).toBe('104')
    expect(press(state, '9', 'Numpad9', 10).state.typed).toBe('9')
  })

  it('un cero adelante vale: son los códigos de lo que no tiene mesa', () => {
    const zero = press(KEYPAD_IDLE, '0', 'Numpad0', 0)
    expect(press(zero.state, '1', 'Numpad1', 10).state.typed).toBe('01')
  })

  it('lo tecleado se olvida solo: un dígito viejo no avanza ninguna mesa', () => {
    const one = press(KEYPAD_IDLE, '1', 'Numpad1', 0).state
    expect(liveTyped(one, TYPED_FORGET_MS)).toBe('1')
    expect(liveTyped(one, TYPED_FORGET_MS + 1)).toBe('')
    // Enter mucho después: es para la enmarcada, no para la «1».
    expect(press(one, 'Enter', 'NumpadEnter', TYPED_FORGET_MS + 500).action).toEqual({
      type: 'advance',
      typed: null,
    })
    // Y una cifra nueva empieza de cero.
    expect(press(one, '5', 'Numpad5', TYPED_FORGET_MS + 500).state.typed).toBe('5')
  })

  it('borrar, cambiar de estación y mover el marco dejan de teclear', () => {
    const one = press(KEYPAD_IDLE, '1', 'Numpad1', 0).state
    expect(press(one, '.', 'NumpadDecimal', 10)).toEqual({
      state: KEYPAD_IDLE,
      action: { type: 'clear' },
    })
    expect(press(one, '*', 'NumpadMultiply', 10)).toEqual({
      state: KEYPAD_IDLE,
      action: { type: 'pane', step: 1 },
    })
    expect(press(one, 'ArrowRight', 'ArrowRight', 10)).toEqual({
      state: KEYPAD_IDLE,
      action: { type: 'move', direction: 'right' },
    })
  })
})
