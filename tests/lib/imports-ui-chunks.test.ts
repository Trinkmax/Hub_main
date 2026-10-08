/**
 * Tandas y progreso de las pantallas de importación (WP10): las filas viajan a
 * `addImportItems` en tandas de 500 filas o 1 MB (lo que llegue primero), las
 * propuestas se cargan de a 15, y lo que ve la persona («Cargando 45 de 142…»,
 * el resumen final) sale de acá.
 */

import { describe, expect, it } from 'vitest'
import {
  chunkByRowsAndBytes,
  chunkList,
  ITEMS_CHUNK_BYTES,
  ITEMS_CHUNK_ROWS,
  jsonBytes,
  POST_CHUNK_SIZE,
  toStagedRow,
} from '@/lib/imports/ui/chunks'
import {
  count,
  emptyTally,
  formatCount,
  progressPercent,
  progressText,
  tallyResults,
  tallySummary,
} from '@/lib/imports/ui/progress'

describe('tandas de filas (≤ 500 filas o ≤ 1 MB)', () => {
  it('los topes son los de fase2-estado §6.1', () => {
    expect(ITEMS_CHUNK_ROWS).toBe(500)
    expect(ITEMS_CHUNK_BYTES).toBe(1_000_000)
    expect(POST_CHUNK_SIZE).toBe(15)
  })

  it('corta por filas cuando las filas son chicas', () => {
    const rows = Array.from({ length: 1240 }, (_, i) => ({ i }))
    const chunks = chunkByRowsAndBytes(rows)
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 240])
    expect(chunks.flat()).toEqual(rows)
  })

  it('corta por bytes cuando las filas son pesadas, y cada tanda entra en el tope', () => {
    // ~7,5 KB por fila: 1 MB entra unas 133 filas, mucho menos que 500.
    const rows = Array.from({ length: 400 }, (_, i) => ({ i, pad: 'x'.repeat(7500) }))
    const chunks = chunkByRowsAndBytes(rows)
    expect(chunks.length).toBeGreaterThan(2)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(ITEMS_CHUNK_ROWS)
      expect(jsonBytes(chunk)).toBeLessThanOrEqual(ITEMS_CHUNK_BYTES)
    }
    expect(chunks.flat()).toEqual(rows)
  })

  it('cuenta los bytes de verdad (UTF-8, comas y corchetes incluidos)', () => {
    const rows = ['ñ', 'á', 'b']
    // Cada uno: «"ñ"» = 4 bytes; arreglo «["ñ","á","b"]» = 2 + 4 + 1 + 4 + 1 + 3 = 15.
    expect(jsonBytes(rows)).toBe(15)
    expect(chunkByRowsAndBytes(rows, { maxBytes: 15 })).toEqual([rows])
    expect(chunkByRowsAndBytes(rows, { maxBytes: 14 })).toEqual([['ñ', 'á'], ['b']])
  })

  it('una fila más grande que el tope va sola (el servidor decide)', () => {
    const rows = ['a', 'b'.repeat(50), 'c']
    expect(chunkByRowsAndBytes(rows, { maxBytes: 20 })).toEqual([['a'], ['b'.repeat(50)], ['c']])
  })

  it('sin filas, sin tandas; tandas fijas de 15 para cargar', () => {
    expect(chunkByRowsAndBytes([])).toEqual([])
    const keys = Array.from({ length: 142 }, (_, i) => i)
    const chunks = chunkList(keys, POST_CHUNK_SIZE)
    expect(chunks).toHaveLength(10)
    expect(chunks.at(-1)).toHaveLength(7)
    expect(chunkList([1, 2, 3], 0)).toEqual([[1], [2], [3]])
  })

  it('la fila del parser se convierte en lo que recibe addImportItems', () => {
    const row = toStagedRow({
      row: 7,
      key: 'mc:R:30501234563:1:3:10',
      item: { kind: 'mc' },
      issues: [{ level: 'info', code: 'mc_rounding', row: 7 }],
    })
    expect(row).toEqual({
      rowNo: 7,
      naturalKey: 'mc:R:30501234563:1:3:10',
      data: { kind: 'mc' },
      issues: [{ level: 'info', code: 'mc_rounding', row: 7 }],
    })
  })
})

describe('progreso en palabras', () => {
  it('«Cargando 45 de 142…», con miles con punto y sin pasarse del total', () => {
    expect(progressText('Cargando', 45, 142)).toBe('Cargando 45 de 142…')
    expect(progressText('Subiendo filas:', 1500, 1240)).toBe('Subiendo filas: 1.240 de 1.240…')
    expect(progressText('Cargando', -3, 10)).toBe('Cargando 0 de 10…')
    expect(formatCount(1234567)).toBe('1.234.567')
    expect(count(1, 'comprobante', 'comprobantes')).toBe('1 comprobante')
    expect(count(3, 'comprobante', 'comprobantes')).toBe('3 comprobantes')
  })

  it('el porcentaje queda entre 0 y 100 y no divide por cero', () => {
    expect(progressPercent(45, 142)).toBe(31)
    expect(progressPercent(142, 142)).toBe(100)
    expect(progressPercent(200, 142)).toBe(100)
    expect(progressPercent(5, 0)).toBe(0)
    expect(progressPercent(Number.NaN, 10)).toBe(0)
  })
})

describe('cómo terminó la carga', () => {
  it('agrupa cada resultado y lo dice en criollo', () => {
    let t = emptyTally()
    t = tallyResults(t, [
      { outcome: 'posted' },
      { outcome: 'replayed' },
      { outcome: 'already_posted' },
      { outcome: 'stale' },
      { outcome: 'needs_input' },
      { outcome: 'error' },
      { outcome: 'not_found' },
      { outcome: 'skipped' },
    ])
    expect(t).toEqual({ posted: 3, stale: 1, needsInput: 1, failed: 2, skipped: 1 })
    expect(tallySummary(t, ['comprobante', 'comprobantes'])).toBe(
      'Se cargaron 3 comprobantes. 2 quedaron para revisar. 2 no se pudieron cargar: mirá el motivo en la lista. 1 no se carga (ya estaba o se anuló).',
    )
  })

  it('en singular y cuando no se cargó nada', () => {
    expect(tallySummary({ ...emptyTally(), posted: 1 }, ['movimiento', 'movimientos'])).toBe(
      'Se cargó 1 movimiento.',
    )
    expect(tallySummary({ ...emptyTally(), stale: 1 }, ['comprobante', 'comprobantes'])).toBe(
      'No se cargó ningún comprobante. 1 quedó para revisar.',
    )
  })
})
