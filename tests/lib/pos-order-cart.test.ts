import { describe, expect, it } from 'vitest'
import {
  type CartAction,
  cartReducer,
  cleanNote,
  type Draft,
  EMPTY_DRAFT,
  lineSignature,
  MAX_LINES,
  MAX_QUANTITY,
  priceDraft,
  quantityByItem,
  toOrderLines,
} from '@/lib/pos/order/cart'
import { buildMenuIndex } from '@/lib/pos/order/menu-index'
import type { PosMenu } from '@/lib/pos/types'

const BURGER = 'burger'
const MOJITO = 'mojito'
const RARE = 'opt-jugoso'
const NO_ONION = 'opt-sin-cebolla'
const CHEDDAR = 'opt-cheddar'

/** Aplica acciones con claves que se cuentan solas: `l1`, `l2`… para renglones y `d1` para la tanda. */
function run(actions: ((n: number) => CartAction)[], from: Draft = EMPTY_DRAFT): Draft {
  return actions.reduce((draft, make, i) => cartReducer(draft, make(i + 1)), from)
}
const add =
  (
    menu_item_id: string,
    extra: { quantity?: number; option_ids?: string[]; notes?: string } = {},
  ) =>
  (n: number): CartAction => ({
    type: 'add',
    menu_item_id,
    lineKey: `l${n}`,
    draftKey: `draft-${n}`,
    ...extra,
  })

const menu: PosMenu = {
  service_day: '2026-11-12',
  categories: [
    { id: 'c-burgers', name: 'Hamburguesas', parent_id: null, position: 1, station_id: null },
    { id: 'c-tragos', name: 'Tragos', parent_id: null, position: 2, station_id: null },
  ],
  items: [
    {
      id: BURGER,
      name: 'Clásica simple',
      category_id: 'c-burgers',
      position: 1,
      price_cents: 1_550_000,
      description: null,
      station_id: null,
      sold_out: false,
    },
    {
      id: MOJITO,
      name: 'Mojito',
      category_id: 'c-tragos',
      position: 1,
      price_cents: 900_000,
      description: null,
      station_id: null,
      sold_out: true,
    },
  ],
  stations: [],
  modifier_groups: [
    {
      id: 'g-punto',
      name: 'Punto de la carne',
      selection: 'single',
      required: false,
      options: [{ id: RARE, label: 'Jugoso', delta_cents: 0 }],
      category_ids: ['c-burgers'],
      item_ids: [],
    },
    {
      id: 'g-extras',
      name: 'Extras',
      selection: 'multi',
      required: false,
      options: [
        { id: CHEDDAR, label: 'Extra cheddar', delta_cents: 150_000 },
        { id: NO_ONION, label: 'Sin cebolla', delta_cents: 0 },
      ],
      category_ids: ['c-burgers'],
      item_ids: [],
    },
  ],
  popular_now: [],
}

describe('agregar', () => {
  it('el primer renglón crea la tanda con su clave; los siguientes no la cambian', () => {
    const draft = run([add(BURGER), add(MOJITO)])
    expect(draft.key).toBe('draft-1')
    expect(draft.lines.map((l) => [l.key, l.menu_item_id, l.quantity])).toEqual([
      ['l1', BURGER, 1],
      ['l2', MOJITO, 1],
    ])
  })

  it('lo mismo dos veces es un renglón con dos, no dos renglones', () => {
    const draft = run([add(BURGER), add(BURGER), add(BURGER)])
    expect(draft.lines).toHaveLength(1)
    expect(draft.lines[0]).toMatchObject({ key: 'l1', quantity: 3 })
  })

  it('las mismas aclaraciones en otro orden y la misma nota con otras mayúsculas son lo mismo', () => {
    const draft = run([
      add(BURGER, { option_ids: [RARE, NO_ONION], notes: 'Sin sal' }),
      add(BURGER, { option_ids: [NO_ONION, RARE], notes: '  sin  sal ' }),
    ])
    expect(draft.lines).toHaveLength(1)
    expect(draft.lines[0]?.quantity).toBe(2)
  })

  it('otra aclaración u otra nota es otro renglón', () => {
    const draft = run([
      add(BURGER),
      add(BURGER, { option_ids: [RARE] }),
      add(BURGER, { notes: 'para compartir' }),
    ])
    expect(draft.lines.map((l) => l.quantity)).toEqual([1, 1, 1])
  })

  it('no pasa de 99 por renglón: lo que no entra va aparte, nunca se pierde', () => {
    const draft = run([add(BURGER, { quantity: 98 }), add(BURGER, { quantity: 2 })])
    expect(draft.lines.map((l) => l.quantity)).toEqual([98, 2])
    expect(run([add(BURGER, { quantity: 500 })]).lines[0]?.quantity).toBe(MAX_QUANTITY)
  })

  it('no acepta más renglones de los que el servidor recibe en una tanda', () => {
    const many = Array.from({ length: MAX_LINES + 5 }, (_, i) => add(BURGER, { notes: `n${i}` }))
    expect(run(many).lines).toHaveLength(MAX_LINES)
  })

  it('una ronda entera entra de una y se junta con lo que ya estaba', () => {
    const draft = cartReducer(run([add(MOJITO)]), {
      type: 'add_many',
      draftKey: 'otra',
      lines: [
        { menu_item_id: MOJITO, quantity: 3, lineKey: 'r1' },
        { menu_item_id: BURGER, quantity: 1, option_ids: [RARE], lineKey: 'r2' },
      ],
    })
    expect(draft.key).toBe('draft-1')
    expect(draft.lines.map((l) => [l.menu_item_id, l.quantity])).toEqual([
      [MOJITO, 4],
      [BURGER, 1],
    ])
  })
})

