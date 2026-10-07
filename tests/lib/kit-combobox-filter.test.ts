// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  type EntityOption,
  filterOptions,
  groupEntries,
  matchOption,
  normalizeSearchText,
} from '@/components/ui/combobox'
import { entitySearchResponseSchema, searchQuerySchema } from '@/lib/search/entity-option'

/**
 * El filtro estático del Combobox del kit (§3.2): sin tildes, prefijo antes que
 * inicio de palabra antes que «contiene», la negrita en la parte que coincide
 * (en posiciones del texto original, aunque tenga tildes) y los grupos en
 * orden. Y el contrato de las búsquedas por Route Handler.
 */

const option = (label: string, extra: Partial<EntityOption> = {}): EntityOption => ({
  value: label.toLowerCase(),
  label,
  ...extra,
})

describe('sin tildes ni mayúsculas', () => {
  it('«Ñandú» y «nandu» se encuentran', () => {
    expect(normalizeSearchText('Ñandú')).toBe('nandu')
    expect(normalizeSearchText('CAFÉ Martínez')).toBe('cafe martinez')
  })
})

describe('matchOption', () => {
  it('prefijo, inicio de palabra, contiene y solo por la descripción', () => {
    expect(matchOption(option('Coca-Cola'), 'coca')?.rank).toBe(0)
    expect(matchOption(option('Coca-Cola'), 'cola')?.rank).toBe(1)
    expect(matchOption(option('Distribuidora Norte'), 'norte')?.rank).toBe(1)
    expect(matchOption(option('Quilmes'), 'mes')?.rank).toBe(2)
    expect(
      matchOption(option('Coca-Cola', { description: 'CUIT 30-50000000-7' }), '30-5')?.rank,
    ).toBe(3)
    expect(matchOption(option('Fernet', { keywords: ['branca'] }), 'branca')?.rank).toBe(3)
    expect(matchOption(option('Quilmes'), 'stella')).toBeNull()
  })

  it('la negrita cae en el texto original, aunque tenga tildes', () => {
    const label = 'Café Martínez'
    const match = matchOption(option(label), 'martinez')
    expect(match?.range).toEqual([5, 13])
    const [start, end] = match?.range ?? [0, 0]
    expect(label.slice(start, end)).toBe('Martínez')
    expect(matchOption(option(label), 'CAFE')?.range).toEqual([0, 4])
  })

  it('la búsqueda vacía coincide con todo', () => {
    expect(matchOption(option('Quilmes'), '  ')).toEqual({ rank: 2, range: null })
  })
})

describe('filterOptions', () => {
  const options = [
    option('Supermercado La Cola'),
    option('Colanta'),
    option('Coca-Cola'),
    option('Chocolatería'),
    option('Bodega Colón'),
  ]

  it('ordena prefijo, inicio de palabra y contiene; a igual puntaje, el orden original', () => {
    expect(filterOptions(options, 'col').map((e) => e.option.label)).toEqual([
      'Colanta',
      'Supermercado La Cola',
      'Coca-Cola',
      'Bodega Colón',
      'Chocolatería',
    ])
  })

  it('con la búsqueda vacía devuelve todo, en orden y sin negrita', () => {
    const all = filterOptions(options, '')
    expect(all.map((e) => e.option.label)).toEqual(options.map((o) => o.label))
    expect(all.every((e) => e.range === null)).toBe(true)
  })

  it('sin tildes: «colon» encuentra «Colón»', () => {
    expect(filterOptions(options, 'colon').map((e) => e.option.label)).toEqual(['Bodega Colón'])
  })
})

describe('groupEntries', () => {
  it('los grupos en el orden de su primera opción; lo que no tiene grupo, primero', () => {
    const entries = [
      { option: option('Caja', { group: 'Disponibilidades' }) },
      { option: option('Proveedores', { group: 'Deudas' }) },
      { option: option('Banco', { group: 'Disponibilidades' }) },
      { option: option('Sin rubro') },
    ]
    expect(
      groupEntries(entries).map((g) => [g.group, g.entries.map((e) => e.option.label)]),
    ).toEqual([
      [null, ['Sin rubro']],
      ['Disponibilidades', ['Caja', 'Banco']],
      ['Deudas', ['Proveedores']],
    ])
  })
})

describe('contrato de la búsqueda por Route Handler', () => {
  it('q: recortado, de 2 a 80 caracteres, con mensajes en castellano', () => {
    expect(searchQuerySchema.parse('  coca ')).toBe('coca')
    const short = searchQuerySchema.safeParse('c')
    expect(short.success).toBe(false)
    expect(short.error?.issues[0]?.message).toBe('Escribí al menos 2 letras para buscar.')
    expect(searchQuerySchema.safeParse('x'.repeat(81)).success).toBe(false)
  })

  it('la respuesta: { options } con lo serializable de cada opción', () => {
    const ok = entitySearchResponseSchema.safeParse({
      options: [{ value: 'p1', label: 'Coca-Cola', description: 'CUIT 30-50000000-7' }],
    })
    expect(ok.success).toBe(true)
    expect(
      entitySearchResponseSchema.safeParse({ options: [{ label: 'sin valor' }] }).success,
    ).toBe(false)
    expect(entitySearchResponseSchema.safeParse([{ value: 'p1', label: 'x' }]).success).toBe(false)
  })
})
