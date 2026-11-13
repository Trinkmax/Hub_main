// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  batchFailureSentence,
  batchSentence,
  batchStorageKey,
  buildBatch,
  countProducts,
  invertChanges,
  joinNames,
  type PriceBatch,
  parseStoredBatch,
  serializeBatch,
  undoSentence,
} from '@/lib/menu/prices/batch'
import type { PriceChange } from '@/lib/menu/prices/types'
import { NBSP } from '@/lib/money'

/**
 * La tanda de un aumento: lo que se escribió, guardado en la pantalla y en el navegador para
 * poder deshacerlo entero mientras dure la sesión.
 */

const CHANGES: PriceChange[] = [
  { itemId: 'bacon', branchId: null, fromCents: 1_250_000, toCents: 1_380_000 },
  { itemId: 'cafe', branchId: null, fromCents: 380_000, toCents: 420_000 },
  { itemId: 'bacon', branchId: 'cerro', fromCents: null, toCents: 1_500_000 },
]

const batchOf = (over: Partial<PriceBatch> = {}): PriceBatch => ({
  v: 1,
  id: 'tanda-1',
  at: 1_763_000_000_000,
  percentBp: 1_000,
  roundingCents: 10_000,
  branchId: null,
  branchName: null,
  requested: 2,
  applied: 2,
  changes: CHANGES,
  failures: [],
  ...over,
})

describe('invertChanges', () => {
  it('da vuelta cada precio: lo que quedó vuelve a lo que había', () => {
    expect(invertChanges(CHANGES)).toEqual([
      { itemId: 'bacon', branchId: null, fromCents: 1_380_000, toCents: 1_250_000 },
      { itemId: 'cafe', branchId: null, fromCents: 420_000, toCents: 380_000 },
      // El precio propio que no existía vuelve a no existir (sigue la carta).
      { itemId: 'bacon', branchId: 'cerro', fromCents: 1_500_000, toCents: null },
    ])
  })

  it('deshacer dos veces deja todo como al principio', () => {
    expect(invertChanges(invertChanges(CHANGES))).toEqual(CHANGES)
  })

  it('cuenta productos, no precios', () => {
    expect(countProducts(CHANGES)).toBe(2)
    expect(countProducts([])).toBe(0)
  })
})

describe('buildBatch', () => {
  const base = {
    id: 'tanda-1',
    at: 1_763_000_000_000,
    percentBp: 1_000,
    roundingCents: 10_000,
    branchId: null,
    branchName: null,
    requested: CHANGES,
    nameOf: (failure: { itemId: string }) => failure.itemId.toUpperCase(),
  }

  it('guarda solo lo que se escribió y cuenta los productos que salieron enteros', () => {
    const batch = buildBatch({
      ...base,
      result: { ok: true, savedAt: 1, applied: CHANGES, failed: [] },
    })
    expect(batch).toMatchObject({ requested: 2, applied: 2, changes: CHANGES, failures: [] })
  })

  it('un producto con algún precio que falló no cuenta como cambiado', () => {
    const batch = buildBatch({
      ...base,
      result: {
        ok: true,
        savedAt: 1,
        applied: [CHANGES[0] as PriceChange, CHANGES[2] as PriceChange],
        failed: [{ itemId: 'cafe', branchId: null, reason: 'changed', currentCents: 400_000 }],
      },
    })
    expect(batch).toMatchObject({
      requested: 2,
      applied: 1,
      failures: [{ name: 'CAFE', reason: 'changed' }],
    })
    expect(batch?.changes).toHaveLength(2)
  })

  it('si no se escribió nada no hay tanda (no hay qué deshacer)', () => {
    expect(
      buildBatch({
        ...base,
        result: {
          ok: true,
          savedAt: 1,
          applied: [],
          failed: [{ itemId: 'cafe', branchId: null, reason: 'error' }],
        },
      }),
    ).toBeNull()
  })
})

