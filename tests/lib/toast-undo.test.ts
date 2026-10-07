import { isValidElement, type ReactElement } from 'react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  holdUndoClock,
  keepOpenOnToast,
  keepOpenOnToastWith,
  releaseUndoClock,
  startUndoClock,
  toastUndo,
  UNDO_MIN_RESUME_MS,
  UNDO_MS,
  undoClockDelay,
} from '@/components/ui/toast'

/**
 * Kit HUB §3.4: el «Deshacer» dura lo mismo en toda la app y se queda quieto
 * mientras algo lo retiene (el foco en los avisos, el mouse encima, la pestaña
 * oculta). El reloj es lógica pura; `toastUndo` se prueba contra un sonner de
 * mentira con timers falsos.
 */

vi.mock('sonner', () => ({
  toast: Object.assign(
    vi.fn((_message: unknown, data?: { id?: string | number }) => data?.id ?? 'auto'),
    { dismiss: vi.fn() },
  ),
}))

const toastMock = vi.mocked(toast)
const dismissMock = vi.mocked(toast.dismiss)

type UndoCallData = {
  id: string | number
  duration: number
  action: ReactElement<{ onClick: () => void; children: string }>
  onDismiss: () => void
  onAutoClose: () => void
}

/** Lo que `toastUndo` le pasó a sonner en la llamada `n` (la última por defecto). */
function callData(n = -1): UndoCallData {
  const call = toastMock.mock.calls.at(n)
  if (!call) throw new Error('toast() no se llamó')
  const data = call[1] as unknown as UndoCallData
  if (!isValidElement(data.action)) throw new Error('la acción no es un elemento')
  return data
}

// ─── El reloj ────────────────────────────────────────────────────────────────

describe('reloj del «Deshacer»', () => {
  it('UNDO_MS es 6 s y el piso al soltar, 1 s', () => {
    expect(UNDO_MS).toBe(6000)
    expect(UNDO_MIN_RESUME_MS).toBe(1000)
  })

  it('arranca corriendo con el total y descuenta el tiempo', () => {
    const clock = startUndoClock(6000, 1_000)
    expect(undoClockDelay(clock, 1_000)).toBe(6000)
    expect(undoClockDelay(clock, 3_500)).toBe(3500)
    expect(undoClockDelay(clock, 99_000)).toBe(0)
  })

  it('frenado no corre: guarda lo que faltaba', () => {
    const held = holdUndoClock(startUndoClock(6000, 0), 'focus', 2_000)
    expect(held.remaining).toBe(4000)
    expect(undoClockDelay(held, 50_000)).toBeNull()
  })

  it('frenar dos veces por lo mismo no descuenta dos veces', () => {
    const once = holdUndoClock(startUndoClock(6000, 0), 'hover', 2_000)
    const twice = holdUndoClock(once, 'hover', 5_000)
    expect(twice).toBe(once)
    expect(twice.remaining).toBe(4000)
  })

  it('vuelve a correr recién cuando se suelta todo lo que lo retiene', () => {
    let clock = startUndoClock(6000, 0)
    clock = holdUndoClock(clock, 'hover', 1_000)
    clock = holdUndoClock(clock, 'focus', 2_000)
    clock = releaseUndoClock(clock, 'hover', 10_000)
    expect(undoClockDelay(clock, 10_000)).toBeNull()
    clock = releaseUndoClock(clock, 'focus', 20_000)
    expect(undoClockDelay(clock, 20_000)).toBe(5000)
    expect(undoClockDelay(clock, 22_000)).toBe(3000)
  })

  it('al soltar nunca se va en el mismo instante: piso de 1 s', () => {
    let clock = holdUndoClock(startUndoClock(6000, 0), 'focus', 5_950)
    expect(clock.remaining).toBe(50)
    clock = releaseUndoClock(clock, 'focus', 9_000)
    expect(undoClockDelay(clock, 9_000)).toBe(UNDO_MIN_RESUME_MS)
  })

  it('el piso no estira un aviso más corto que el piso', () => {
    let clock = holdUndoClock(startUndoClock(400, 0), 'hidden', 390)
    clock = releaseUndoClock(clock, 'hidden', 1_000)
    expect(undoClockDelay(clock, 1_000)).toBe(400)
  })

  it('soltar algo que no lo retenía no cambia nada', () => {
    const clock = startUndoClock(6000, 0)
    expect(releaseUndoClock(clock, 'focus', 3_000)).toBe(clock)
  })
})

// ─── keepOpenOnToast ─────────────────────────────────────────────────────────

function outsideEvent(target: EventTarget | null) {
  return { target, preventDefault: vi.fn() }
}

/** Un nodo de mentira: `closest` devuelve algo solo si «está» adentro del Toaster. */
function node(insideToaster: boolean): EventTarget {
  return {
    closest: (selector: string) =>
      insideToaster && selector === '[data-sonner-toaster]' ? { tagName: 'OL' } : null,
  } as unknown as EventTarget
}

