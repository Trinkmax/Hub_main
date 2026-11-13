import { describe, expect, it } from 'vitest'
import {
  buildBrowseTree,
  buildMenuIndex,
  categoryLabel,
  firstAddable,
  isDrink,
  missingRequired,
  modifierGroupsFor,
  needsChoice,
  quickPicks,
  searchMenu,
  sectionsOf,
  toggleOption,
  validOptionIds,
} from '@/lib/pos/order/menu-index'
import { pickRepeatRound, roundLabel } from '@/lib/pos/order/repeat-round'
import { nearPrefix, normalize, withinOneEdit, wordsOf } from '@/lib/pos/order/text'
import type {
  MenuCategory,
  MenuItem,
  ModifierGroup,
  PosMenu,
  SessionItem,
  SessionTicket,
} from '@/lib/pos/types'

const KITCHEN = 'st-cocina'
const BAR = 'st-barra'

const cat = (id: string, name: string, parent: string | null, position: number): MenuCategory => ({
  id,
  name,
  parent_id: parent,
  position,
  station_id: null,
})

let position = 0
const item = (
  id: string,
  name: string,
  category_id: string,
  over: Partial<MenuItem> = {},
): MenuItem => ({
  id,
  name,
  category_id,
  position: ++position,
  price_cents: 1_000_000,
  description: null,
  station_id: KITCHEN,
  sold_out: false,
  ...over,
})

const categories: MenuCategory[] = [
  cat('comida', 'Comida', null, 1),
  cat('burgers', 'Hamburguesas', 'comida', 1),
  cat('pizza', 'Pizza', 'comida', 2),
  // Dos «Bebidas» en la raíz, como en una carta real cargada a las apuradas.
  cat('bebidas-a', 'Bebidas', null, 2),
  cat('bebidas-b', 'Bebidas', null, 3),
  cat('tragos', 'Tragos HUB!', 'bebidas-b', 1),
  cat('cafe', 'Café', 'bebidas-b', 2),
  cat('postres', 'Postres', null, 4),
  cat('vacia', 'Sin productos', null, 5),
]

const items: MenuItem[] = [
  item('clasica', 'Clásica simple', 'burgers'),
  item('clasica-doble', 'Clásica doble', 'burgers'),
  item('chesse', 'Chesse burger doble', 'burgers'),
  item('muzza', 'Muzzarella', 'pizza'),
  item('especial', '1/2 Especial', 'pizza'),
  item('clasicas', 'Clásicas', 'pizza'),
  item('agua', 'Agua o Soda', 'bebidas-a', { station_id: BAR }),
  item('mojito', 'Mojito', 'tragos', { station_id: BAR }),
  item('mojito-malibu', 'Mojito Malibú', 'tragos', { station_id: BAR }),
  item('fernet', 'Branca y Cola', 'tragos', { station_id: BAR }),
  item('latte', 'Café con Leche / Latte', 'cafe', { station_id: BAR }),
  item('flan', 'Flan casero', 'postres'),
]

const group = (
  over: Partial<ModifierGroup> & Pick<ModifierGroup, 'id' | 'name'>,
): ModifierGroup => ({
  selection: 'multi',
  required: false,
  options: [],
  category_ids: [],
  item_ids: [],
  ...over,
})

const groups: ModifierGroup[] = [
  group({
    id: 'g-punto',
    name: 'Punto de la carne',
    selection: 'single',
    required: true,
    options: [
      { id: 'jugoso', label: 'Jugoso', delta_cents: 0 },
      { id: 'a-punto', label: 'A punto', delta_cents: 0 },
    ],
    category_ids: ['burgers'],
  }),
  group({
    id: 'g-sin',
    name: 'Sin…',
    options: [
      { id: 'sin-cebolla', label: 'Sin cebolla', delta_cents: 0 },
      { id: 'sin-sal', label: 'Sin sal', delta_cents: 0 },
    ],
    // Puesto en la categoría de arriba: vale para todo lo que cuelga de «Comida».
    category_ids: ['comida'],
  }),
  group({
    id: 'g-hielo',
    name: 'Hielo',
    selection: 'single',
    options: [
      { id: 'sin-hielo', label: 'Sin hielo', delta_cents: 0 },
      { id: 'poco-hielo', label: 'Poco hielo', delta_cents: 0 },
    ],
    item_ids: ['mojito'],
  }),
  group({ id: 'g-vacio', name: 'Sin opciones', category_ids: ['comida'] }),
]

