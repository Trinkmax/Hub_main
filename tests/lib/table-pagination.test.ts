import { describe, expect, it } from 'vitest'
import {
  clampPage,
  makePageHref,
  PAGE_PARAM,
  pageCount,
  pageHref,
  pageRange,
  pageSlice,
  paginationItems,
  parsePage,
  rangeLabel,
} from '@/lib/table/pagination'
import {
  headerCheckedState,
  pruneSelection,
  selectAllRows,
  selectionLabel,
  selectRange,
  setRowSelected,
} from '@/lib/table/selection'

/**
 * Kit HUB §3.6: paginación por URL (`?page=N`, como los paginadores de hoy) y
 * la selección de filas de `DataTable` (funciones puras de las islas).
 */

describe('parsePage', () => {
  it('lee la página y descarta la basura', () => {
    expect(parsePage('3')).toBe(3)
    expect(parsePage(' 7 ')).toBe(7)
    expect(parsePage(undefined)).toBe(1)
    expect(parsePage('')).toBe(1)
    expect(parsePage('0')).toBe(1)
    expect(parsePage('-2')).toBe(1)
    expect(parsePage('2.5')).toBe(1)
    expect(parsePage('abc')).toBe(1)
    expect(parsePage('1e3')).toBe(1)
    expect(parsePage('99999999999999999999')).toBe(1)
  })

  it('con el parámetro repetido manda el primero', () => {
    expect(parsePage(['4', '9'])).toBe(4)
  })

  it('max acota la página', () => {
    expect(parsePage('40', { max: 29 })).toBe(29)
    expect(parsePage('2', { max: 29 })).toBe(2)
    expect(parsePage('5', { max: 0 })).toBe(1)
  })
})

describe('cuentas de páginas', () => {
  it('pageCount: una lista vacía tiene una página', () => {
    expect(pageCount(702, 25)).toBe(29)
    expect(pageCount(25, 25)).toBe(1)
    expect(pageCount(26, 25)).toBe(2)
    expect(pageCount(0, 25)).toBe(1)
    expect(pageCount(10, 0)).toBe(1)
  })

  it('clampPage deja la página dentro de rango', () => {
    expect(clampPage(40, 29)).toBe(29)
    expect(clampPage(0, 29)).toBe(1)
    expect(clampPage(3.7, 29)).toBe(3)
    expect(clampPage(Number.NaN, 29)).toBe(1)
  })

  it('pageSlice da el .range() de PostgREST (base 0, inclusivo)', () => {
    expect(pageSlice(1, 25)).toEqual({ from: 0, to: 24 })
    expect(pageSlice(3, 25)).toEqual({ from: 50, to: 74 })
    expect(pageSlice(0, 25)).toEqual({ from: 0, to: 24 })
  })

  it('pageRange da la primera y la última fila visibles', () => {
    expect(pageRange(1, 25, 702)).toEqual({ first: 1, last: 25 })
    expect(pageRange(29, 25, 702)).toEqual({ first: 701, last: 702 })
    expect(pageRange(40, 25, 702)).toEqual({ first: 701, last: 702 })
    expect(pageRange(1, 25, 0)).toEqual({ first: 0, last: 0 })
  })

  it('rangeLabel: «1–25 de 702», miles con punto', () => {
    expect(rangeLabel(1, 25, 702)).toBe('1–25 de 702')
    expect(rangeLabel(2, 25, 1702)).toBe('26–50 de 1.702')
    expect(rangeLabel(2, 25, 26)).toBe('26 de 26')
    expect(rangeLabel(1, 25, 0)).toBe('0 de 0')
  })
})

