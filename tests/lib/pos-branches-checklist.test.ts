// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { NBSP } from '@/lib/money'
import {
  buildOpening,
  joinList,
  lastConnector,
  numberWord,
  type Opening,
  openingHeadline,
  type StepId,
  sellableItems,
  teamSentence,
  unassignedCategories,
  whenText,
} from '@/lib/pos/branches/checklist'
import type { BranchFacts, MenuFacts, TeamFacts } from '@/lib/pos/branches/types'
import { DEFAULT_POS_SETTINGS, type PosSettings } from '@/lib/pos/settings/types'

const TZ = 'America/Argentina/Cordoba'
/** Viernes 13/11/2026, 22:30 en Córdoba (UTC−3). */
const NOW = new Date('2026-11-14T01:30:00Z')

const facts = (over: Partial<BranchFacts> = {}): BranchFacts => ({
  sectors: 3,
  tables: 25,
  looseTables: 0,
  openTables: 0,
  hasHistory: false,
  unavailable: 0,
  ownPrices: 0,
  kitchenSeenAt: '2026-11-14T00:40:00Z',
  registers: null,
  ...over,
})

const MENU: MenuFacts = {
  products: 232,
  stations: [
    { id: 's1', name: 'Cocina', color: '#b45309' },
    { id: 's2', name: 'Fríos', color: '#0e7490' },
    { id: 's3', name: 'Barra', color: '#6d28d9' },
  ],
  unassigned: [],
}

const TEAM: TeamFacts = { owner: 3, cashier: 1, waiter: 4, kitchen: 2, host: 1 }

const SETTINGS: PosSettings = {
  ...DEFAULT_POS_SETTINGS,
  creditSurchargeBp: 1000,
  transferAlias: 'demo.bar.mp',
}

const open = (
  over: {
    facts?: Partial<BranchFacts>
    menu?: Partial<MenuFacts>
    team?: Partial<TeamFacts>
    settings?: Partial<PosSettings>
  } = {},
): Opening =>
  buildOpening({
    facts: facts(over.facts),
    menu: { ...MENU, ...over.menu },
    team: { ...TEAM, ...over.team },
    settings: { ...SETTINGS, ...over.settings },
    now: NOW,
    timeZone: TZ,
  })

const step = (opening: Opening, id: StepId) => {
  const found = opening.steps.find((entry) => entry.id === id)
  if (!found) throw new Error(`falta el paso ${id}`)
  return found
}

describe('joinList y numberWord', () => {
  it('une como se dice', () => {
    expect(joinList([])).toBe('')
    expect(joinList(['a'])).toBe('a')
    expect(joinList(['a', 'b'])).toBe('a y b')
    expect(joinList(['a', 'b', 'c'])).toBe('a, b y c')
  })

  it('«e» delante de «i» o «hi», pero no de «hie»', () => {
    expect(lastConnector('instalar la tele')).toBe('e')
    expect(lastConnector('hilar fino')).toBe('e')
    expect(lastConnector('hielo')).toBe('y')
    expect(lastConnector('dibujar el plano')).toBe('y')
    expect(joinList(['dibujar', 'instalar'])).toBe('dibujar e instalar')
  })

  it('los números chicos van con letras', () => {
    expect(numberWord(1)).toBe('un')
    expect(numberWord(2)).toBe('dos')
    expect(numberWord(6)).toBe('seis')
    expect(numberWord(14)).toBe('14')
  })
})

describe('whenText', () => {
  it('hoy, ayer, esta semana y más atrás', () => {
    expect(whenText('2026-11-14T00:40:00Z', NOW, TZ)).toBe('hoy a las 21:40')
    expect(whenText('2026-11-13T02:05:00Z', NOW, TZ)).toBe('ayer a las 23:05')
    expect(whenText('2026-11-10T23:10:00Z', NOW, TZ)).toBe('el martes a las 20:10')
    expect(whenText('2026-11-03T23:10:00Z', NOW, TZ)).toBe('el 03/11')
  })

  it('el día se corta en la hora del bar, no en UTC', () => {
    // 02:59 UTC del 14 todavía es el 13 a las 23:59 en Córdoba: hoy.
    expect(whenText('2026-11-14T02:59:00Z', new Date('2026-11-14T02:59:30Z'), TZ)).toBe(
      'hoy a las 23:59',
    )
    // 03:01 UTC ya es el 14 a las 00:01; lo de las 23:50 fue ayer.
    expect(whenText('2026-11-14T02:50:00Z', new Date('2026-11-14T03:01:00Z'), TZ)).toBe(
      'ayer a las 23:50',
    )
  })

  it('una fecha rota no dice nada', () => {
    expect(whenText('no es una fecha', NOW, TZ)).toBeNull()
  })
})