function menuWith(over: Partial<PosMenu> = {}): PosMenu {
  return {
    service_day: '2026-11-12',
    categories,
    items,
    stations: [
      { id: KITCHEN, name: 'Cocina', color: '#b45309' },
      { id: BAR, name: 'Barra', color: '#6d28d9' },
    ],
    modifier_groups: groups,
    popular_now: ['mojito', 'clasica', 'muzza'],
    ...over,
  }
}

const index = buildMenuIndex(menuWith())
const names = (list: readonly MenuItem[]) => list.map((i) => i.name)

describe('texto', () => {
  it('normaliza acentos, mayúsculas y signos', () => {
    expect(normalize('  Café c/ Leche ')).toBe('cafe c leche')
    expect(normalize('Ñoquis')).toBe('noquis')
    expect(wordsOf('1/2 Especial')).toEqual(['1', '2', 'especial'])
    expect(wordsOf('  ')).toEqual([])
  })

  it('un dedazo: una letra cambiada, de más, de menos o dos cruzadas', () => {
    expect(withinOneEdit('mojito', 'mojito')).toBe(true)
    expect(withinOneEdit('mojito', 'mokito')).toBe(true)
    expect(withinOneEdit('mojito', 'mojto')).toBe(true)
    expect(withinOneEdit('mojito', 'mojiito')).toBe(true)
    expect(withinOneEdit('mojito', 'mojtio')).toBe(true)
    expect(withinOneEdit('mojito', 'mikoto')).toBe(false)
    expect(withinOneEdit('mojito', 'mojit')).toBe(true)
    expect(withinOneEdit('mojito', 'moj')).toBe(false)
  })

  it('el dedazo solo vale con cuatro letras o más y la misma inicial', () => {
    expect(nearPrefix('chesse', 'chee')).toBe(true)
    expect(nearPrefix('chesse', 'cheese')).toBe(true)
    expect(nearPrefix('hamburguesas', 'hamburgesa')).toBe(true)
    expect(nearPrefix('mojito', 'moj')).toBe(false)
    expect(nearPrefix('mojito', 'nojito')).toBe(false)
  })
})

