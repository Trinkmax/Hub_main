// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  applyErrorKind,
  chunk,
  parseApplyResult,
  runLimited,
  toRpcChanges,
} from '@/lib/menu/prices/plan'

/**
 * El viaje de un cambio de precios a la base. La cuenta de qué se escribe y qué no la hace la base
 * (`menu_apply_price_changes`, probada en `tests/rls/menu-price-changes.test.ts`); acá se fija lo que
 * queda de este lado: que el pedido salga con la forma que la base espera, que la respuesta se lea sin
 * confiar en ella y que un error se entienda.
 */

describe('toRpcChanges: el pedido, con los nombres de la base', () => {
  it('pasa cada precio tal cual: el de la carta y el propio de una sucursal', () => {
    expect(
      toRpcChanges([
        { itemId: 'bacon', branchId: null, expectedCents: 1_250_000, priceCents: 1_375_000 },
        { itemId: 'bacon', branchId: 'cerro', expectedCents: null, priceCents: 1_400_000 },
        { itemId: 'cafe', branchId: 'cerro', expectedCents: 400_000, priceCents: null },
      ]),
    ).toEqual([
      { item_id: 'bacon', branch_id: null, expected_cents: 1_250_000, price_cents: 1_375_000 },
      { item_id: 'bacon', branch_id: 'cerro', expected_cents: null, price_cents: 1_400_000 },
      { item_id: 'cafe', branch_id: 'cerro', expected_cents: 400_000, price_cents: null },
    ])
  })

  it('sin cambios, un pedido vacío', () => {
    expect(toRpcChanges([])).toEqual([])
  })
})

describe('parseApplyResult: lo que contestó la base', () => {
  it('lo aplicado y lo que no, con lo que vale ahora', () => {
    expect(
      parseApplyResult({
        batch_id: '7b1f0c1e-0000-4000-8000-000000000001',
        applied: [
          { item_id: 'bacon', branch_id: null, from_cents: 1_250_000, to_cents: 1_375_000 },
          { item_id: 'bacon', branch_id: 'cerro', from_cents: null, to_cents: 1_400_000 },
          { item_id: 'cafe', branch_id: 'cerro', from_cents: 400_000, to_cents: null },
        ],
        failed: [
          { item_id: 'cheese', branch_id: null, reason: 'changed', current_cents: 1_300_000 },
          { item_id: 'flan', branch_id: 'cerro', reason: 'changed', current_cents: null },
          { item_id: 'ido', branch_id: null, reason: 'missing', current_cents: null },
        ],
      }),
    ).toEqual({
      batchId: '7b1f0c1e-0000-4000-8000-000000000001',
      applied: [
        { itemId: 'bacon', branchId: null, fromCents: 1_250_000, toCents: 1_375_000 },
        { itemId: 'bacon', branchId: 'cerro', fromCents: null, toCents: 1_400_000 },
        { itemId: 'cafe', branchId: 'cerro', fromCents: 400_000, toCents: null },
      ],
      failed: [
        { itemId: 'cheese', branchId: null, reason: 'changed', currentCents: 1_300_000 },
        { itemId: 'flan', branchId: 'cerro', reason: 'changed', currentCents: null },
        { itemId: 'ido', branchId: null, reason: 'missing' },
      ],
    })
  })

  it('un cambio suelto no trae tanda', () => {
    expect(parseApplyResult({ batch_id: null, applied: [], failed: [] })).toEqual({
      batchId: null,
      applied: [],
      failed: [],
    })
    expect(parseApplyResult({ applied: [], failed: [] })?.batchId).toBeNull()
  })

  it('los centavos pueden venir como texto (un entero grande) y valen igual', () => {
    const parsed = parseApplyResult({
      batch_id: null,
      applied: [{ item_id: 'a', branch_id: null, from_cents: '1250000', to_cents: 1_375_000 }],
      failed: [],
    })
    expect(parsed?.applied[0]).toEqual({
      itemId: 'a',
      branchId: null,
      fromCents: 1_250_000,
      toCents: 1_375_000,
    })
  })

  it('si la respuesta no tiene la forma, no se la cree', () => {
    const bad: unknown[] = [
      null,
      'ok',
      [],
      {},
      { applied: [] },
      { applied: 'x', failed: [] },
      { batch_id: 7, applied: [], failed: [] },
      // Sin producto.
      { applied: [{ branch_id: null, from_cents: 1, to_cents: 2 }], failed: [] },
      // Centavos que no son un entero de cero para arriba.
      { applied: [{ item_id: 'a', branch_id: null, from_cents: 1.5, to_cents: 2 }], failed: [] },
      { applied: [{ item_id: 'a', branch_id: null, from_cents: -1, to_cents: 2 }], failed: [] },
      { applied: [{ item_id: 'a', branch_id: null, from_cents: 'x', to_cents: 2 }], failed: [] },
      // El precio de la carta nunca queda vacío.
      { applied: [{ item_id: 'a', branch_id: null, from_cents: 1, to_cents: null }], failed: [] },
      { applied: [{ item_id: 'a', branch_id: null, from_cents: null, to_cents: 1 }], failed: [] },
      // Un motivo que no existe.
      { applied: [], failed: [{ item_id: 'a', branch_id: null, reason: 'porque sí' }] },
      { applied: [], failed: [{ item_id: 'a', branch_id: 5, reason: 'missing' }] },
      {
        applied: [],
        failed: [{ item_id: 'a', branch_id: null, reason: 'changed', current_cents: 'x' }],
      },
    ]
    for (const data of bad) expect(parseApplyResult(data)).toBeNull()
  })
})

describe('applyErrorKind: por qué la base no aplicó nada', () => {
  it('quien llama no puede (o se quedó sin sesión)', () => {
    expect(applyErrorKind({ code: '42501', message: 'forbidden' })).toBe('forbidden')
    expect(applyErrorKind({ code: '28000', message: 'unauthenticated' })).toBe('forbidden')
    // Sin sesión, la base ni deja llamar la función.
    expect(
      applyErrorKind({
        code: '42501',
        message: 'permission denied for function menu_apply_price_changes',
      }),
    ).toBe('forbidden')
  })

  it('una sucursal que ya no es de este bar', () => {
    expect(applyErrorKind({ code: 'P0002', message: 'branch_not_found' })).toBe('branch')
  })

  it('un pedido mal armado', () => {
    expect(applyErrorKind({ code: '22023', message: 'invalid_changes' })).toBe('invalid')
  })

  it('lo demás es «no se guardó, probá de nuevo»', () => {
    expect(applyErrorKind({ code: '40P01', message: 'deadlock detected' })).toBe('failed')
    expect(
      applyErrorKind({ code: '57014', message: 'canceling statement due to statement timeout' }),
    ).toBe('failed')
    expect(applyErrorKind({ message: 'TypeError: fetch failed' })).toBe('failed')
    expect(applyErrorKind({})).toBe('failed')
  })
})

describe('chunk y runLimited', () => {
  it('parte en tandas sin perder ni repetir', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
  })

  it('corre de a pocos y devuelve en el orden de entrada', async () => {
    let running = 0
    let peak = 0
    const results = await runLimited([30, 5, 20, 1, 10], 2, async (ms) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, ms))
      running -= 1
      return ms * 2
    })
    expect(results).toEqual([60, 10, 40, 2, 20])
    expect(peak).toBe(2)
  })

  it('sin tareas no hace nada', async () => {
    expect(await runLimited([], 4, async () => 1)).toEqual([])
  })
})
