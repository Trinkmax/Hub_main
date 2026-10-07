import { describe, expect, it } from 'vitest'
import {
  ariaSort,
  compareText,
  formatSort,
  makeSortHref,
  nextSortDir,
  parseSort,
  SORT_PARAM,
  type SortState,
  sameSort,
  sortHref,
  sortRows,
} from '@/lib/table/sort'

/**
 * Kit HUB §3.6: orden de tablas por URL (`?orden=key.dir`) y en memoria
 * (`useTableSort`). Lo que se fija:
 * 1. La key de la URL se valida contra lo que la página declaró: nunca llega
 *    a `.order()` una columna inventada.
 * 2. Cambiar el orden conserva los filtros y vuelve a la página 1.
 * 3. En memoria: estable, faltantes al final en los dos sentidos, castellano
 *    («ñ» después de «n», sin tildes) y números por su valor.
 */

const COLUMNS = { nombre: 'asc', fecha: 'desc', saldo: 'desc' } as const
const FALLBACK: SortState = { key: 'nombre', dir: 'asc' }

describe('parseSort', () => {
  it('lee key.dir', () => {
    expect(parseSort('fecha.asc', COLUMNS)).toEqual({ key: 'fecha', dir: 'asc' })
    expect(parseSort('saldo.desc', COLUMNS)).toEqual({ key: 'saldo', dir: 'desc' })
  })

  it('la key sola toma el sentido inicial de su columna', () => {
    expect(parseSort('fecha', COLUMNS)).toEqual({ key: 'fecha', dir: 'desc' })
    expect(parseSort('nombre', COLUMNS)).toEqual({ key: 'nombre', dir: 'asc' })
  })

  it('con una lista, todas empiezan ascendentes', () => {
    expect(parseSort('nombre', ['nombre', 'fecha'])).toEqual({ key: 'nombre', dir: 'asc' })
    expect(parseSort('fecha.desc', ['nombre', 'fecha'])).toEqual({ key: 'fecha', dir: 'desc' })
  })

  it('una key que la página no declaró cae al fallback', () => {
    expect(parseSort('password.asc', COLUMNS, FALLBACK)).toEqual(FALLBACK)
    expect(parseSort('nombre;drop table', COLUMNS, FALLBACK)).toEqual(FALLBACK)
    expect(parseSort('password', COLUMNS)).toBeUndefined()
  })

  it('las claves del prototipo no son columnas', () => {
    expect(parseSort('constructor', COLUMNS, FALLBACK)).toEqual(FALLBACK)
    expect(parseSort('__proto__.asc', COLUMNS, FALLBACK)).toEqual(FALLBACK)
    expect(parseSort('toString', COLUMNS)).toBeUndefined()
  })

  it('vacío, null o ausente → fallback', () => {
    expect(parseSort(undefined, COLUMNS, FALLBACK)).toEqual(FALLBACK)
    expect(parseSort(null, COLUMNS, FALLBACK)).toEqual(FALLBACK)
    expect(parseSort('   ', COLUMNS, FALLBACK)).toEqual(FALLBACK)
  })

  it('un sufijo que no es asc/desc es parte de la key', () => {
    expect(parseSort('fecha.arriba', COLUMNS, FALLBACK)).toEqual(FALLBACK)
    expect(parseSort('cliente.nombre', ['cliente.nombre'])).toEqual({
      key: 'cliente.nombre',
      dir: 'asc',
    })
    expect(parseSort('cliente.nombre.desc', ['cliente.nombre'])).toEqual({
      key: 'cliente.nombre',
      dir: 'desc',
    })
  })

  it('con el parámetro repetido manda el primero', () => {
    expect(parseSort(['saldo.asc', 'fecha.desc'], COLUMNS)).toEqual({ key: 'saldo', dir: 'asc' })
  })
})