describe('buscar en la carta', () => {
  it('sin acentos ni mayúsculas; la palabra justa va antes que la que solo empieza igual', () => {
    expect(names(searchMenu(index, 'clasica'))).toEqual([
      'Clásica simple',
      'Clásica doble',
      'Clásicas',
    ])
    expect(names(searchMenu(index, 'CAFÉ'))[0]).toBe('Café con Leche / Latte')
  })

  it('lo que empieza con lo escrito va antes que lo que lo tiene en el medio', () => {
    expect(names(searchMenu(index, 'moj'))).toEqual(['Mojito', 'Mojito Malibú'])
    expect(names(searchMenu(index, 'dob'))).toEqual(['Clásica doble', 'Chesse burger doble'])
  })

  it('el nombre exacto gana', () => {
    expect(names(searchMenu(index, 'mojito malibu'))[0]).toBe('Mojito Malibú')
    expect(names(searchMenu(index, 'clasicas'))[0]).toBe('Clásicas')
  })

  it('encuentra por categoría: «pizza» trae las pizzas aunque ninguna se llame así', () => {
    expect(names(searchMenu(index, 'pizza'))).toEqual(['Muzzarella', 'Clásicas', '1/2 Especial'])
    // Empatan: primero lo que más sale, después en el orden de la carta.
    expect(names(searchMenu(index, 'tragos'))).toEqual(['Mojito', 'Mojito Malibú', 'Branca y Cola'])
  })

  it('con varias palabras, todas tienen que aparecer (en el nombre o en la categoría)', () => {
    expect(names(searchMenu(index, 'pizza muzza'))).toEqual(['Muzzarella'])
    expect(names(searchMenu(index, 'clasica doble'))).toEqual(['Clásica doble'])
    expect(searchMenu(index, 'mojito pizza')).toEqual([])
  })

  it('perdona un dedazo: «cheese» encuentra la «Chesse» de la carta', () => {
    expect(names(searchMenu(index, 'cheese'))).toEqual(['Chesse burger doble'])
    expect(names(searchMenu(index, 'mojto'))).toEqual(['Mojito', 'Mojito Malibú'])
    expect(names(searchMenu(index, 'hamburgesa'))).toContain('Clásica simple')
  })

  it('en palabras cortas el dedazo solo se perdona si lo escrito no existe en la carta', () => {
    // «flam» no existe y está a un dedazo de «flan».
    expect(names(searchMenu(index, 'flam'))).toEqual(['Flan casero'])
    // «clas» existe tal cual: no trae nada «parecido» de más.
    expect(names(searchMenu(index, 'clas'))).toEqual([
      'Clásica simple',
      'Clásicas',
      'Clásica doble',
    ])
  })

  it('lo que coincide de verdad siempre va antes que lo que solo se parece', () => {
    const withTypo = buildMenuIndex(
      menuWith({ items: [...items, item('muza', '1/2 Muzarella', 'pizza')] }),
    )
    expect(names(searchMenu(withTypo, 'muzza'))).toEqual(['Muzzarella', '1/2 Muzarella'])
  })

  it('a igual parecido, primero lo que más sale', () => {
    // «Clásica simple» y «Clásica doble» empatan; la simple está entre lo más pedido.
    const found = names(searchMenu(index, 'clasica'))
    expect(found.indexOf('Clásica simple')).toBeLessThan(found.indexOf('Clásica doble'))
  })

  it('lo agotado sigue apareciendo, pero Enter agrega lo primero que hay', () => {
    const withSoldOut = buildMenuIndex(
      menuWith({ items: items.map((i) => (i.id === 'mojito' ? { ...i, sold_out: true } : i)) }),
    )
    const found = searchMenu(withSoldOut, 'mojito')
    expect(names(found)).toEqual(['Mojito', 'Mojito Malibú'])
    expect(firstAddable(found)?.name).toBe('Mojito Malibú')
    expect(firstAddable([])).toBeNull()
  })

  it('sin escribir nada no devuelve nada, y respeta el tope', () => {
    expect(searchMenu(index, '   ')).toEqual([])
    expect(searchMenu(index, 'c').length).toBeGreaterThan(2)
    expect(searchMenu(index, 'c', 2)).toHaveLength(2)
    expect(searchMenu(index, 'zzzz')).toEqual([])
  })

  it('dice de dónde es cada producto', () => {
    expect(categoryLabel(index, 'pizza')).toBe('Comida › Pizza')
    expect(categoryLabel(index, 'tragos')).toBe('Bebidas › Tragos HUB!')
    expect(categoryLabel(index, 'postres')).toBe('Postres')
  })
})

