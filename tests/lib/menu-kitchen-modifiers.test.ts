// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  availableTemplates,
  GROUP_TEMPLATES,
  groupReach,
  groupStatus,
  isSellable,
  isUsable,
  linkedTargets,
  namesSummary,
  nextPosition,
  optionsOf,
  optionsSummary,
  plainName,
  productsWithChoices,
  RULES,
  ruleById,
  ruleOf,
  toPosMenu,
} from '@/lib/menu/kitchen/modifiers'
import { buildMenuIndex, modifierGroupsFor } from '@/lib/pos/order/menu-index'
import {
  BARRA,
  BEBIDAS,
  CAFE,
  CATEGORIES,
  CESAR,
  CHEDDAR,
  CLASICA,
  COCINA,
  COMIDA,
  category,
  ESPRESSO,
  EXTRAS,
  FRIOS,
  GROUPS,
  group,
  HAMBURGUESAS,
  HELADO,
  HIELO,
  ITEMS,
  id,
  JUGOSO,
  LINKS,
  link,
  MOJITO,
  MUZZA,
  OPTIONS,
  option,
  PUNTO,
  SIN,
  snapshot,
  WRAP,
} from './menu-kitchen-fixtures'

/**
 * Las aclaraciones: cómo se elige cada grupo, a qué productos llega y la carta que recibe el
 * mozo. Lo importante: lo que esta pantalla dice que ve el mozo es lo que el mozo ve.
 */

describe('las cuatro maneras de elegir', () => {
  it('cada combinación de la base tiene su nombre', () => {
    expect(ruleOf({ selection: 'single', required: false }).id).toBe('one_optional')
    expect(ruleOf({ selection: 'single', required: true }).id).toBe('one_required')
    expect(ruleOf({ selection: 'multi', required: false }).id).toBe('many_optional')
    expect(ruleOf({ selection: 'multi', required: true }).id).toBe('many_required')
  })

  it('ida y vuelta', () => {
    for (const rule of RULES) {
      expect(ruleOf(ruleById(rule.id))).toBe(rule)
      expect(rule.label.length).toBeGreaterThan(0)
      expect(rule.hint.length).toBeGreaterThan(0)
    }
    expect(new Set(RULES.map((rule) => rule.label)).size).toBe(4)
  })
})

describe('el orden', () => {
  it('las opciones de un grupo, por posición y después por nombre', () => {
    const mixed = [
      option({ id: id('d', 20), groupId: PUNTO, label: 'Zeta', position: 1 }),
      option({ id: id('d', 21), groupId: PUNTO, label: 'Alfa', position: 1 }),
      option({ id: id('d', 22), groupId: PUNTO, label: 'Primera', position: 0 }),
      option({ id: id('d', 23), groupId: SIN, label: 'De otro grupo', position: 0 }),
    ]
    expect(optionsOf(mixed, PUNTO).map((each) => each.label)).toEqual(['Primera', 'Alfa', 'Zeta'])
  })

  it('lo que se agrega va al final', () => {
    expect(nextPosition([])).toBe(0)
    expect(nextPosition([{ position: 0 }, { position: 4 }, { position: 2 }])).toBe(5)
  })
})

