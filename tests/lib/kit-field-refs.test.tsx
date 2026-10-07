// @vitest-environment node
import { createElement as h, type Ref } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeField } from '@/components/ui/code-field'
import { SearchField } from '@/components/ui/input'

/**
 * La `ref` del que llama a un campo compuesto del kit (`SearchField`,
 * `CodeField`) se SUMA a la propia, no la reemplaza: con la propia el campo
 * devuelve el foco al limpiar y escucha el reset del formulario. Antes, una
 * `ref` del que llama (el «/» del operativo enfoca el buscador) pisaba la
 * propia y el tablero la sacaba con `querySelector`.
 *
 * El server no engancha refs, así que se mira lo que llega: `Input` le pasa
 * sus props (con la `ref`) a `useFieldControl`, y el campo le pasa su ref
 * propia a `useFormReset`. Se espían los dos y se engancha a mano un nodo de
 * mentira, como hace React en el cliente.
 */

const seen = vi.hoisted(() => ({
  controlRefs: [] as unknown[],
  resetRefs: [] as unknown[],
}))

vi.mock('@/components/ui/field', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/field')>()
  return {
    ...actual,
    useFieldControl: (own: Parameters<typeof actual.useFieldControl>[0] & { ref?: unknown }) => {
      seen.controlRefs.push(own.ref)
      return actual.useFieldControl(own)
    },
    useFormReset: (...args: Parameters<typeof actual.useFormReset>) => {
      seen.resetRefs.push(args[0])
      return actual.useFormReset(...args)
    },
  }
})

type Attach = (node: HTMLInputElement | null) => undefined | (() => void)

/** Lo que React haría en el cliente: llamar la ref que llegó al `<input>` con el nodo. */
function attach(ref: unknown, node: HTMLInputElement): (() => void) | undefined {
  if (typeof ref !== 'function') throw new Error('al <input> le tiene que llegar una ref callback')
  return (ref as Attach)(node) ?? undefined
}

const fakeInput = () => ({ focus: vi.fn() }) as unknown as HTMLInputElement

beforeEach(() => {
  seen.controlRefs.length = 0
  seen.resetRefs.length = 0
})

describe('SearchField: la ref del que llama se suma a la propia', () => {
  it('un objeto ref recibe el <input> y la propia también (reset y «Limpiar»)', () => {
    const outer: { current: HTMLInputElement | null } = { current: null }
    renderToStaticMarkup(h(SearchField, { ref: outer, 'aria-label': 'Buscar' }))
    const toInput = seen.controlRefs.at(-1)
    // No es la ref del que llama tal cual: es la combinada.
    expect(toInput).not.toBe(outer)
    const node = fakeInput()
    const detach = attach(toInput, node)
    expect(outer.current).toBe(node)
    // La propia (la que escucha el reset del <form>) apunta al mismo <input>.
    const own = seen.resetRefs.at(-1) as { current: HTMLInputElement | null }
    expect(own.current).toBe(node)
    // Al desmontar (limpieza de React 19), las dos se sueltan.
    detach?.()
    expect(outer.current).toBeNull()
    expect(own.current).toBeNull()
  })

  it('una ref callback también recibe el nodo', () => {
    const calls: Array<HTMLInputElement | null> = []
    const callback: Ref<HTMLInputElement> = (node) => {
      calls.push(node)
    }
    renderToStaticMarkup(h(SearchField, { ref: callback, 'aria-label': 'Buscar' }))
    const node = fakeInput()
    attach(seen.controlRefs.at(-1), node)
    expect(calls).toEqual([node])
    expect((seen.resetRefs.at(-1) as { current: unknown }).current).toBe(node)
  })

  it('sin ref del que llama, la propia sigue enganchada', () => {
    renderToStaticMarkup(h(SearchField, { 'aria-label': 'Buscar' }))
    const node = fakeInput()
    attach(seen.controlRefs.at(-1), node)
    expect((seen.resetRefs.at(-1) as { current: unknown }).current).toBe(node)
  })
})

describe('CodeField: lo mismo (la ref no le saca el reset)', () => {
  it('el objeto ref del que llama y la propia apuntan al mismo <input>', () => {
    const outer: { current: HTMLInputElement | null } = { current: null }
    renderToStaticMarkup(h(CodeField, { kind: 'cuit', ref: outer, 'aria-label': 'CUIT' }))
    const node = fakeInput()
    attach(seen.controlRefs.at(-1), node)
    expect(outer.current).toBe(node)
    expect((seen.resetRefs.at(-1) as { current: unknown }).current).toBe(node)
  })
})