describe('paginationItems', () => {
  it('si entran todas, sin elipsis', () => {
    expect(paginationItems(1, 1)).toEqual([1])
    expect(paginationItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('extremos, la actual con sus vecinas y «…»', () => {
    expect(paginationItems(15, 29)).toEqual([1, 'start-ellipsis', 14, 15, 16, 'end-ellipsis', 29])
    expect(paginationItems(1, 29)).toEqual([1, 2, 3, 4, 5, 'end-ellipsis', 29])
    expect(paginationItems(29, 29)).toEqual([1, 'start-ellipsis', 25, 26, 27, 28, 29])
    expect(paginationItems(4, 8)).toEqual([1, 2, 3, 4, 5, 'end-ellipsis', 8])
  })

  it('siempre la misma cantidad de lugares: la fila no salta', () => {
    for (let page = 1; page <= 29; page++) {
      const items = paginationItems(page, 29)
      expect(items).toHaveLength(7)
      expect(items).toContain(page)
    }
  })

  it('una página fuera de rango se acota', () => {
    expect(paginationItems(99, 29)).toContain(29)
    expect(paginationItems(-3, 29)[0]).toBe(1)
  })
})

describe('pageHref', () => {
  it('conserva filtros y orden; la página 1 saca el parámetro', () => {
    const sp = { q: 'ana', orden: 'fecha.desc', tag: ['a', 'b'], page: '2' }
    expect(pageHref('/hub/clientes', sp, 3)).toBe(
      '/hub/clientes?q=ana&orden=fecha.desc&tag=a&tag=b&page=3',
    )
    expect(pageHref('/hub/clientes', sp, 1)).toBe(
      '/hub/clientes?q=ana&orden=fecha.desc&tag=a&tag=b',
    )
    expect(pageHref('/hub/clientes', {}, 1)).toBe('/hub/clientes')
    expect(PAGE_PARAM).toBe('page')
  })

  it('parámetro propio', () => {
    expect(pageHref('/hub/x', { n: '1' }, 2, { param: 'pagina' })).toBe('/hub/x?n=1&pagina=2')
  })

  it('no escribe undefined ni muta la entrada', () => {
    const sp = { q: undefined, estado: 'activo' }
    expect(pageHref('/hub/x', sp, 2)).toBe('/hub/x?estado=activo&page=2')
    expect(sp).toEqual({ q: undefined, estado: 'activo' })
  })

  it('makePageHref arma el hrefFor de <Pagination>', () => {
    const hrefFor = makePageHref('/hub/reservas', new URLSearchParams('fecha=2026-10-06&page=4'))
    expect(hrefFor(5)).toBe('/hub/reservas?fecha=2026-10-06&page=5')
    expect(hrefFor(1)).toBe('/hub/reservas?fecha=2026-10-06')
  })
})

describe('selección de filas', () => {
  const ROWS = ['a', 'b', 'c', 'd', 'e']

  it('lo elegido sale en el orden de las filas y sin repetidos', () => {
    expect(setRowSelected(ROWS, ['d'], 'b', true)).toEqual(['b', 'd'])
    expect(setRowSelected(ROWS, ['b', 'd'], 'b', false)).toEqual(['d'])
    expect(pruneSelection(ROWS, ['e', 'a', 'a'])).toEqual(['a', 'e'])
  })

  it('lo que ya no está en pantalla se suelta', () => {
    expect(pruneSelection(['c', 'd'], ['a', 'c', 'z'])).toEqual(['c'])
    expect(pruneSelection(ROWS, [])).toEqual([])
  })

  it('Mayús + click marca el rango desde la última tocada, en los dos sentidos', () => {
    expect(selectRange(ROWS, ['a'], 'a', 'd', true)).toEqual(['a', 'b', 'c', 'd'])
    expect(selectRange(ROWS, [], 'e', 'c', true)).toEqual(['c', 'd', 'e'])
    expect(selectRange(ROWS, ['a', 'b', 'c', 'd'], 'b', 'c', false)).toEqual(['a', 'd'])
  })

  it('sin ancla (o con un ancla que ya no está) es un click común', () => {
    expect(selectRange(ROWS, ['a'], null, 'c', true)).toEqual(['a', 'c'])
    expect(selectRange(ROWS, ['a'], 'z', 'c', true)).toEqual(['a', 'c'])
  })

  it('«elegir todo»: vacía, con guion o marcada', () => {
    expect(headerCheckedState(ROWS, [])).toBe(false)
    expect(headerCheckedState(ROWS, ['b'])).toBe('indeterminate')
    expect(headerCheckedState(ROWS, selectAllRows(ROWS))).toBe(true)
    expect(headerCheckedState(ROWS, ['z'])).toBe(false)
    expect(headerCheckedState([], ['a'])).toBe(false)
  })

  it('selectionLabel dice cuántas', () => {
    expect(selectionLabel(1)).toBe('1 elegido')
    expect(selectionLabel(3)).toBe('3 elegidos')
    expect(selectionLabel(1200)).toBe('1.200 elegidos')
  })
})