describe('groupReach', () => {
  const reach = groupReach(snapshot())

  it('una categoría enganchada llega a todo lo que cuelga de ella', () => {
    // «Sin…» está en Comida: hamburguesas, ensaladas y pizza.
    expect(reach.itemsByGroup.get(SIN)).toEqual([CLASICA, WRAP, CESAR, MUZZA])
  })

  it('un producto enganchado solo lo trae a él', () => {
    expect(reach.itemsByGroup.get(EXTRAS)).toEqual([CLASICA])
  })

  it('un producto junta lo propio y lo de sus categorías, en el orden de los grupos', () => {
    expect(reach.groupsByItem.get(CLASICA)).toEqual([PUNTO, SIN, EXTRAS])
    expect(reach.groupsByItem.get(MUZZA)).toEqual([SIN])
  })

  it('una categoría pausada corta la herencia: lo de adentro no recibe nada de arriba', () => {
    // Espresso está en Café (pausada), que cuelga de Bebidas, donde está «Hielo y limón».
    expect(reach.itemsByGroup.get(HIELO)).toEqual([MOJITO])
    expect(reach.groupsByItem.has(ESPRESSO)).toBe(false)
  })

  it('un producto pausado o sin categoría no cuenta: el mozo no lo puede pedir', () => {
    const everywhere = groupReach(
      snapshot({ links: [...LINKS, link(SIN, 'item', HELADO), link(SIN, 'category', id('c', 8))] }),
    )
    expect(everywhere.itemsByGroup.get(SIN)).not.toContain(HELADO)
    expect(isSellable({ active: true, categoryId: null })).toBe(false)
    expect(isSellable({ active: false, categoryId: COMIDA })).toBe(false)
    expect(isSellable({ active: true, categoryId: COMIDA })).toBe(true)
  })

  it('un enganche a un grupo que no existe no rompe nada', () => {
    const ghost = groupReach(snapshot({ links: [...LINKS, link(id('b', 99), 'item', CLASICA)] }))
    expect(ghost.groupsByItem.get(CLASICA)).toEqual([PUNTO, SIN, EXTRAS])
  })

  it('dice lo mismo que la comanda del mozo', () => {
    // Variantes: categorías pausadas, grupos sin opciones, enganches a productos y a ramas.
    const variants = [
      snapshot(),
      snapshot({
        categories: CATEGORIES.map((each) =>
          each.id === COMIDA ? { ...each, active: false } : each,
        ),
      }),
      snapshot({
        links: [
          ...LINKS,
          link(HIELO, 'item', MUZZA),
          link(PUNTO, 'category', BEBIDAS),
          link(EXTRAS, 'category', CAFE),
        ],
      }),
      snapshot({
        categories: [
          ...CATEGORIES,
          category({ id: id('c', 30), name: 'Smash', parentId: HAMBURGUESAS, position: 9 }),
        ],
        items: [
          ...ITEMS,
          { ...(ITEMS[0] as (typeof ITEMS)[number]), id: id('e', 30), categoryId: id('c', 30) },
        ],
      }),
    ]
    for (const each of variants) {
      const index = buildMenuIndex(toPosMenu(each))
      const mine = groupReach(each)
      const usable = new Set(
        each.groups.filter((one) => isUsable(one, each.options)).map((one) => one.id),
      )
      for (const product of each.items) {
        const waiter = modifierGroupsFor(index, product.id).map((one) => one.id)
        const here = (mine.groupsByItem.get(product.id) ?? []).filter((one) => usable.has(one))
        expect(here, product.name).toEqual(waiter)
      }
    }
  })
})

describe('toPosMenu', () => {
  const menu = toPosMenu(snapshot())

  it('manda solo lo que se vende: categorías activas, productos activos y con categoría', () => {
    expect(menu.categories.map((each) => each.id)).not.toContain(CAFE)
    const sold = menu.items.map((each) => each.id)
    expect(sold).toContain(ESPRESSO) // la base no mira si la categoría del producto está pausada
    expect(sold).not.toContain(HELADO)
    expect(sold).toHaveLength(7)
  })

  it('cada producto lleva su estación ya resuelta', () => {
    const stationOf = (itemId: string) => menu.items.find((each) => each.id === itemId)?.station_id
    expect(stationOf(CLASICA)).toBe(COCINA)
    expect(stationOf(WRAP)).toBe(FRIOS)
    expect(stationOf(MOJITO)).toBe(BARRA)
  })

  it('los grupos van con sus opciones activas en orden y con sus enganches', () => {
    const punto = menu.modifier_groups.find((each) => each.id === PUNTO)
    expect(punto?.options.map((each) => each.label)).toEqual(['Jugoso', 'A punto', 'Bien cocido'])
    expect(punto?.category_ids).toEqual([HAMBURGUESAS])
    const extras = menu.modifier_groups.find((each) => each.id === EXTRAS)
    expect(extras?.item_ids).toEqual([CLASICA])
    expect(extras?.options[0]).toEqual({
      id: CHEDDAR,
      label: 'Extra cheddar',
      delta_cents: 150_000,
    })
  })

  it('lo apagado no viaja: ni grupos, ni opciones, ni estaciones', () => {
    const off = toPosMenu(
      snapshot({
        groups: GROUPS.map((each) => (each.id === SIN ? { ...each, active: false } : each)),
        options: OPTIONS.map((each) => (each.id === JUGOSO ? { ...each, active: false } : each)),
        stations: snapshot().stations.map((each) =>
          each.id === BARRA ? { ...each, active: false } : each,
        ),
      }),
    )
    expect(off.modifier_groups.map((each) => each.id)).not.toContain(SIN)
    expect(
      off.modifier_groups.find((each) => each.id === PUNTO)?.options.map((each) => each.label),
    ).toEqual(['A punto', 'Bien cocido'])
    expect(off.stations.map((each) => each.id)).toEqual([COCINA, FRIOS])
    // La estación apagada sigue resolviéndose: es lo que hace la base.
    expect(off.items.find((each) => each.id === MOJITO)?.station_id).toBe(BARRA)
  })
})