describe('sellableItems y unassignedCategories', () => {
  const categories = [
    { id: 'comida', name: 'Comida', parentId: null, stationId: 's1' },
    { id: 'pizzas', name: 'Pizzas', parentId: 'comida', stationId: null },
    { id: 'tragos', name: 'Tragos', parentId: null, stationId: null },
    { id: 'autor', name: 'De autor', parentId: 'tragos', stationId: null },
    { id: 'vinos', name: 'Vinos', parentId: null, stationId: null },
  ]
  const item = (id: string, categoryId: string | null, stationId: string | null = null) => ({
    id,
    categoryId,
    stationId,
    active: true,
  })

  it('se puede pedir lo que está activo y tiene categoría', () => {
    const items = [item('a', 'pizzas'), { ...item('b', 'pizzas'), active: false }, item('c', null)]
    expect(sellableItems(items).map((entry) => entry.id)).toEqual(['a'])
  })

  it('un producto hereda la estación de su categoría o de la que la contiene', () => {
    expect(unassignedCategories(categories, [item('muzza', 'pizzas')])).toEqual([])
  })

  it('una categoría sin estación en toda su rama queda sin asignar, con cuántos productos', () => {
    const items = [
      item('negroni', 'autor'),
      item('spritz', 'autor'),
      item('fernet', 'tragos'),
      item('malbec', 'vinos'),
    ]
    expect(unassignedCategories(categories, items)).toEqual([
      { id: 'autor', name: 'De autor', products: 2 },
      { id: 'tragos', name: 'Tragos', products: 1 },
      { id: 'vinos', name: 'Vinos', products: 1 },
    ])
  })

  it('un producto con estación propia no cuenta, aunque su categoría no tenga', () => {
    expect(unassignedCategories(categories, [item('malbec', 'vinos', 's3')])).toEqual([])
  })

  it('lo pausado y lo que no tiene categoría no cuentan: no se pueden pedir', () => {
    const items = [{ ...item('malbec', 'vinos'), active: false }, item('suelto', null)]
    expect(unassignedCategories(categories, items)).toEqual([])
  })

  it('una categoría que cuelga de sí misma no deja la cuenta dando vueltas', () => {
    const loop = [{ id: 'x', name: 'Rara', parentId: 'x', stationId: null }]
    expect(unassignedCategories(loop, [item('algo', 'x')])).toEqual([
      { id: 'x', name: 'Rara', products: 1 },
    ])
  })
})

describe('el plano', () => {
  it('sin sectores: falta dibujarlo', () => {
    const plan = step(open({ facts: { sectors: 0, tables: 0 } }), 'plan')
    expect(plan).toMatchObject({ state: 'todo', issue: 'no_sectors', missing: 'dibujar el plano' })
  })

  it('con sectores y sin mesas: faltan las mesas', () => {
    const plan = step(open({ facts: { sectors: 1, tables: 0 } }), 'plan')
    expect(plan).toMatchObject({ state: 'todo', issue: 'no_tables' })
    expect(plan.detail).toContain('1 sector sin mesas')
  })

  it('con mesas en el plano está hecho, y cuenta en singular y en plural', () => {
    expect(step(open(), 'plan')).toMatchObject({
      state: 'done',
      detail: '3 sectores y 25 mesas en el plano.',
      issue: null,
      missing: null,
    })
    expect(step(open({ facts: { sectors: 1, tables: 1 } }), 'plan').detail).toBe(
      '1 sector y 1 mesa en el plano.',
    )
  })

  it('las mesas cargadas sin ubicar se avisan, pero no frenan', () => {
    const plan = step(open({ facts: { looseTables: 2 } }), 'plan')
    expect(plan.state).toBe('done')
    expect(plan.notes).toEqual(['2 mesas cargadas sin ubicar en el plano.'])
  })
})

