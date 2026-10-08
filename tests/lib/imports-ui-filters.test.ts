/**
 * Filtros de la revisión de un lote (WP10): qué pestaña se abre sola, qué
 * estados trae cada una, los chips de «Para revisar» y la página de la URL.
 * También que los textos cubran todos los estados y todo lo que puede faltar.
 */

import { describe, expect, it } from 'vitest'
import { BATCH_STATUSES, NEED_KEYS, NEED_TEXT, PROPOSAL_STATUSES } from '@/lib/imports/server/types'
import {
  filterCounts,
  NEED_SHORT_TEXT,
  needChips,
  pageFromQuery,
  REVIEW_FILTER_COPY,
  REVIEW_FILTERS,
  resolveReviewFilter,
} from '@/lib/imports/ui/filters'
import {
  BATCH_STATUS_COPY,
  IMPORT_SOURCE_COPY,
  importBatchHref,
  importHref,
  importSourceHref,
  isUiImportSource,
  PROPOSAL_STATUS_COPY,
  UI_IMPORT_SOURCES,
} from '@/lib/imports/ui/labels'

const ZERO = Object.fromEntries(PROPOSAL_STATUSES.map((s) => [s, 0]))

describe('pestañas de la revisión', () => {
  it('cada estado de propuesta cae en una sola pestaña (además de «Todos»)', () => {
    const owners = PROPOSAL_STATUSES.map(
      (s) =>
        REVIEW_FILTERS.filter((f) => f !== 'todos' && REVIEW_FILTER_COPY[f].statuses.includes(s))
          .length,
    )
    expect(owners.every((n) => n === 1)).toBe(true)
    expect(REVIEW_FILTER_COPY.todos.statuses).toEqual([])
  })

  it('cuenta cada pestaña con el byStatus del resumen', () => {
    const counts = filterCounts({
      ...ZERO,
      needs_input: 3,
      stale: 1,
      error: 2,
      ready: 10,
      posting: 1,
      posted: 40,
      skipped: 5,
      voided: 1,
    })
    expect(counts).toEqual({
      revisar: 6,
      listas: 11,
      cargadas: 40,
      'no-se-cargan': 6,
      todos: 63,
    })
  })

  it('sin pestaña en la URL: «Para revisar» si hay, si no «Listas», si no «Todos»', () => {
    const base = { revisar: 0, listas: 0, cargadas: 0, 'no-se-cargan': 0, todos: 0 }
    expect(resolveReviewFilter({}, { ...base, revisar: 2, listas: 5 }).filter).toBe('revisar')
    expect(resolveReviewFilter({}, { ...base, listas: 5 }).filter).toBe('listas')
    expect(resolveReviewFilter({}, { ...base, cargadas: 5 }).filter).toBe('todos')
    expect(resolveReviewFilter({ ver: 'cargadas' }, { ...base, revisar: 2 })).toEqual({
      filter: 'cargadas',
      statuses: ['posted'],
      need: null,
    })
    expect(resolveReviewFilter({ ver: 'cualquiera' }, { ...base, listas: 1 }).filter).toBe('listas')
  })

  it('«?falta=» solo vale si hay pendientes de ese tipo, y queda en «Para revisar»', () => {
    const counts = { revisar: 4, listas: 0, cargadas: 0, 'no-se-cargan': 0, todos: 4 }
    expect(
      resolveReviewFilter({ ver: 'listas', falta: 'other_taxes_as' }, counts, {
        other_taxes_as: 4,
      }),
    ).toEqual({
      filter: 'revisar',
      statuses: ['needs_input', 'stale', 'error'],
      need: 'other_taxes_as',
    })
    expect(resolveReviewFilter({ falta: 'other_taxes_as' }, counts, {}).need).toBeNull()
    expect(resolveReviewFilter({ falta: 'no_existe' }, counts, { manual: 1 }).need).toBeNull()
  })

  it('los chips: lo más común primero y sin los que están en cero', () => {
    expect(needChips({ manual: 1, other_taxes_as: 5, new_supplier: 5, vat_rate: 0 })).toEqual([
      { key: 'new_supplier', label: 'Proveedor nuevo', count: 5 },
      { key: 'other_taxes_as', label: 'Otros tributos', count: 5 },
      { key: 'manual', label: 'Se carga a mano', count: 1 },
    ])
  })

  it('la página de la URL queda entre 1 y la última', () => {
    expect(pageFromQuery(undefined, 142, 50)).toBe(1)
    expect(pageFromQuery('2', 142, 50)).toBe(2)
    expect(pageFromQuery('9', 142, 50)).toBe(3)
    expect(pageFromQuery('-1', 142, 50)).toBe(1)
    expect(pageFromQuery('abc', 0, 50)).toBe(1)
  })
})

describe('textos completos', () => {
  it('cada cosa que puede faltar tiene su chip y su explicación', () => {
    for (const key of NEED_KEYS) {
      expect(NEED_SHORT_TEXT[key].length, key).toBeGreaterThan(3)
      expect(NEED_TEXT[key].length, key).toBeGreaterThan(10)
    }
  })

  it('cada estado de lote y de propuesta tiene etiqueta', () => {
    for (const s of BATCH_STATUSES) expect(BATCH_STATUS_COPY[s].label.length, s).toBeGreaterThan(3)
    for (const s of PROPOSAL_STATUSES) {
      expect(PROPOSAL_STATUS_COPY[s].label.length, s).toBeGreaterThan(3)
    }
  })

  it('no nombran ningún bar ni sistema de caja en particular', () => {
    const all = JSON.stringify([IMPORT_SOURCE_COPY, BATCH_STATUS_COPY, PROPOSAL_STATUS_COPY])
    expect(all).not.toMatch(/\bHUB\b|Thinkeon/i)
  })
})

describe('rutas (C4)', () => {
  it('hub, subidas y revisión', () => {
    expect(importHref('bar')).toBe('/bar/administracion/importar')
    expect(UI_IMPORT_SOURCES.map((s) => importSourceHref('bar', s))).toEqual([
      '/bar/administracion/importar/arca',
      '/bar/administracion/importar/mercado-pago',
      '/bar/administracion/importar/banco',
    ])
    expect(importBatchHref('bar', 'b1', { ver: 'listas', pagina: 2, falta: null })).toBe(
      '/bar/administracion/importar/b1?ver=listas&pagina=2',
    )
    expect(isUiImportSource('arca_emitidos')).toBe(false)
    expect(isUiImportSource('mp_release')).toBe(true)
  })
})