describe('formato y estado de la columna', () => {
  it('formatSort escribe la forma de PostgREST', () => {
    expect(formatSort({ key: 'fecha', dir: 'desc' })).toBe('fecha.desc')
    expect(SORT_PARAM).toBe('orden')
  })

  it('formatSort y parseSort son inversos', () => {
    const sort: SortState = { key: 'saldo', dir: 'asc' }
    expect(parseSort(formatSort(sort), COLUMNS)).toEqual(sort)
  })

  it('nextSortDir alterna la actual y arranca las otras con su sentido inicial', () => {
    expect(nextSortDir({ key: 'fecha', dir: 'desc' }, 'fecha')).toBe('asc')
    expect(nextSortDir({ key: 'fecha', dir: 'asc' }, 'fecha', 'desc')).toBe('desc')
    expect(nextSortDir({ key: 'fecha', dir: 'desc' }, 'nombre')).toBe('asc')
    expect(nextSortDir({ key: 'nombre', dir: 'asc' }, 'fecha', 'desc')).toBe('desc')
    expect(nextSortDir(undefined, 'saldo', 'desc')).toBe('desc')
  })

  it('ariaSort solo dice algo en la columna ordenada', () => {
    const sort: SortState = { key: 'fecha', dir: 'desc' }
    expect(ariaSort(sort, 'fecha')).toBe('descending')
    expect(ariaSort({ key: 'fecha', dir: 'asc' }, 'fecha')).toBe('ascending')
    expect(ariaSort(sort, 'nombre')).toBe('none')
    expect(ariaSort(undefined, 'nombre')).toBe('none')
  })

  it('sameSort compara key y sentido', () => {
    expect(sameSort({ key: 'a', dir: 'asc' }, { key: 'a', dir: 'asc' })).toBe(true)
    expect(sameSort({ key: 'a', dir: 'asc' }, { key: 'a', dir: 'desc' })).toBe(false)
    expect(sameSort(undefined, undefined)).toBe(true)
    expect(sameSort({ key: 'a', dir: 'asc' }, undefined)).toBe(false)
  })
})

describe('sortHref', () => {
  it('conserva los filtros (también los repetidos) y vuelve a la página 1', () => {
    const href = sortHref(
      '/hub/proveedores',
      { q: 'coca', tag: ['a', 'b'], page: '3' },
      { key: 'saldo', dir: 'desc' },
    )
    const url = new URL(href, 'https://x.test')
    expect(url.pathname).toBe('/hub/proveedores')
    expect(url.searchParams.get('orden')).toBe('saldo.desc')
    expect(url.searchParams.get('q')).toBe('coca')
    expect(url.searchParams.getAll('tag')).toEqual(['a', 'b'])
    expect(url.searchParams.has('page')).toBe(false)
  })

  it('volver al orden por defecto deja la URL limpia', () => {
    expect(
      sortHref('/hub/proveedores', { orden: 'saldo.desc' }, FALLBACK, { fallback: FALLBACK }),
    ).toBe('/hub/proveedores')
  })

  it('respeta los nombres de parámetro propios y pageParam: false', () => {
    const href = sortHref(
      '/hub/x',
      new URLSearchParams('pagina=2&sort=a.asc'),
      { key: 'b', dir: 'asc' },
      { param: 'sort', pageParam: false },
    )
    expect(href).toBe('/hub/x?pagina=2&sort=b.asc')
  })

  it('no muta los searchParams que recibe', () => {
    const sp = { page: '4', q: 'x' }
    sortHref('/hub/x', sp, { key: 'nombre', dir: 'desc' })
    expect(sp).toEqual({ page: '4', q: 'x' })
  })

  it('makeSortHref arma la función que espera DataTable', () => {
    const hrefFor = makeSortHref('/hub/clientes', { q: 'ana', page: '2' })
    expect(hrefFor('fecha', 'asc')).toBe('/hub/clientes?q=ana&orden=fecha.asc')
  })
})

