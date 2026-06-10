import { describe, expect, it, vi } from 'vitest'
import { armBackGuard, type BackGuardWindow } from '@/lib/m-session/back-guard'

/** Window falsa: history en memoria + registro de listeners de popstate. */
function makeFakeWindow() {
  const listeners: Record<string, Array<() => void>> = {}
  const stack: Array<unknown> = [null] // entrada inicial de la página
  return {
    history: {
      get state() {
        return stack[stack.length - 1] ?? null
      },
      pushState(state: unknown) {
        stack.push(state)
      },
      back() {
        if (stack.length > 1) stack.pop()
        for (const cb of listeners.popstate ?? []) cb()
      },
    },
    addEventListener(type: string, cb: () => void) {
      if (!listeners[type]) listeners[type] = []
      listeners[type].push(cb)
    },
    removeEventListener(type: string, cb: () => void) {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== cb)
    },
    /** helper de test: simula el botón "atrás" del navegador */
    pressBack() {
      this.history.back()
    },
  }
}

describe('armBackGuard', () => {
  it('empuja una entrada al historial al armarse', () => {
    const win = makeFakeWindow()
    const push = vi.spyOn(win.history, 'pushState')
    armBackGuard(win as unknown as BackGuardWindow, () => {})
    expect(push).toHaveBeenCalledWith({ __mSheet: true }, '')
  })

  it('llama onClose cuando el usuario toca "atrás" (popstate)', () => {
    const win = makeFakeWindow()
    const onClose = vi.fn()
    armBackGuard(win as unknown as BackGuardWindow, onClose)
    win.pressBack()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('en cierre programático limpia la entrada con history.back()', () => {
    const win = makeFakeWindow()
    const back = vi.spyOn(win.history, 'back')
    const dispose = armBackGuard(win as unknown as BackGuardWindow, () => {})
    dispose()
    expect(back).toHaveBeenCalledTimes(1)
  })

  it('no llama history.back() si el usuario ya tocó "atrás"', () => {
    const win = makeFakeWindow()
    const onClose = vi.fn()
    const dispose = armBackGuard(win as unknown as BackGuardWindow, onClose)
    win.pressBack() // consume la entrada dummy
    const back = vi.spyOn(win.history, 'back')
    dispose()
    expect(back).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
