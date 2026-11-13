// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { cartaTree } from '@/lib/menu/kitchen/routing'
import { buildCartaIndex, searchCarta } from '@/lib/menu/kitchen/search'
import {
  AGUA,
  BEBIDAS,
  CAFE,
  CATEGORIES,
  CESAR,
  CLASICA,
  COMIDA,
  ENSALADAS,
  ESPRESSO,
  HAMBURGUESAS,
  ITEMS,
  MUZZA,
  PIZZA,
  WRAP,
} from './menu-kitchen-fixtures'

/** El buscador: como el de «Precios», pero acá también aparecen las categorías. */

const index = buildCartaIndex(cartaTree(CATEGORIES, ITEMS))

describe('searchCarta', () => {
  it('sin nada escrito no hay búsqueda', () => {
    expect(searchCarta(index, '')).toBeNull()
    expect(searchCarta(index, '   ')).toBeNull()
  })

  it('encuentra la categoría por su nombre, y sus productos por el camino', () => {
    const hits = searchCarta(index, 'hambur')
    expect(hits?.categories).toEqual([HAMBURGUESAS])
    expect(hits?.items).toEqual([CLASICA, WRAP])
  })

  it('no le importan las tildes ni las mayúsculas', () => {
    expect(searchCarta(index, 'CAFE')?.categories).toEqual([CAFE])
    expect(searchCarta(index, 'cesar')?.items).toEqual([CESAR])
    expect(searchCarta(index, 'clásica')?.items).toEqual([CLASICA])
  })

  it('una categoría no aparece solo porque contiene a lo buscado', () => {
    // «pizza» trae la categoría Pizza y la Muzza, pero no a Comida.
    const hits = searchCarta(index, 'pizza')
    expect(hits?.categories).toEqual([PIZZA])
    expect(hits?.items).toEqual([MUZZA])
  })

  it('con dos palabras, las dos tienen que estar', () => {
    const hits = searchCarta(index, 'comida ensalada')
    expect(hits?.items).toEqual([CESAR])
    // «Ensaladas» no se llama «comida ensalada»: como categoría no entra.
    expect(hits?.categories).toEqual([])
  })

  it('trae la categoría de arriba y todo lo suyo', () => {
    const hits = searchCarta(index, 'bebidas')
    expect(hits?.categories).toEqual([BEBIDAS])
    expect(hits?.items).toContain(ESPRESSO)
  })

  it('los productos sin categoría también se encuentran', () => {
    expect(searchCarta(index, 'agua')?.items).toEqual([AGUA])
    expect(searchCarta(index, 'sin categoria')?.items).toEqual([AGUA])
  })

  it('lo que no está, no está', () => {
    expect(searchCarta(index, 'sushi')).toEqual({ categories: [], items: [] })
  })

  it('las categorías de arriba de todo no arrastran un camino falso', () => {
    expect(searchCarta(index, 'sin categoria')?.categories).toEqual([])
    expect(searchCarta(index, 'comida')?.categories).toEqual([COMIDA])
    expect(searchCarta(index, 'ensal')?.categories).toEqual([ENSALADAS])
  })
})