describe('antes de escribir', () => {
  it('lo que más sale ahora, en orden y sin lo que ya no está en la carta', () => {
    const picks = quickPicks(
      buildMenuIndex(menuWith({ popular_now: ['mojito', 'borrado', 'clasica', 'mojito'] })),
      6,
    )
    expect(picks.source).toBe('popular')
    expect(names(picks.items)).toEqual(['Mojito', 'Clásica simple'])
  })

  it('corta en el tope', () => {
    expect(quickPicks(index, 2).items).toHaveLength(2)
  })

  it('sin historia, lo primero de las categorías más grandes, una de cada una por vuelta', () => {
    const picks = quickPicks(buildMenuIndex(menuWith({ popular_now: [] })), 6)
    expect(picks.source).toBe('menu')
    // Hamburguesas, Pizza y Tragos tienen tres productos cada una.
    expect(names(picks.items)).toEqual([
      'Clásica simple',
      'Muzzarella',
      'Mojito',
      'Clásica doble',
      '1/2 Especial',
      'Mojito Malibú',
    ])
  })

  it('una carta vacía no rompe nada', () => {
    const empty = buildMenuIndex(
      menuWith({ items: [], categories: [], popular_now: [], modifier_groups: [] }),
    )
    expect(quickPicks(empty).items).toEqual([])
    expect(buildBrowseTree(empty)).toEqual([])
    expect(searchMenu(empty, 'algo')).toEqual([])
  })
})

describe('recorrer la carta', () => {
  const tree = buildBrowseTree(index)

  it('raíz → sub, en el orden de la carta, sin ramas vacías', () => {
    expect(tree.map((n) => [n.name, n.count])).toEqual([
      ['Comida', 6],
      ['Bebidas', 5],
      ['Postres', 1],
    ])
    expect(tree[0]?.children.map((n) => n.name)).toEqual(['Hamburguesas', 'Pizza'])
  })

  it('dos hermanas con el mismo nombre son una sola ficha', () => {
    const bebidas = tree[1]
    expect(bebidas?.categoryIds).toEqual(['bebidas-a', 'bebidas-b'])
    expect(names(bebidas?.items ?? [])).toEqual(['Agua o Soda'])
    expect(bebidas?.children.map((n) => n.name)).toEqual(['Tragos HUB!', 'Café'])
  })

  it('al elegir una ficha: lo que cuelga directo y después cada sub con su título', () => {
    const bebidas = tree[1]
    expect(bebidas && sectionsOf(bebidas).map((s) => [s.heading, s.items.length])).toEqual([
      ['Bebidas', 1],
      ['Tragos HUB!', 3],
      ['Café', 1],
    ])
    const postres = tree[2]
    expect(postres && sectionsOf(postres)).toMatchObject([{ heading: null }])
  })

  it('una categoría con el padre borrado se muestra en la raíz', () => {
    const orphan = buildMenuIndex(
      menuWith({
        categories: [cat('pizza', 'Pizza', 'no-existe', 1)],
        items: [items[3] as MenuItem],
      }),
    )
    expect(buildBrowseTree(orphan).map((n) => n.name)).toEqual(['Pizza'])
  })

  it('una categoría que cuelga de sí misma no cuelga la pantalla', () => {
    const loop = buildMenuIndex(
      menuWith({
        categories: [cat('a', 'A', 'b', 1), cat('b', 'B', 'a', 2)],
        items: [item('x', 'Equis', 'a')],
      }),
    )
    expect(categoryLabel(loop, 'a')).toBe('B › A')
    expect(buildBrowseTree(loop)).toEqual([])
  })
})