describe('cambiar cantidades', () => {
  it('más y menos; al llegar a cero el renglón se va', () => {
    let draft = run([add(BURGER), add(MOJITO)])
    draft = cartReducer(draft, { type: 'inc', lineKey: 'l1' })
    expect(draft.lines[0]?.quantity).toBe(2)
    draft = cartReducer(draft, { type: 'dec', lineKey: 'l1' })
    draft = cartReducer(draft, { type: 'dec', lineKey: 'l1' })
    expect(draft.lines.map((l) => l.key)).toEqual(['l2'])
  })

  it('sacar el último renglón deja el borrador vacío y sin clave: la próxima tanda es otra', () => {
    const draft = cartReducer(run([add(BURGER)]), { type: 'dec', lineKey: 'l1' })
    expect(draft).toEqual(EMPTY_DRAFT)
    const again = cartReducer(draft, {
      type: 'add',
      menu_item_id: MOJITO,
      lineKey: 'nuevo',
      draftKey: 'otra-tanda',
    })
    expect(again.key).toBe('otra-tanda')
  })

  it('el «−» de la carta saca del último renglón cargado de ese producto', () => {
    const draft = run([add(BURGER, { option_ids: [RARE] }), add(MOJITO), add(BURGER)])
    const next = cartReducer(draft, { type: 'dec_item', menu_item_id: BURGER })
    expect(next.lines.map((l) => l.key)).toEqual(['l1', 'l2'])
    expect(cartReducer(next, { type: 'dec_item', menu_item_id: 'no-existe' })).toBe(next)
  })

  it('poner una cantidad a mano respeta los límites', () => {
    const draft = run([add(BURGER)])
    expect(
      cartReducer(draft, { type: 'set_quantity', lineKey: 'l1', quantity: 7 }).lines[0]?.quantity,
    ).toBe(7)
    expect(
      cartReducer(draft, { type: 'set_quantity', lineKey: 'l1', quantity: 400 }).lines[0]?.quantity,
    ).toBe(MAX_QUANTITY)
    expect(cartReducer(draft, { type: 'set_quantity', lineKey: 'l1', quantity: 0 })).toEqual(
      EMPTY_DRAFT,
    )
  })

  it('quitar un renglón', () => {
    const draft = cartReducer(run([add(BURGER), add(MOJITO)]), { type: 'remove', lineKey: 'l1' })
    expect(draft.lines.map((l) => l.key)).toEqual(['l2'])
  })

  it('tocar un renglón que no existe no cambia nada', () => {
    const draft = run([add(BURGER)])
    expect(cartReducer(draft, { type: 'inc', lineKey: 'fantasma' })).toBe(draft)
    expect(cartReducer(draft, { type: 'remove', lineKey: 'fantasma' })).toBe(draft)
  })
})