describe('guardar y leer del navegador', () => {
  it('lo que se guarda se vuelve a leer igual', () => {
    const batch = batchOf({ failures: [{ name: 'Café', reason: 'changed' }], applied: 1 })
    expect(parseStoredBatch(serializeBatch(batch))).toEqual(batch)
  })

  it('la llave es por bar', () => {
    expect(batchStorageKey('hub')).not.toBe(batchStorageKey('otro-bar'))
  })

  it('descarta lo que no tiene la forma exacta', () => {
    const good = batchOf()
    const broken: unknown[] = [
      null,
      '',
      'no es json',
      '[]',
      JSON.stringify({ ...good, v: 2 }),
      JSON.stringify({ ...good, id: '' }),
      JSON.stringify({ ...good, percentBp: 0 }),
      JSON.stringify({ ...good, percentBp: 10.5 }),
      JSON.stringify({ ...good, changes: [] }),
      JSON.stringify({ ...good, changes: 'todos' }),
      JSON.stringify({
        ...good,
        changes: [{ itemId: 'a', branchId: null, fromCents: -1, toCents: 2 }],
      }),
      JSON.stringify({
        ...good,
        changes: [{ itemId: 'a', branchId: null, fromCents: 1.5, toCents: 2 }],
      }),
      // El precio de la carta nunca está vacío.
      JSON.stringify({
        ...good,
        changes: [{ itemId: 'a', branchId: null, fromCents: null, toCents: 2 }],
      }),
      JSON.stringify({
        ...good,
        changes: [{ itemId: 'a', branchId: 7, fromCents: 1, toCents: 2 }],
      }),
      JSON.stringify({ ...good, failures: [{ name: 'Café', reason: 'porque sí' }] }),
      JSON.stringify({ ...good, branchName: 12 }),
    ]
    for (const raw of broken) expect(parseStoredBatch(raw as string | null)).toBeNull()
  })

  it('una tanda de una sucursal conserva dónde fue', () => {
    const batch = batchOf({ branchId: 'cerro', branchName: 'Cerro' })
    expect(parseStoredBatch(serializeBatch(batch))).toMatchObject({
      branchId: 'cerro',
      branchName: 'Cerro',
    })
  })
})

describe('cómo se dice', () => {
  it('une nombres como se habla', () => {
    expect(joinNames([])).toBe('')
    expect(joinNames(['Bacon'])).toBe('Bacon')
    expect(joinNames(['Bacon', 'Café'])).toBe('Bacon y Café')
    expect(joinNames(['Bacon', 'Café', 'Lomo'])).toBe('Bacon, Café y Lomo')
    expect(joinNames(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A, B, C y 3 más')
  })

  it('la tanda dice lo que pasó', () => {
    expect(batchSentence(batchOf({ requested: 46, applied: 46 }))).toBe(
      `Aumentaste 46 productos un 10${NBSP}%`,
    )
    expect(batchSentence(batchOf({ requested: 46, applied: 44 }))).toBe(
      `Aumentaste 44 de 46 productos un 10${NBSP}%`,
    )
    expect(
      batchSentence(batchOf({ requested: 12, applied: 12, percentBp: -500, branchName: 'Cerro' })),
    ).toBe(`Bajaste 12 productos un 5${NBSP}% en Cerro`)
  })

  it('si salieron todos, no hay nada que avisar', () => {
    expect(batchFailureSentence(batchOf())).toBeNull()
  })

  it('si alguno no se pudo, dice cuáles, por qué y qué hacer', () => {
    expect(
      batchFailureSentence(
        batchOf({
          requested: 46,
          applied: 44,
          failures: [
            { name: 'Bacon', reason: 'changed' },
            { name: 'Café', reason: 'changed' },
          ],
        }),
      ),
    ).toBe(
      'Estos 2 no se pudieron cambiar: Bacon y Café (alguien los cambió mientras armabas el aumento). Buscalos y cambialos a mano.',
    )
    expect(
      batchFailureSentence(
        batchOf({ requested: 3, applied: 2, failures: [{ name: 'Flan', reason: 'missing' }] }),
      ),
    ).toBe('Este no se pudo cambiar: Flan (ya no está en la carta). Buscalo y cambialo a mano.')
    expect(
      batchFailureSentence(
        batchOf({
          requested: 3,
          applied: 1,
          failures: [
            { name: 'Flan', reason: 'error' },
            { name: 'Lomo', reason: 'changed' },
          ],
        }),
      ),
    ).toBe(
      'Estos 2 no se pudieron cambiar: Flan y Lomo (no se guardaron). Buscalos y cambialos a mano.',
    )
  })

  it('al deshacer dice cuántos volvieron y cuántos se dejaron', () => {
    expect(undoSentence({ undone: 46, total: 46 })).toBe(
      'Listo: los 46 precios volvieron a como estaban.',
    )
    expect(undoSentence({ undone: 1, total: 1 })).toBe('Listo: el precio volvió a como estaba.')
    expect(undoSentence({ undone: 44, total: 46 })).toBe(
      'Volvieron 44 de 46 precios. Los otros 2 cambiaron después y quedaron como están.',
    )
    expect(undoSentence({ undone: 45, total: 46 })).toBe(
      'Volvieron 45 de 46 precios. El otro cambió después y quedó como está.',
    )
    expect(undoSentence({ undone: 0, total: 3 })).toBe(
      'No se deshizo nada: esos precios cambiaron después y quedaron como están.',
    )
    expect(undoSentence({ undone: 0, total: 1 })).toBe(
      'No se deshizo: el precio cambió después y quedó como está.',
    )
  })
})