describe('compareText', () => {
  it('sin tildes ni mayúsculas', () => {
    expect(compareText('Álvarez', 'alvarez')).toBe(0)
    expect(compareText('éclair', 'Ezequiel')).toBeLessThan(0)
  })

  it('la ñ va después de la n y antes de la o', () => {
    const words = ['oca', 'ñandú', 'nutria', 'Nadia']
    expect([...words].sort(compareText)).toEqual(['Nadia', 'nutria', 'ñandú', 'oca'])
  })

  it('la ñ descompuesta (NFD) también', () => {
    expect(compareText('ñandu', 'nz')).toBeGreaterThan(0)
  })

  it('los números van por su valor', () => {
    const tables = ['Mesa 10', 'Mesa 2', 'Mesa 1', 'Mesa 02']
    expect([...tables].sort(compareText)).toEqual(['Mesa 1', 'Mesa 2', 'Mesa 02', 'Mesa 10'])
    expect(compareText('9999999999999999999', '10000000000000000000')).toBeLessThan(0)
  })
})

type Item = { name: string; balance: number | null; date: string | null; big?: bigint }

const ITEMS: Item[] = [
  { name: 'Coca-Cola', balance: 300, date: '2026-09-01' },
  { name: 'Arcor', balance: null, date: '2026-10-01' },
  { name: 'Ñuke', balance: 100, date: null },
  { name: 'Baggio', balance: 300, date: '2026-08-15' },
  { name: 'Nestlé', balance: -50, date: '2026-09-30' },
]

const ACCESSORS = {
  nombre: (r: Item) => r.name,
  saldo: (r: Item) => r.balance,
  fecha: (r: Item) => (r.date ? new Date(`${r.date}T12:00:00`) : null),
}

describe('sortRows', () => {
  it('ordena textos en castellano', () => {
    expect(sortRows(ITEMS, ACCESSORS, { key: 'nombre', dir: 'asc' }).map((r) => r.name)).toEqual([
      'Arcor',
      'Baggio',
      'Coca-Cola',
      'Nestlé',
      'Ñuke',
    ])
  })

  it('faltantes al final en los dos sentidos, empates estables', () => {
    const asc = sortRows(ITEMS, ACCESSORS, { key: 'saldo', dir: 'asc' }).map((r) => r.name)
    expect(asc).toEqual(['Nestlé', 'Ñuke', 'Coca-Cola', 'Baggio', 'Arcor'])
    const desc = sortRows(ITEMS, ACCESSORS, { key: 'saldo', dir: 'desc' }).map((r) => r.name)
    // Coca-Cola y Baggio empatan en 300: conservan el orden de llegada.
    expect(desc).toEqual(['Coca-Cola', 'Baggio', 'Ñuke', 'Nestlé', 'Arcor'])
  })

  it('fechas, con la inválida o faltante al final', () => {
    const desc = sortRows(ITEMS, ACCESSORS, { key: 'fecha', dir: 'desc' }).map((r) => r.name)
    expect(desc).toEqual(['Arcor', 'Nestlé', 'Coca-Cola', 'Baggio', 'Ñuke'])
  })

  it('bigint contra bigint y contra number', () => {
    const rows = [{ v: 10n }, { v: 2 }, { v: 3n }]
    expect(sortRows(rows, { v: (r) => r.v }, { key: 'v', dir: 'asc' }).map((r) => r.v)).toEqual([
      2,
      3n,
      10n,
    ])
  })

  it('no muta la entrada y una key sin accessor deja el orden', () => {
    const copy = [...ITEMS]
    const out = sortRows(ITEMS, ACCESSORS, { key: 'inexistente', dir: 'asc' })
    expect(out).toEqual(ITEMS)
    expect(out).not.toBe(ITEMS)
    sortRows(ITEMS, ACCESSORS, { key: 'nombre', dir: 'desc' })
    expect(ITEMS).toEqual(copy)
  })
})