describe('la carta', () => {
  it('vacía: falta cargarla', () => {
    expect(step(open({ menu: { products: 0 } }), 'menu')).toMatchObject({
      state: 'todo',
      issue: 'empty_menu',
    })
  })

  it('con todo apagado en la sucursal: falta elegir qué se vende', () => {
    expect(step(open({ facts: { unavailable: 232 } }), 'menu')).toMatchObject({
      state: 'todo',
      issue: 'nothing_sold',
    })
  })

  it('con estaciones y todo asignado está hecha, y las nombra', () => {
    expect(step(open(), 'menu')).toMatchObject({
      state: 'done',
      detail:
        '232 productos se venden acá, y cada uno sabe a qué estación va: Cocina, Fríos y Barra.',
    })
  })

  it('con estaciones y categorías sin asignar: falta, y dice cuántas', () => {
    const menu = step(
      open({
        menu: {
          unassigned: [
            { id: 'a', name: 'Vinos', products: 30 },
            { id: 'b', name: 'Postres', products: 6 },
          ],
        },
      }),
      'menu',
    )
    expect(menu).toMatchObject({
      state: 'todo',
      issue: 'unassigned',
      missing: 'darle estación a 2 categorías',
    })
    expect(menu.detail).toContain('2 categorías todavía no tienen estación')
  })

  it('una sola categoría sin asignar se dice en singular', () => {
    const menu = step(
      open({ menu: { unassigned: [{ id: 'a', name: 'Vinos', products: 30 }] } }),
      'menu',
    )
    expect(menu.detail).toContain('1 categoría todavía no tiene estación')
    expect(menu.missing).toBe('darle estación a 1 categoría')
  })

  it('sin estaciones no falta nada: todo sale en una pantalla', () => {
    const menu = step(
      open({ menu: { stations: [], unassigned: [{ id: 'a', name: 'Vinos', products: 30 }] } }),
      'menu',
    )
    expect(menu.state).toBe('done')
    expect(menu.detail).toContain('una misma pantalla')
  })

  it('descuenta lo que no se vende acá y lo avisa junto con los precios propios', () => {
    const menu = step(open({ facts: { unavailable: 5, ownPrices: 1 } }), 'menu')
    expect(menu.detail).toContain('227 productos se venden acá')
    expect(menu.notes).toEqual([
      '5 productos de la carta no se venden acá.',
      '1 tiene precio propio en esta sucursal.',
    ])
  })
})

describe('la cocina', () => {
  it('si una pantalla ya mostró un pedido está hecha, y dice cuándo fue el último', () => {
    expect(step(open(), 'kitchen')).toMatchObject({
      state: 'done',
      detail: 'La pantalla de la cocina ya mostró pedidos de acá. El último, hoy a las 21:40.',
    })
  })

  it('si nunca mostró nada, falta: se tilda sola con el primer pedido', () => {
    expect(step(open({ facts: { kitchenSeenAt: null } }), 'kitchen')).toMatchObject({
      state: 'todo',
      issue: 'never_seen',
      missing: 'prender la pantalla de la cocina',
    })
  })

  it('sin nadie con rol Cocina lo avisa: la tele necesita su usuario', () => {
    expect(step(open({ team: { kitchen: 0 } }), 'kitchen').notes).toHaveLength(1)
    expect(step(open(), 'kitchen').notes).toEqual([])
  })
})

describe('la caja', () => {
  it('mientras no llega a la base se muestra, pero no entra en la cuenta', () => {
    const opening = open()
    expect(step(opening, 'cash')).toMatchObject({ state: 'soon', missing: null })
    expect(opening.counted).toBe(5)
    expect(opening.steps).toHaveLength(6)
  })

  it('cuando llega, cuenta: falta hasta que se abre el primer turno', () => {
    const waiting = open({ facts: { registers: 0 } })
    expect(step(waiting, 'cash')).toMatchObject({ state: 'todo', issue: 'no_register' })
    expect(waiting.counted).toBe(6)
    const ready = open({ facts: { registers: 2 } })
    expect(step(ready, 'cash')).toMatchObject({
      state: 'done',
      detail: '2 cajas listas para abrir turno.',
    })
  })
})

describe('el equipo', () => {
  it('con alguien además de los dueños está hecho, y dice quiénes', () => {
    expect(step(open(), 'team')).toMatchObject({
      state: 'done',
      shared: true,
      detail: '3 dueños, 1 en la caja, 4 mozos, 2 en la cocina y 1 anfitrión.',
    })
  })

  it('solo dueños: falta sumar al equipo', () => {
    const team = step(open({ team: { cashier: 0, waiter: 0, kitchen: 0, host: 0 } }), 'team')
    expect(team).toMatchObject({ state: 'todo', issue: 'owners_only' })
    expect(team.detail).toContain('entran 3 dueños')
  })

  it('avisa si todavía no hay mozos ni caja', () => {
    const team = step(open({ team: { cashier: 0, waiter: 0, kitchen: 0, host: 1 } }), 'team')
    expect(team.state).toBe('done')
    expect(team.detail).toBe('3 dueños y 1 anfitrión.')
    expect(team.notes).toEqual(['Todavía nadie con rol de mozo ni de caja.'])
  })

  it('teamSentence nombra solo los roles que tienen a alguien', () => {
    expect(teamSentence({ owner: 1, cashier: 0, waiter: 1, kitchen: 0, host: 2 })).toBe(
      '1 dueño, 1 mozo y 2 anfitriones',
    )
  })
})