describe('aclaraciones de un producto', () => {
  const ids = (id: string) => modifierGroupsFor(index, id).map((g) => g.id)

  it('las de su categoría y las de cualquier categoría que la contenga', () => {
    expect(ids('clasica')).toEqual(['g-punto', 'g-sin'])
    expect(ids('muzza')).toEqual(['g-sin'])
  })

  it('las que nombran al producto, y solo a él', () => {
    expect(ids('mojito')).toEqual(['g-hielo'])
    expect(ids('mojito-malibu')).toEqual([])
  })

  it('un grupo sin opciones no se ofrece', () => {
    expect(ids('flan')).toEqual([])
    expect(ids('muzza')).not.toContain('g-vacio')
  })

  it('si hay un grupo obligatorio, hay que elegir antes de agregar', () => {
    expect(needsChoice(index, 'clasica')).toBe(true)
    expect(needsChoice(index, 'muzza')).toBe(false)
    expect(needsChoice(index, 'flan')).toBe(false)
    expect(missingRequired(index, 'clasica', []).map((g) => g.id)).toEqual(['g-punto'])
    expect(missingRequired(index, 'clasica', ['sin-sal'])).toHaveLength(1)
    expect(missingRequired(index, 'clasica', ['jugoso'])).toEqual([])
  })

  it('una sola elección se comporta como radio; si es obligatoria no se puede dejar vacía', () => {
    const punto = groups[0] as ModifierGroup
    expect(toggleOption(punto, [], 'jugoso')).toEqual(['jugoso'])
    expect(toggleOption(punto, ['jugoso', 'sin-sal'], 'a-punto')).toEqual(['sin-sal', 'a-punto'])
    expect(toggleOption(punto, ['jugoso'], 'jugoso')).toEqual(['jugoso'])
    const hielo = groups[2] as ModifierGroup
    expect(toggleOption(hielo, ['sin-hielo'], 'sin-hielo')).toEqual([])
    expect(toggleOption(hielo, ['sin-hielo'], 'poco-hielo')).toEqual(['poco-hielo'])
  })

  it('varias elecciones se prenden y se apagan de a una', () => {
    const sin = groups[1] as ModifierGroup
    expect(toggleOption(sin, ['jugoso'], 'sin-sal')).toEqual(['jugoso', 'sin-sal'])
    expect(toggleOption(sin, ['sin-sal', 'sin-cebolla'], 'sin-sal')).toEqual(['sin-cebolla'])
    expect(toggleOption(sin, ['sin-sal'], 'de-otro-grupo')).toEqual(['sin-sal'])
  })

  it('de unas aclaraciones viejas, quedan las que siguen valiendo para ese producto', () => {
    expect(validOptionIds(index, 'clasica', ['jugoso', 'sin-hielo', 'borrada'])).toEqual(['jugoso'])
    expect(validOptionIds(index, 'flan', ['jugoso'])).toEqual([])
  })
})

describe('qué es de la barra', () => {
  it('manda la estación', () => {
    expect(isDrink(index, items[7] as MenuItem)).toBe(true)
    expect(isDrink(index, items[0] as MenuItem)).toBe(false)
    expect(isDrink(index, { station_id: null, category_id: 'tragos' })).toBe(false)
  })

  it('si el bar no separa la barra, se mira la categoría', () => {
    const noBar = buildMenuIndex(
      menuWith({ stations: [{ id: KITCHEN, name: 'Cocina', color: '#000' }] }),
    )
    expect(isDrink(noBar, { station_id: KITCHEN, category_id: 'tragos' })).toBe(true)
    expect(isDrink(noBar, { station_id: KITCHEN, category_id: 'cafe' })).toBe(true)
    expect(isDrink(noBar, { station_id: KITCHEN, category_id: 'pizza' })).toBe(false)
  })
})