describe('aclaraciones y nota', () => {
  it('se cambian sin tocar la cantidad', () => {
    let draft = run([add(BURGER, { quantity: 2 })])
    draft = cartReducer(draft, { type: 'set_options', lineKey: 'l1', option_ids: [RARE, RARE] })
    draft = cartReducer(draft, { type: 'set_note', lineKey: 'l1', notes: '  bien   caliente ' })
    expect(draft.lines[0]).toMatchObject({
      quantity: 2,
      option_ids: [RARE],
      notes: 'bien caliente',
    })
  })

  it('una nota vacía es sin nota, y nunca pasa de 200 letras', () => {
    expect(cleanNote('   ')).toBeNull()
    expect(cleanNote(null)).toBeNull()
    expect(cleanNote('x'.repeat(260))).toHaveLength(200)
  })

  it('si al editar queda igual a otro renglón, se juntan en el lugar del primero', () => {
    const draft = run([add(BURGER, { option_ids: [RARE] }), add(MOJITO), add(BURGER)])
    const merged = cartReducer(draft, { type: 'set_options', lineKey: 'l3', option_ids: [RARE] })
    expect(merged.lines.map((l) => [l.key, l.quantity])).toEqual([
      ['l1', 2],
      ['l2', 1],
    ])
  })

  it('la hoja de aclaraciones confirma todo junto', () => {
    const draft = cartReducer(run([add(BURGER)]), {
      type: 'edit',
      lineKey: 'l1',
      quantity: 3,
      option_ids: [NO_ONION],
      notes: 'cortada al medio',
    })
    expect(draft.lines[0]).toMatchObject({
      quantity: 3,
      option_ids: [NO_ONION],
      notes: 'cortada al medio',
    })
  })

  it('la firma de un renglón no depende del orden de las aclaraciones', () => {
    const a = lineSignature({ menu_item_id: BURGER, option_ids: [RARE, NO_ONION], notes: null })
    const b = lineSignature({ menu_item_id: BURGER, option_ids: [NO_ONION, RARE], notes: '' })
    expect(a).toBe(b)
  })
})

describe('guardar y vaciar', () => {
  it('restaurar un borrador guardado lo deja igual; uno sin renglones es vacío', () => {
    const draft = run([add(BURGER), add(MOJITO)])
    expect(cartReducer(EMPTY_DRAFT, { type: 'restore', draft })).toEqual(draft)
    expect(cartReducer(draft, { type: 'restore', draft: { key: 'vieja', lines: [] } })).toEqual(
      EMPTY_DRAFT,
    )
  })

  it('vaciar', () => {
    expect(cartReducer(run([add(BURGER)]), { type: 'clear' })).toEqual(EMPTY_DRAFT)
  })
})

describe('totales', () => {
  const index = buildMenuIndex(menu)

  it('suma en centavos enteros, con el precio de cada aclaración', () => {
    const draft = run([
      add(BURGER, { quantity: 2, option_ids: [RARE, CHEDDAR] }),
      add(BURGER),
      add(MOJITO, { quantity: 3 }),
    ])
    const totals = priceDraft(draft, index)
    expect(totals.units).toBe(6)
    expect(totals.lines.map((l) => [l.name, l.unit_cents, l.total_cents])).toEqual([
      ['Clásica simple', 1_700_000, 3_400_000],
      ['Clásica simple', 1_550_000, 1_550_000],
      ['Mojito', 900_000, 2_700_000],
    ])
    expect(totals.total_cents).toBe(7_650_000)
    expect(totals.lines[0]?.modifiers.map((m) => m.label)).toEqual(['Jugoso', 'Extra cheddar'])
  })

  it('avisa si hay algo que el servidor va a rebotar: agotado o fuera de carta', () => {
    expect(priceDraft(run([add(BURGER)]), index).blocked).toBe(false)
    const soldOut = priceDraft(run([add(BURGER), add(MOJITO)]), index)
    expect(soldOut.blocked).toBe(true)
    expect(soldOut.lines.map((l) => l.sold_out)).toEqual([false, true])
    const gone = priceDraft(run([add('ya-no-esta')]), index)
    expect(gone.blocked).toBe(true)
    expect(gone.lines[0]).toMatchObject({ missing: true, total_cents: 0 })
  })

  it('un borrador vacío vale cero', () => {
    expect(priceDraft(EMPTY_DRAFT, index)).toEqual({
      lines: [],
      units: 0,
      total_cents: 0,
      blocked: false,
    })
  })

  it('cuántos hay de cada producto, sumando sus renglones', () => {
    const draft = run([add(BURGER, { quantity: 2 }), add(BURGER, { option_ids: [RARE] })])
    expect(quantityByItem(draft).get(BURGER)).toBe(3)
    expect(quantityByItem(draft).get(MOJITO)).toBeUndefined()
  })

  it('al servidor viaja solo lo que el servidor pide', () => {
    const draft = run([add(BURGER, { quantity: 2, option_ids: [RARE], notes: 'sin sal' })])
    expect(toOrderLines(draft)).toEqual([
      { menu_item_id: BURGER, quantity: 2, option_ids: [RARE], notes: 'sin sal' },
    ])
  })
})
