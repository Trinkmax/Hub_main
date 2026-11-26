import { describe, expect, it } from 'vitest'
import { buildCartaRoots } from '@/lib/menu/carta'
import {
  buildSearchIndex,
  editDistance,
  queryTokens,
  searchMenu,
  stemToken,
} from '@/lib/menu/search'
import { sampleTree, TAG_NO_ALCOHOL, TAG_VEGGIE } from './menu-carta-fixtures'

const index = buildSearchIndex(buildCartaRoots(sampleTree()))
const names = (query: string, tagId?: string) =>
  searchMenu(index, query, { tagId }).items.map((hit) => hit.entry.item.name)

describe('lo que se escribe', () => {
  it('singular y plural son la misma palabra', () => {
    expect(stemToken('hamburguesas')).toBe(stemToken('hamburguesa'))
    expect(stemToken('especiales')).toBe(stemToken('especial'))
    expect(stemToken('postres')).toBe(stemToken('postre'))
    expect(stemToken('vinos')).toBe('vino')
    // Las cortas no se tocan: «tés» no es «te», «gin» no pierde nada.
    expect(stemToken('tes')).toBe('tes')
    expect(stemToken('gin')).toBe('gin')
  })

  it('las palabras de relleno no cuentan, salvo que sean lo único', () => {
    expect(queryTokens('tabla de quesos')).toEqual(['tabla', 'queso'])
    expect(queryTokens('Sin Alcohol')).toEqual(['sin', 'alcohol'])
    expect(queryTokens('con')).toEqual(['con'])
    expect(queryTokens('   ')).toEqual([])
  })

  it('cuenta las letras cambiadas, de más, de menos o dadas vuelta', () => {
    expect(editDistance('capuchino', 'capuccino', 2)).toBe(1)
    expect(editDistance('hamburgesa', 'hamburguesa', 2)).toBe(1)
    expect(editDistance('mojtio', 'mojito', 1)).toBe(1)
    expect(editDistance('pizza', 'pasta', 1)).toBe(2)
    expect(editDistance('vino', 'vino', 0)).toBe(0)
  })
})