describe('repetir la ronda', () => {
  const at = (minutesAgo: number) =>
    new Date(Date.parse('2026-11-13T01:00:00Z') - minutesAgo * 60_000).toISOString()

  const line = (
    menu_item_id: string,
    quantity: number,
    over: Partial<SessionItem> = {},
  ): SessionItem => ({
    id: `i-${menu_item_id}-${quantity}`,
    menu_item_id,
    name: items.find((i) => i.id === menu_item_id)?.name ?? 'Algo que ya no está',
    quantity,
    unit_price_cents: 1_000_000,
    line_total_cents: 1_000_000 * quantity,
    notes: null,
    modifiers: [],
    station_id: items.find((i) => i.id === menu_item_id)?.station_id ?? null,
    prep_status: 'served',
    ready_at: null,
    served_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    ...over,
  })

  const tanda = (
    id: string,
    firedMinutesAgo: number | null,
    lines: SessionItem[],
  ): SessionTicket => ({
    id,
    status: 'served',
    course: 1,
    held: firedMinutesAgo === null,
    submitted_at: at(firedMinutesAgo ?? 1),
    fired_at: firedMinutesAgo === null ? null : at(firedMinutesAgo),
    kitchen_seen_at: null,
    ready_at: null,
    served_at: null,
    total_cents: 0,
    items: lines,
  })

  it('las bebidas de la última tanda que salió, tal cual', () => {
    const round = pickRepeatRound(
      [
        tanda('t1', 40, [line('mojito', 2), line('clasica', 2)]),
        tanda('t2', 15, [
          line('mojito', 4, {
            notes: 'en vaso largo',
            modifiers: [{ id: 'sin-hielo', label: 'Sin hielo', group: 'Hielo', delta_cents: 0 }],
          }),
          line('fernet', 2),
          line('muzza', 1),
        ]),
      ],
      index,
    )
    expect(round?.ticketId).toBe('t2')
    expect(round?.lines).toEqual([
      {
        menu_item_id: 'mojito',
        name: 'Mojito',
        quantity: 4,
        option_ids: ['sin-hielo'],
        notes: 'en vaso largo',
      },
      { menu_item_id: 'fernet', name: 'Branca y Cola', quantity: 2, option_ids: [], notes: null },
    ])
    expect(round?.units).toBe(6)
    expect(round && roundLabel(round)).toBe('4 Mojito · 2 Branca y Cola')
  })

  it('si lo último fue solo comida, la ronda es la tanda anterior que tuvo bebidas', () => {
    const round = pickRepeatRound(
      [tanda('t1', 40, [line('mojito', 3)]), tanda('t2', 10, [line('flan', 2)])],
      index,
    )
    expect(round?.ticketId).toBe('t1')
    expect(round?.units).toBe(3)
  })

  it('una tanda en espera no cuenta: todavía no se la tomaron', () => {
    const round = pickRepeatRound(
      [tanda('t1', 30, [line('fernet', 2)]), tanda('t2', null, [line('mojito', 6)])],
      index,
    )
    expect(round?.ticketId).toBe('t1')
  })

  it('lo dado de baja no se repite', () => {
    const round = pickRepeatRound(
      [tanda('t1', 5, [line('mojito', 2, { cancelled_at: at(4) }), line('fernet', 1)])],
      index,
    )
    expect(round?.lines.map((l) => l.menu_item_id)).toEqual(['fernet'])
  })

  it('lo agotado o fuera de carta se saltea; las aclaraciones que ya no existen se sueltan', () => {
    const today = buildMenuIndex(
      menuWith({ items: items.map((i) => (i.id === 'fernet' ? { ...i, sold_out: true } : i)) }),
    )
    const round = pickRepeatRound(
      [
        tanda('t1', 5, [
          line('fernet', 2),
          line('mojito', 1, {
            modifiers: [{ id: 'borrada', label: 'Con menta extra', group: 'x', delta_cents: 0 }],
          }),
          line('borrado', 1, { station_id: BAR }),
        ]),
      ],
      today,
    )
    expect(round?.lines).toEqual([
      { menu_item_id: 'mojito', name: 'Mojito', quantity: 1, option_ids: [], notes: null },
    ])
    expect(round?.skipped).toEqual(['Branca y Cola', 'Algo que ya no está'])
  })

  it('si de la última ronda no queda nada para pedir, no hay ronda (no se busca una más vieja)', () => {
    const today = buildMenuIndex(
      menuWith({ items: items.map((i) => (i.id === 'fernet' ? { ...i, sold_out: true } : i)) }),
    )
    expect(
      pickRepeatRound(
        [tanda('t1', 30, [line('mojito', 2)]), tanda('t2', 5, [line('fernet', 2)])],
        today,
      ),
    ).toBeNull()
  })

  it('sin bebidas, no hay ronda', () => {
    expect(pickRepeatRound([tanda('t1', 5, [line('clasica', 2)])], index)).toBeNull()
    expect(pickRepeatRound([], index)).toBeNull()
  })
})
