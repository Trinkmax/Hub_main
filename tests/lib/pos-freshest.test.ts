import { beforeEach, describe, expect, it } from 'vitest'
import { forgetAllFreshest, freshKey, keepFreshest } from '@/lib/pos/freshest'

type Detail = { now: string; served: number }
const at = (now: string, served: number): Detail => ({ now, served })

describe('la pantalla nunca vuelve para atrás', () => {
  beforeEach(() => forgetAllFreshest())

  it('la primera versión que llega queda', () => {
    const first = at('2026-11-25T18:30:00.000Z', 0)
    expect(keepFreshest('session:a', first)).toBe(first)
  })

  it('una lectura más nueva reemplaza a la vieja', () => {
    keepFreshest('session:a', at('2026-11-25T18:30:00.000Z', 0))
    const newer = at('2026-11-25T18:30:05.000Z', 6)
    expect(keepFreshest('session:a', newer)).toBe(newer)
  })

  it('la copia guardada del navegador (más vieja) no pisa lo que ya se vio: el caso de «Servido» que volvía', () => {
    const served = at('2026-11-25T18:30:05.000Z', 6)
    keepFreshest('session:a', served)
    // Al volver a la mesa, el navegador entrega la página de antes de marcar.
    const cached = at('2026-11-25T18:30:00.000Z', 0)
    expect(keepFreshest('session:a', cached)).toBe(served)
  })

  it('una lectura lenta que vuelve después de la respuesta de una acción no la pisa', () => {
    const afterAction = at('2026-11-25T18:30:02.400Z', 6)
    keepFreshest('session:a', afterAction)
    const slowRead = at('2026-11-25T18:30:01.900Z', 0)
    expect(keepFreshest('session:a', slowRead)).toBe(afterAction)
  })

  it('igual de nueva: gana la que llega (la respuesta de una acción con la misma hora)', () => {
    keepFreshest('session:a', at('2026-11-25T18:30:05.000Z', 5))
    const same = at('2026-11-25T18:30:05.000Z', 6)
    expect(keepFreshest('session:a', same)).toBe(same)
  })

  it('compara la hora, no el texto: con y sin fracción de segundo, con y sin zona', () => {
    keepFreshest('session:a', at('2026-11-25T18:30:05.5+00:00', 6))
    expect(keepFreshest('session:a', at('2026-11-25T18:30:05.123456+00:00', 0)).served).toBe(6)
    expect(keepFreshest('session:a', at('2026-11-25T15:30:06-03:00', 7)).served).toBe(7)
  })

  it('cada pantalla tiene lo suyo', () => {
    keepFreshest(freshKey.session('a'), at('2026-11-25T18:30:05.000Z', 6))
    const otherTable = at('2026-11-25T18:29:00.000Z', 1)
    expect(keepFreshest(freshKey.session('b'), otherTable)).toBe(otherTable)
    const bill = at('2026-11-25T18:29:00.000Z', 2)
    expect(keepFreshest(freshKey.bill('a'), bill)).toBe(bill)
  })

  it('una hora ilegible nunca le gana a una buena', () => {
    const good = at('2026-11-25T18:30:05.000Z', 6)
    keepFreshest('session:a', good)
    expect(keepFreshest('session:a', at('no es una fecha', 0))).toBe(good)
  })

  it('no crece sin límite: lo que no se usa hace rato se olvida', () => {
    for (let i = 0; i < 400; i += 1) keepFreshest(`session:${i}`, at('2026-11-25T18:30:00.000Z', i))
    // La primera ya se olvidó: una versión vieja vuelve a entrar como si nada.
    const old = at('2026-11-25T18:00:00.000Z', -1)
    expect(keepFreshest('session:0', old)).toBe(old)
    // La última sigue.
    expect(keepFreshest('session:399', at('2026-11-25T18:00:00.000Z', -1)).served).toBe(399)
  })
})
