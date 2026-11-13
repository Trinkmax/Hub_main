import { describe, expect, it, vi } from 'vitest'
import { createLiveGeometryStore } from '@/lib/floor-plan/live-geometry'

describe('createLiveGeometryStore', () => {
  it('arranca vacío', () => {
    expect(createLiveGeometryStore().get().size).toBe(0)
  })

  it('guarda la geometría provisoria de un elemento y avisa', () => {
    const store = createLiveGeometryStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.set('a', { x: 10, y: 20 })
    expect(store.get().get('a')).toEqual({ x: 10, y: 20 })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('mezcla: mover y después girar el mismo elemento no pierde la posición', () => {
    const store = createLiveGeometryStore()
    store.set('a', { x: 10, y: 20 })
    store.set('a', { rotation: 45 })
    expect(store.get().get('a')).toEqual({ x: 10, y: 20, rotation: 45 })
  })

  it('cada cambio es un mapa nuevo (se detecta por identidad)', () => {
    const store = createLiveGeometryStore()
    const first = store.get()
    store.set('a', { x: 1 })
    const second = store.get()
    store.set('a', { x: 2 })
    expect(second).not.toBe(first)
    expect(store.get()).not.toBe(second)
    expect(second.get('a')).toEqual({ x: 1 }) // la foto anterior no se muta
  })

  it('setMany mueve un grupo con un solo aviso', () => {
    const store = createLiveGeometryStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.setMany([
      ['a', { x: 1, y: 1 }],
      ['b', { x: 2, y: 2 }],
    ])
    expect(store.get().size).toBe(2)
    expect(listener).toHaveBeenCalledTimes(1)
    store.setMany([])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('clear vuelve a lo guardado y avisa una sola vez', () => {
    const store = createLiveGeometryStore()
    store.set('a', { x: 1 })
    const listener = vi.fn()
    store.subscribe(listener)
    store.clear()
    expect(store.get().size).toBe(0)
    store.clear() // ya estaba vacío: no molesta a nadie
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('quien se desuscribe deja de recibir avisos', () => {
    const store = createLiveGeometryStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()
    store.set('a', { x: 1 })
    expect(listener).not.toHaveBeenCalled()
  })
})