describe('buscar en la carta', () => {
  it('con menos de dos letras no busca', () => {
    expect(searchMenu(index, '').items).toEqual([])
    expect(searchMenu(index, 'p').items).toEqual([])
    expect(searchMenu(index, ' . ').items).toEqual([])
  })

  it('encuentra por el nombre de la sección: «hamburguesa» trae las hamburguesas', () => {
    // Ninguna se llama «hamburguesa»: antes este buscador no traía nada.
    expect(names('hamburguesa')).toEqual(
      expect.arrayContaining(['Clasica SIMPLE', 'Bacon burger DOBLE', 'Portobello y Fontina']),
    )
    expect(names('hamburguesas')).toHaveLength(names('hamburguesa').length)
  })

  it('«pizza» trae todas las pizzas, primero la que lo lleva en el nombre', () => {
    const found = names('pizza')
    expect(found[0]).toBe('Pizza explosiva')
    expect(found).toEqual(expect.arrayContaining(['Muzzarella', 'Especial']))
  })

  it('no le importan tildes, mayúsculas ni signos', () => {
    expect(names('ÑOQUIS')[0]).toBe('Ñoquis de papa')
    expect(names('noquis')[0]).toBe('Ñoquis de papa')
    expect(names('lagrima')[0]).toBe('Lágrima')
    expect(names('porhub')).toEqual([])
    expect(names('por hub')[0]).toBe('Por*Hub')
    expect(names('te')[0]).toBe('Tés')
  })

  it('encuentra mientras se va escribiendo', () => {
    expect(names('mila')).toEqual(
      expect.arrayContaining(['Milanesa napolitana', 'Sandwich de milanesa']),
    )
    expect(names('muzza')[0]).toBe('Muzzarella')
    expect(names('capu')[0]).toBe('Capuccino')
  })

  it('perdona un error de dedo', () => {
    expect(names('hamburgesa')).toEqual(expect.arrayContaining(['Bacon burger DOBLE']))
    expect(names('capuchino')[0]).toBe('Capuccino')
    expect(names('milaneza')[0]).toBe('Milanesa napolitana')
    expect(names('chocotrota')[0]).toBe('Chocotorta')
  })

  it('en la descripción no perdona errores (aparecen parecidos por casualidad)', () => {
    // «pizca de orégano» no es una pizza.
    expect(names('pizza')).not.toContain('Milanesa napolitana')
    // «mozzarella» está en la descripción de la milanesa: escrito bien la trae, mal no.
    expect(names('mozzarella')).toContain('Milanesa napolitana')
    expect(names('mozarela')).not.toContain('Milanesa napolitana')
  })

  it('entiende cómo se pide en la barra', () => {
    expect(names('fernet')).toContain('Branca y Cola')
    expect(names('birra')).toEqual(
      expect.arrayContaining(['Botella Stella Artois 1 litro', 'Corona 330ml']),
    )
    expect(names('cerveza')).toEqual(
      expect.arrayContaining(['Botella Stella Artois 1 litro', 'Corona 330ml']),
    )
    expect(names('cafe')).toEqual(expect.arrayContaining(['Capuccino', 'Lágrima', 'Espresso']))
    expect(names('celiaco')).toContain('Cheesecake sin TACC')
    expect(names('vino')).toEqual(expect.arrayContaining(['Andillian', 'Lúi Umile - Malbec']))
  })

  it('…pero en un solo sentido: «stella» no trae la Corona', () => {
    expect(names('stella')).toEqual(['Botella Stella Artois 1 litro'])
  })

  it('con varias palabras, tienen que estar todas', () => {
    expect(names('bacon doble')).toEqual(['Bacon burger DOBLE'])
    expect(names('gin tonic')).toEqual(['Blu Gin Tonic'])
    expect(names('milanesa sushi')).toEqual([])
  })

  it('ordena: el nombre antes que la etiqueta, la sección y la descripción', () => {
    const found = names('sin alcohol')
    expect(found[0]).toBe('Daiquiri sin alcohol')
    expect(found).toContain('Agua o Soda')
    // La que solo lo dice en la descripción y además lleva la etiqueta, después.
    expect(found.indexOf('Coca, Sprite, Coca Zero')).toBeGreaterThan(0)
    const papas = names('papas')
    // «Ñoquis de papa» lo lleva en el nombre; las que vienen con papas fritas, al final.
    expect(papas[0]).toBe('Ñoquis de papa')
    expect(papas.indexOf('Clasica SIMPLE')).toBeGreaterThan(0)
  })

  it('dice dónde está cada cosa', () => {
    const [hit] = searchMenu(index, 'bacon').items
    expect(hit?.entry.where).toBe('Comida › Hamburguesas')
    expect(hit?.entry.rootSlug).toBe('comida')
    expect(hit?.entry.sectionSlug).toBe('hamburguesas')
    // Un rubro de una sola sección no se repite.
    expect(searchMenu(index, 'flan').items[0]?.entry.where).toBe('Postres')
  })

  it('marca qué parte del nombre coincide', () => {
    const [hit] = searchMenu(index, 'mila').items
    const name = hit?.entry.item.name ?? ''
    expect(hit?.ranges.map(([from, to]) => name.slice(from, to))).toEqual(['Mila'])
    const [gin] = searchMenu(index, 'gin tonic').items
    const ginName = gin?.entry.item.name ?? ''
    // Dos palabras seguidas se marcan cada una (hay un espacio en el medio).
    expect(gin?.ranges.map(([from, to]) => ginName.slice(from, to))).toEqual(['Gin', 'Tonic'])
    // Por la sección o por cómo se dice no se marca nada en el nombre.
    expect(searchMenu(index, 'fernet').items[0]?.ranges).toEqual([])
  })

  it('respeta el máximo', () => {
    expect(searchMenu(index, 'papas', { limit: 2 }).items).toHaveLength(2)
  })
})

describe('buscar por etiqueta', () => {
  it('con la etiqueta sola, todo lo que la lleva, en el orden de la carta', () => {
    expect(names('', TAG_NO_ALCOHOL.id)).toEqual([
      'Daiquiri sin alcohol',
      'Agua o Soda',
      'Coca, Sprite, Coca Zero',
    ])
    expect(names('', TAG_VEGGIE.id)).toEqual(['Portobello y Fontina'])
  })

  it('con etiqueta y texto, busca adentro de la etiqueta', () => {
    expect(names('coca', TAG_NO_ALCOHOL.id)).toEqual(['Coca, Sprite, Coca Zero'])
    expect(names('bacon', TAG_VEGGIE.id)).toEqual([])
  })
})

describe('los atajos a secciones', () => {
  const places = (query: string) =>
    searchMenu(index, query).sections.map((section) =>
      section.sectionSlug ? `${section.rootName} › ${section.title}` : section.title,
    )

  it('ofrece ir a la sección que se llama como lo escrito', () => {
    expect(places('piz')).toEqual(['Comida › Pizza'])
    expect(places('hamburgesa')).toEqual(['Comida › Hamburguesas'])
    expect(places('tragos')).toEqual(['Bebidas › Tragos HUB!'])
  })

  it('ofrece el rubro entero, y una sola vez si es de una sola sección', () => {
    expect(places('comida')).toEqual(['Comida'])
    expect(places('postres')).toEqual(['Postres'])
    // «Bebidas» es un rubro y además una sección adentro: van las dos (y «Bebidas Calientes»).
    expect(places('bebidas')).toEqual([
      'Bebidas',
      'Bebidas › Bebidas',
      'Bebidas › Bebidas Calientes',
    ])
  })

  it('sin coincidencia en el nombre no ofrece nada', () => {
    expect(places('bacon')).toEqual([])
    expect(searchMenu(index, 'coca', { tagId: TAG_NO_ALCOHOL.id }).sections).toEqual([])
  })
})