describe('keepOpenOnToast', () => {
  it('tocar un aviso no cuenta como afuera', () => {
    const event = outsideEvent(node(true))
    keepOpenOnToast(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('cualquier otro click afuera sigue cerrando', () => {
    const event = outsideEvent(node(false))
    keepOpenOnToast(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('sin target o con un target sin `closest` (un nodo de texto) no hace nada', () => {
    const empty = outsideEvent(null)
    keepOpenOnToast(empty)
    expect(empty.preventDefault).not.toHaveBeenCalled()
    const text = outsideEvent({} as EventTarget)
    keepOpenOnToast(text)
    expect(text.preventDefault).not.toHaveBeenCalled()
  })

  it('keepOpenOnToastWith corre primero el handler del que llama', () => {
    const order: string[] = []
    const handler = vi.fn(() => order.push('handler'))
    const event = outsideEvent(node(true))
    event.preventDefault.mockImplementation(() => order.push('keep'))
    keepOpenOnToastWith(handler)(event)
    expect(handler).toHaveBeenCalledWith(event)
    expect(order).toEqual(['handler', 'keep'])
    // Sin handler también anda.
    const bare = outsideEvent(node(true))
    keepOpenOnToastWith()(bare)
    expect(bare.preventDefault).toHaveBeenCalledTimes(1)
  })
})

// ─── toastUndo ───────────────────────────────────────────────────────────────

describe('toastUndo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    toastMock.mockClear()
    dismissMock.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('el tiempo lo lleva el reloj propio: sonner recibe duración infinita', () => {
    const id = toastUndo('Reserva marcada como llegada', { onUndo: vi.fn(), id: 'op-1' })
    expect(id).toBe('op-1')
    const data = callData()
    expect(toastMock.mock.calls.at(-1)?.[0]).toBe('Reserva marcada como llegada')
    expect(data.id).toBe('op-1')
    expect(data.duration).toBe(Number.POSITIVE_INFINITY)
    expect(data.action.props.children).toBe('Deshacer')
  })

  it('se cierra a los 6 s, ni antes ni dos veces', () => {
    toastUndo('Listo', { onUndo: vi.fn(), id: 'a' })
    vi.advanceTimersByTime(UNDO_MS - 1)
    expect(dismissMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(dismissMock).toHaveBeenCalledTimes(1)
    expect(dismissMock).toHaveBeenCalledWith('a')
    vi.advanceTimersByTime(UNDO_MS * 3)
    expect(dismissMock).toHaveBeenCalledTimes(1)
  })

  it('respeta una duración propia y una etiqueta propia', () => {
    toastUndo('Listo', { onUndo: vi.fn(), id: 'b', duration: 2000, undoLabel: 'Volver atrás' })
    expect(callData().action.props.children).toBe('Volver atrás')
    vi.advanceTimersByTime(2000)
    expect(dismissMock).toHaveBeenCalledWith('b')
  })

  it('sin id genera uno y lo devuelve', () => {
    const id = toastUndo('Listo', { onUndo: vi.fn() })
    expect(typeof id).toBe('string')
    expect(callData().id).toBe(id)
  })

  it('«Deshacer» cierra el aviso, corre onUndo una sola vez y apaga el reloj', () => {
    const onUndo = vi.fn()
    toastUndo('Listo', { onUndo, id: 'c' })
    const { action } = callData()
    action.props.onClick()
    action.props.onClick()
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(dismissMock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(UNDO_MS * 2)
    expect(dismissMock).toHaveBeenCalledTimes(1)
  })

  it('si onUndo falla queda registrado y no explota', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    toastUndo('Listo', { onUndo: () => Promise.reject(new Error('red caída')), id: 'd' })
    expect(() => callData().action.props.onClick()).not.toThrow()
    await vi.waitFor(() => expect(error).toHaveBeenCalled())
    const thrower = () => {
      throw new Error('sync')
    }
    toastUndo('Listo', { onUndo: thrower, id: 'e' })
    expect(() => callData().action.props.onClick()).not.toThrow()
    expect(error).toHaveBeenCalledTimes(2)
    error.mockRestore()
  })

  it('reemitir el mismo id reemplaza el aviso y reinicia el tiempo', () => {
    toastUndo('Primero', { onUndo: vi.fn(), id: 'op-9' })
    vi.advanceTimersByTime(4000)
    toastUndo('Segundo', { onUndo: vi.fn(), id: 'op-9' })
    vi.advanceTimersByTime(2000)
    // El reloj del primero ya habría cerrado acá.
    expect(dismissMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(UNDO_MS - 2000)
    expect(dismissMock).toHaveBeenCalledTimes(1)
  })

  it('si sonner lo cierra (la X, deslizar), el reloj se apaga', () => {
    toastUndo('Listo', { onUndo: vi.fn(), id: 'f' })
    callData().onDismiss()
    vi.advanceTimersByTime(UNDO_MS * 2)
    expect(dismissMock).not.toHaveBeenCalled()
  })
})