describe('el cobro', () => {
  it('con alias está hecho y resume el recargo y los billetes', () => {
    expect(step(open(), 'charge')).toMatchObject({
      state: 'done',
      shared: true,
      detail: `Alias demo.bar.mp. Crédito con 10${NBSP}% de recargo y 7 billetes para contar la caja.`,
    })
  })

  it('sin alias: falta', () => {
    const charge = step(open({ settings: { transferAlias: null } }), 'charge')
    expect(charge).toMatchObject({ state: 'todo', issue: 'no_alias' })
    expect(charge.missing).toBe('cargar el alias para transferencias')
  })

  it('un alias de puros espacios no cuenta', () => {
    expect(step(open({ settings: { transferAlias: '   ' } }), 'charge').state).toBe('todo')
  })

  it('sin recargo lo dice así', () => {
    expect(step(open({ settings: { creditSurchargeBp: 0 } }), 'charge').detail).toContain(
      'Crédito sin recargo',
    )
  })
})

describe('la cuenta y el titular', () => {
  it('todo hecho: lista para abrir, y nombra lo que está en su lugar', () => {
    const opening = open()
    expect(opening).toMatchObject({ counted: 5, done: 5 })
    expect(opening.pending).toEqual([])
    expect(openingHeadline(opening, { name: 'Cerro' }, false)).toEqual({
      title: 'Lista para abrir',
      sentence:
        'El plano, la carta, la cocina, el equipo y el cobro están en su lugar. La caja llega con el cobro.',
      short: 'Lista',
    })
  })

  it('una sucursal recién creada: le falta solo lo que es de ella', () => {
    const opening = open({ facts: { sectors: 0, tables: 0, kitchenSeenAt: null } })
    expect(opening).toMatchObject({ counted: 5, done: 3 })
    expect(opening.pending.map((entry) => entry.id)).toEqual(['plan', 'kitchen'])
    expect(openingHeadline(opening, { name: 'Cerro' }, false)).toEqual({
      title: 'Faltan dos pasos',
      sentence: 'Para abrir Cerro falta dibujar el plano y prender la pantalla de la cocina.',
      short: 'Faltan 2',
    })
  })

  it('un solo paso se dice en singular', () => {
    const opening = open({ settings: { transferAlias: null } })
    expect(openingHeadline(opening, { name: 'Cerro' }, false)).toMatchObject({
      title: 'Falta un paso',
      short: 'Falta 1',
    })
  })

  it('con una sola sucursal no hace falta nombrarla', () => {
    const opening = open({ settings: { transferAlias: null } })
    expect(openingHeadline(opening, { name: 'Principal' }, true).sentence).toBe(
      'Para abrir falta cargar el alias para transferencias.',
    )
  })

  it('un bar que recién prende el punto de venta: falta casi todo, en el orden de la lista', () => {
    const opening = open({
      facts: { sectors: 0, tables: 0, kitchenSeenAt: null },
      menu: { unassigned: [{ id: 'a', name: 'Vinos', products: 30 }] },
      team: { cashier: 0, waiter: 0, kitchen: 0, host: 0 },
      settings: { transferAlias: null },
    })
    expect(opening).toMatchObject({ counted: 5, done: 0 })
    expect(openingHeadline(opening, { name: 'Principal' }, true)).toMatchObject({
      title: 'Faltan cinco pasos',
      short: 'Faltan 5',
    })
  })

  it('cuando llega la caja, la cuenta pasa a ser sobre seis', () => {
    const opening = open({ facts: { registers: 1 } })
    expect(opening).toMatchObject({ counted: 6, done: 6 })
    expect(openingHeadline(opening, { name: 'Cerro' }, false).sentence).toBe(
      'El plano, la carta, la cocina, la caja, el equipo y el cobro están en su lugar.',
    )
  })

  it('los pasos van siempre en el mismo orden', () => {
    expect(open().steps.map((entry) => entry.id)).toEqual([
      'plan',
      'menu',
      'kitchen',
      'cash',
      'team',
      'charge',
    ])
  })
})
