// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildSearchIndex,
  highlightRanges,
  normalizeSearch,
  searchPrices,
  searchTokens,
} from '@/lib/menu/prices/search'

/**
 * El buscador de «Precios»: el dueño tipea «bacon» y tienen que aparecer los productos que
 * coinciden, sin que importen las tildes ni las mayúsculas, por nombre y por categoría.
 */

const DOCS = [
  { id: 'cheese', name: 'Cheese Burger', path: 'Comida › Hamburguesas' },
  { id: 'bacon', name: 'Bacon Cheese', path: 'Comida › Hamburguesas' },
  { id: 'papas', name: 'Papas con cheddar y bacon', path: 'Comida › Papas, rabas y nachos' },
  { id: 'muzza', name: 'Muzzarella', path: 'Comida › Pizza' },
  { id: 'napo', name: 'Napolitana', path: 'Comida › Pizza' },
  { id: 'cafe', name: 'Café con leche', path: 'Brunch & Café › Bebidas Calientes' },
  { id: 'noquis', name: 'Ñoquis de papa', path: 'Comida › Pastas Hub' },
  { id: 'fernet', name: 'Fernet con Coca', path: 'Bebidas › Tragos HUB!' },
]
const INDEX = buildSearchIndex(DOCS)

describe('normalizeSearch', () => {
  it('saca tildes, mayúsculas y espacios de más', () => {
    expect(normalizeSearch('  Café   CON  Leche ')).toBe('cafe con leche')
    expect(normalizeSearch('Ñoquis')).toBe('noquis')
    expect(normalizeSearch('PIZZA Muzzarélla')).toBe('pizza muzzarella')
  })

  it('las palabras de una búsqueda vacía son ninguna', () => {
    expect(searchTokens('')).toEqual([])
    expect(searchTokens('   ')).toEqual([])
    expect(searchTokens(' Bacón  doble ')).toEqual(['bacon', 'doble'])
  })
})

describe('searchPrices', () => {
  it('sin búsqueda no filtra: devuelve null para mostrar la carta agrupada', () => {
    expect(searchPrices(INDEX, '')).toBeNull()
    expect(searchPrices(INDEX, '   ')).toBeNull()
  })

  it('«bacon» trae los que lo tienen en el nombre, primero el que empieza así', () => {
    expect(searchPrices(INDEX, 'bacon')).toEqual(['bacon', 'papas'])
  })

  it('no le importan las tildes ni las mayúsculas, ni de un lado ni del otro', () => {
    expect(searchPrices(INDEX, 'CAFE')).toEqual(['cafe'])
    expect(searchPrices(INDEX, 'café')).toEqual(['cafe'])
    expect(searchPrices(INDEX, 'noquis')).toEqual(['noquis'])
    expect(searchPrices(INDEX, 'ñoquis')).toEqual(['noquis'])
  })

  it('busca por categoría: «pizza» trae las pizzas aunque no se llamen así', () => {
    expect(searchPrices(INDEX, 'pizza')).toEqual(['muzza', 'napo'])
  })

  it('una coincidencia en el nombre va antes que una en la categoría', () => {
    // «cafe» está en el nombre de uno y en la categoría del mismo; «hamburg» solo en categorías.
    const docs = [
      { id: 'a', name: 'Tostado', path: 'Brunch & Café' },
      { id: 'b', name: 'Café doble', path: 'Bebidas' },
    ]
    expect(searchPrices(buildSearchIndex(docs), 'cafe')).toEqual(['b', 'a'])
  })

  it('con varias palabras tienen que estar todas, en el nombre o en la categoría', () => {
    expect(searchPrices(INDEX, 'cheese bacon')).toEqual(['bacon'])
    expect(searchPrices(INDEX, 'hamburguesas cheese')).toEqual(['cheese', 'bacon'])
    expect(searchPrices(INDEX, 'bacon pizza')).toEqual([])
  })

  it('el comienzo de una palabra pesa más que el medio', () => {
    const docs = [
      { id: 'medio', name: 'Descafeinado', path: 'Bebidas' },
      { id: 'palabra', name: 'Torta de café', path: 'Postres' },
      { id: 'inicio', name: 'Café chico', path: 'Bebidas' },
    ]
    expect(searchPrices(buildSearchIndex(docs), 'cafe')).toEqual(['inicio', 'palabra', 'medio'])
  })

  it('a igual coincidencia respeta el orden de la carta', () => {
    expect(searchPrices(INDEX, 'comida')).toEqual([
      'cheese',
      'bacon',
      'papas',
      'muzza',
      'napo',
      'noquis',
    ])
  })

  it('lo que no está, no está', () => {
    expect(searchPrices(INDEX, 'sushi')).toEqual([])
  })
})

describe('highlightRanges', () => {
  it('marca lo buscado en el texto original, con sus tildes', () => {
    expect(highlightRanges('Café con leche', 'cafe')).toEqual([[0, 4]])
    expect(highlightRanges('Torta de café', 'CAFÉ')).toEqual([[9, 13]])
  })

  it('marca todas las apariciones de cada palabra y une las que se tocan', () => {
    expect(highlightRanges('Papas con cheddar y bacon', 'bacon papas')).toEqual([
      [0, 5],
      [20, 25],
    ])
    expect(highlightRanges('Bananana', 'an na')).toEqual([[1, 8]])
  })

  it('sin búsqueda o sin coincidencia no marca nada', () => {
    expect(highlightRanges('Napolitana', '')).toEqual([])
    expect(highlightRanges('Napolitana', 'bacon')).toEqual([])
    expect(highlightRanges('', 'bacon')).toEqual([])
  })
})