describe('en qué anda un grupo', () => {
  const reach = groupReach(snapshot())
  const find = (groupId: string) =>
    GROUPS.find((each) => each.id === groupId) ?? group({ id: groupId })

  it('listo: lo ven tantos productos', () => {
    expect(groupStatus(find(SIN), OPTIONS, reach)).toEqual({ kind: 'ready', products: 4 })
  })

  it('apagado', () => {
    expect(groupStatus({ ...find(SIN), active: false }, OPTIONS, reach)).toEqual({ kind: 'off' })
  })

  it('sin opciones para tocar, el mozo no lo ve', () => {
    const allOff = OPTIONS.map((each) => (each.groupId === SIN ? { ...each, active: false } : each))
    expect(groupStatus(find(SIN), allOff, reach)).toEqual({ kind: 'no_options' })
    expect(isUsable(find(SIN), [])).toBe(false)
  })

  it('con opciones pero sin productos', () => {
    const loose = group({ id: id('b', 9), name: 'Suelto' })
    const options = [...OPTIONS, option({ id: id('d', 30), groupId: loose.id, label: 'Algo' })]
    const emptyReach = groupReach(snapshot({ groups: [...GROUPS, loose] }))
    expect(groupStatus(loose, options, emptyReach)).toEqual({ kind: 'nowhere' })
  })

  it('cuenta los productos con algo para tocar', () => {
    // Clásica, Wrap, César, Muzza (Sin…) y Mojito (Hielo).
    expect(productsWithChoices(snapshot(), reach)).toBe(5)
    const withoutSin = snapshot({
      groups: GROUPS.map((each) => (each.id === SIN ? { ...each, active: false } : each)),
    })
    // Sin «Sin…» quedan Clásica y Wrap (Punto) y Mojito.
    expect(productsWithChoices(withoutSin, groupReach(withoutSin))).toBe(3)
  })
})

describe('linkedTargets', () => {
  it('nombra cada enganche con su contexto: categorías primero, en el orden de la carta', () => {
    const targets = linkedTargets(
      snapshot({
        links: [
          link(SIN, 'item', MOJITO),
          link(SIN, 'category', HAMBURGUESAS),
          link(SIN, 'category', COMIDA),
        ],
      }),
      SIN,
    )
    expect(targets).toEqual([
      { target: 'category', id: COMIDA, name: 'Comida', context: '', paused: false },
      {
        target: 'category',
        id: HAMBURGUESAS,
        name: 'Hamburguesas',
        context: 'Comida',
        paused: false,
      },
      { target: 'item', id: MOJITO, name: 'Mojito', context: 'Bebidas › Tragos', paused: false },
    ])
  })

  it('marca lo pausado y saltea lo que ya no existe', () => {
    const targets = linkedTargets(
      snapshot({
        links: [
          link(SIN, 'category', CAFE),
          link(SIN, 'item', HELADO),
          link(SIN, 'item', id('e', 99)),
        ],
      }),
      SIN,
    )
    expect(targets.map((each) => [each.name, each.paused])).toEqual([
      ['Café', true],
      ['Helado', true],
    ])
  })
})

describe('las de siempre', () => {
  it('no ofrece la que ya está, sin importar tildes ni mayúsculas', () => {
    const offered = availableTemplates([
      group({ id: id('b', 20), name: 'PUNTO DE LA CARNE' }),
      group({ id: id('b', 21), name: '¿que le sacamos?' }),
    ])
    expect(offered.map((each) => each.key)).toEqual(['extras', 'hielo'])
  })

  it('con el bar vacío ofrece todas', () => {
    expect(availableTemplates([])).toHaveLength(GROUP_TEMPLATES.length)
  })

  it('cada plantilla entra en la base', () => {
    for (const template of GROUP_TEMPLATES) {
      expect(template.name.length).toBeLessThanOrEqual(40)
      expect(template.options.length).toBeGreaterThan(0)
      for (const label of template.options) expect(label.length).toBeLessThanOrEqual(40)
    }
  })

  it('plainName', () => {
    expect(plainName('  ¿Qué le  sacamos? ')).toBe('que le sacamos')
    expect(plainName('Fríos')).toBe('frios')
  })
})

describe('en palabras', () => {
  it('resume las opciones', () => {
    expect(optionsSummary([])).toBe('')
    expect(optionsSummary(['Jugoso', 'A punto'])).toBe('Jugoso · A punto')
    expect(optionsSummary(['a', 'b', 'c', 'd', 'e', 'f'], 4)).toBe('a · b · c · d · y 2 más')
  })

  it('resume los nombres', () => {
    expect(namesSummary([])).toBe('')
    expect(namesSummary(['Hamburguesas'])).toBe('Hamburguesas')
    expect(namesSummary(['Hamburguesas', 'Lomitos'])).toBe('Hamburguesas y Lomitos')
    expect(namesSummary(['Hamburguesas', 'Lomitos', 'Pizza', 'Pastas'])).toBe(
      'Hamburguesas, Lomitos y 2 más',
    )
  })
})
