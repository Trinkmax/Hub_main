import { describe, expect, it } from 'vitest'
import {
  buildCartaRoots,
  cartaGreeting,
  cartaHash,
  daypartOf,
  foldText,
  hasMedia,
  parseCartaHash,
  resolveCartaPlace,
  rootSummary,
  sectionLayout,
  slugify,
} from '@/lib/menu/carta'
import { item, node, sampleTree } from './menu-carta-fixtures'

describe('los rubros y sus secciones', () => {
  const roots = buildCartaRoots(sampleTree())

  it('un rubro sin productos no existe para el cliente', () => {
    expect(roots.map((root) => root.name)).toEqual(['Comida', 'Bebidas', 'Vinos', 'Postres'])
  })

  it('las secciones salen en el orden del árbol y solo las que tienen algo', () => {
    const comida = roots[0]
    expect(comida?.sections.map((section) => section.title)).toEqual([
      'Hamburguesas',
      'Pizza',
      'Tablas y milanesas',
      'Pastas Hub',
    ])
    expect(comida?.itemCount).toBe(10)
    // «Postres» tiene sus productos sueltos y un subrubro vacío: queda una sola sección.
    const postres = roots[3]
    expect(postres?.sections).toHaveLength(1)
    expect(postres?.sections[0]?.title).toBe('Postres')
  })

  it('cada lugar tiene una dirección única, aunque se llamen igual', () => {
    const bebidas = roots[1]
    expect(bebidas?.slug).toBe('bebidas')
    expect(bebidas?.sections.map((section) => section.slug)).toEqual([
      'tragos-hub',
      'bebidas',
      'bebidas-calientes',
    ])
    const twins = buildCartaRoots([
      node('Bebidas', { items: [item('Agua')] }),
      node('Bebidas', { items: [item('Soda')] }),
      node('¡¡!!', { items: [item('Sorpresa')] }),
    ])
    expect(twins.map((root) => root.slug)).toEqual(['bebidas', 'bebidas-2', 'rubro'])
  })

  it('un rubro con productos propios y subrubros muestra primero los suyos', () => {
    const [root] = buildCartaRoots([
      node('Bebidas', {
        items: [item('Agua')],
        children: [node('Tragos', { items: [item('Mojito')] })],
      }),
    ])
    expect(root?.sections.map((section) => section.title)).toEqual(['Bebidas', 'Tragos'])
  })

  it('más abajo del segundo nivel, la sección dice de dónde viene', () => {
    const [root] = buildCartaRoots([
      node('Vinos', {
        children: [
          node('Tintos', {
            items: [item('Malbec de la casa')],
            children: [node('Reserva', { items: [item('Gran reserva')] })],
          }),
        ],
      }),
    ])
    expect(root?.sections.map((section) => section.title)).toEqual(['Tintos', 'Tintos · Reserva'])
  })

  it('dice corto lo que hay adentro', () => {
    expect(rootSummary(roots[0] ?? { sections: [], itemCount: 0 })).toBe('4 secciones')
    expect(rootSummary(roots[3] ?? { sections: [], itemCount: 0 })).toBe('3 opciones')
    expect(rootSummary({ sections: [{} as never], itemCount: 1 })).toBe('1 opción')
  })
})

describe('galería o lista', () => {
  it('con la mayoría con foto, galería', () => {
    expect(sectionLayout([item('a'), item('b'), item('c', { photo: false })])).toBe('gallery')
  })

  it('una carta de vinos con dos fotos entre quince, lista', () => {
    const wines = Array.from({ length: 15 }, (_, index) =>
      item(`Vino ${index}`, { photo: index < 2 }),
    )
    expect(sectionLayout(wines)).toBe('list')
  })

  it('un video cuenta como foto (trae su cuadro de portada)', () => {
    expect(hasMedia(item('Trago', { photo: false, video: true }))).toBe(true)
    expect(hasMedia(item('Trago', { photo: false }))).toBe(false)
  })

  it('sin productos no hay galería', () => {
    expect(sectionLayout([])).toBe('list')
  })

  it('lo decide por sección', () => {
    const bebidas = buildCartaRoots(sampleTree())[1]
    expect(bebidas?.sections.map((section) => section.layout)).toEqual([
      'gallery',
      'gallery',
      'list',
    ])
  })
})

describe('la dirección de cada lugar', () => {
  const roots = buildCartaRoots(sampleTree())

  it('arma direcciones que se pueden leer', () => {
    expect(slugify('Tragos HUB!')).toBe('tragos-hub')
    expect(slugify('Brunch & Café')).toBe('brunch-cafe')
    expect(slugify('Té y bebidas frías')).toBe('te-y-bebidas-frias')
    expect(foldText('  Ñoquis   de PAPA ')).toBe('noquis de papa')
  })

  it('va y vuelve', () => {
    expect(parseCartaHash('')).toEqual({ root: null, section: null })
    expect(parseCartaHash('#')).toEqual({ root: null, section: null })
    expect(parseCartaHash('#bebidas')).toEqual({ root: 'bebidas', section: null })
    expect(parseCartaHash('#bebidas/tragos-hub')).toEqual({
      root: 'bebidas',
      section: 'tragos-hub',
    })
    expect(cartaHash({ root: null, section: null })).toBe('')
    expect(cartaHash({ root: 'bebidas', section: null })).toBe('#bebidas')
    expect(cartaHash({ root: 'bebidas', section: 'tragos-hub' })).toBe('#bebidas/tragos-hub')
  })

  it('entiende una dirección escrita a mano o mal copiada', () => {
    expect(parseCartaHash('#/Bebidas/Tragos%20HUB!')).toEqual({
      root: 'bebidas',
      section: 'tragos-hub',
    })
    expect(parseCartaHash('#%E0%A4%A')).toEqual({ root: 'e0-a4-a', section: null })
  })

  it('un rubro que ya no está lleva al inicio; una sección que no está, al rubro', () => {
    expect(resolveCartaPlace(roots, { root: 'menu-del-mediodia', section: null })).toEqual({
      root: null,
      section: null,
    })
    const place = resolveCartaPlace(roots, { root: 'comida', section: 'sushi' })
    expect(place.root?.name).toBe('Comida')
    expect(place.section).toBeNull()
    const exact = resolveCartaPlace(roots, { root: 'comida', section: 'pizza' })
    expect(exact.section?.title).toBe('Pizza')
  })
})

describe('el saludo', () => {
  it('sigue la hora del bar', () => {
    expect(daypartOf(6 * 60)).toBe('morning')
    expect(daypartOf(11 * 60 + 59)).toBe('morning')
    expect(daypartOf(12 * 60)).toBe('afternoon')
    expect(daypartOf(19 * 60 + 59)).toBe('afternoon')
    expect(daypartOf(20 * 60)).toBe('night')
    // A las 3 de la mañana en un bar sigue siendo de noche.
    expect(daypartOf(3 * 60)).toBe('night')
    expect(daypartOf(5 * 60 + 59)).toBe('night')
  })

  it('saluda por el nombre si el celular ya es del club', () => {
    expect(cartaGreeting('night')).toBe('Buenas noches')
    expect(cartaGreeting('morning', 'Nacho')).toBe('Buen día, Nacho')
    expect(cartaGreeting('afternoon', '  María José  ')).toBe('Buenas tardes, María')
    expect(cartaGreeting('night', '   ')).toBe('Buenas noches')
  })
})
