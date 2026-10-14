// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isQuickExpenseAccount } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/accounts'
import { resolveParents } from '@/components/administracion/account-paths'
import {
  type CategoryAccount,
  categoryGroups,
  categoryOptions,
  categoryShortName,
  FIXED_ASSETS_GROUP_ID,
  FIXED_ASSETS_GROUP_NAME,
  featuredCategories,
  topCategories,
} from '@/components/administracion/kit/category'
import { STANDARD_CHART } from '@/lib/accounting/chart'

/**
 * Las categorías de «¿En qué se gastó?» (`CategoryPicker` y «Tus categorías»
 * del Plan de cuentas): qué cuentas se ofrecen, con qué nombre corto y en qué
 * grupo. Se prueba contra el plan estándar, que es el que tiene un bar recién
 * creado, y contra planes chicos armados a mano para los bordes.
 */

/** El plan estándar como lo traen las hojas de carga: sin `parentId` (el id es el código). */
const PLAN = STANDARD_CHART.map((a) => ({
  id: a.code,
  code: a.code,
  name: a.name,
  type: a.type,
  postable: a.postable,
  active: true,
  requiresParty: a.requiresParty,
  isTreasury: false,
  purchaseSelectable: a.purchaseSelectable,
  systemKey: a.systemKey,
}))

/** Lo que pasa quien usa el selector: las pensadas para compras. */
const QUICK = new Set(PLAN.filter(isQuickExpenseAccount).map((a) => a.id))
const quick = (id: string) => QUICK.has(id)

const all = () => true

function account(over: Partial<CategoryAccount> & Pick<CategoryAccount, 'id' | 'code' | 'name'>) {
  return { type: 'expense', postable: true, ...over } satisfies CategoryAccount
}

describe('categoryShortName', () => {
  it('saca «Compras: » y pone mayúscula', () => {
    expect(categoryShortName('Compras: bebidas con alcohol')).toBe('Bebidas con alcohol')
    expect(categoryShortName('compras:café e infusiones')).toBe('Café e infusiones')
    expect(categoryShortName('  Compras :  otros insumos ')).toBe('Otros insumos')
  })

  it('lo demás queda igual, con mayúscula', () => {
    expect(categoryShortName('Alquiler')).toBe('Alquiler')
    expect(categoryShortName('energía eléctrica')).toBe('Energía eléctrica')
    // «Compras» sola, o en el medio, no es el prefijo.
    expect(categoryShortName('Compras de mercadería')).toBe('Compras de mercadería')
    expect(categoryShortName('Devoluciones de compras: varias')).toBe(
      'Devoluciones de compras: varias',
    )
  })

  it('no deja un nombre vacío', () => {
    expect(categoryShortName('Compras: ')).toBe('Compras:')
    expect(categoryShortName('')).toBe('')
  })
})

describe('categoryOptions', () => {
  const options = categoryOptions(PLAN, quick)

  it('ofrece las pensadas para compras y ninguna más', () => {
    expect(options).toHaveLength(QUICK.size)
    expect(options).toHaveLength(51)
    expect(new Set(options.map((o) => o.id))).toEqual(QUICK)
    // Lo que el motor acepta pero no está pensado para compras queda para «Ver el plan completo».
    expect(options.find((o) => o.name.startsWith('Amortización acumulada'))).toBeUndefined()
  })

  it('cada una lleva su nombre contable, su nombre corto y su código', () => {
    const alcohol = options.find((o) => o.code === '5.1.01.01.003')
    expect(alcohol).toMatchObject({
      name: 'Compras: bebidas con alcohol',
      shortName: 'Bebidas con alcohol',
      groupName: 'Alimentos y bebidas',
    })
    const rent = options.find((o) => o.name === 'Alquiler')
    expect(rent).toMatchObject({ shortName: 'Alquiler', groupName: 'Gastos del local' })
  })

  it('nunca ofrece un grupo, una cuenta dada de baja ni una que quien la usa no acepta', () => {
    const plan = [
      account({ id: 'g', code: '4.1.00', name: 'Gastos del local', postable: false }),
      account({ id: 'a', code: '4.1.01', name: 'Alquiler' }),
      account({ id: 'b', code: '4.1.02', name: 'Expensas', active: false }),
      account({ id: 'c', code: '4.1.03', name: 'Amortizaciones' }),
    ]
    expect(categoryOptions(plan, all).map((o) => o.id)).toEqual(['a', 'c'])
    expect(categoryOptions(plan, (id) => id !== 'c').map((o) => o.id)).toEqual(['a'])
    expect(categoryOptions(plan, () => false)).toEqual([])
    expect(categoryOptions([], all)).toEqual([])
  })

  it('el grupo sale igual del código que de `parentId`', () => {
    const parents = resolveParents(PLAN)
    const withParents = PLAN.map((a) => ({ ...a, parentId: parents.get(a.id) ?? null }))
    expect(categoryOptions(withParents, quick)).toEqual(options)
  })

  it('con `parentId`, manda la madre aunque el código diga otra cosa', () => {
    const plan = [
      account({
        id: 'g1',
        code: '4.1.00',
        name: 'Gastos del local',
        postable: false,
        parentId: null,
      }),
      account({ id: 'g2', code: '4.2.00', name: 'Personal', postable: false, parentId: null }),
      // Se movió a «Personal» y conservó su código.
      account({ id: 'a', code: '4.1.01', name: 'Uniformes', parentId: 'g2' }),
    ]
    expect(categoryOptions(plan, all)).toEqual([
      {
        id: 'a',
        name: 'Uniformes',
        shortName: 'Uniformes',
        code: '4.1.01',
        groupId: 'g2',
        groupName: 'Personal',
      },
    ])
  })

  it('sin la madre en la lista, cada categoría es su propio grupo', () => {
    const leaves = [
      account({ id: 'a', code: '4.1.01', name: 'Alquiler' }),
      account({ id: 'b', code: '5.1.01', name: 'Compras: alimentos' }),
    ]
    expect(categoryOptions(leaves, all)).toEqual([
      {
        id: 'a',
        name: 'Alquiler',
        shortName: 'Alquiler',
        code: '4.1.01',
        groupId: 'a',
        groupName: 'Alquiler',
      },
      {
        id: 'b',
        name: 'Compras: alimentos',
        shortName: 'Alimentos',
        code: '5.1.01',
        groupId: 'b',
        groupName: 'Alimentos',
      },
    ])
  })
})

describe('categoryGroups', () => {
  const groups = categoryGroups(categoryOptions(PLAN, quick))

  it('agrupa por la cuenta madre, en el orden del plan', () => {
    expect(groups.map((g) => g.name)).toEqual([
      'Personal',
      'Impuestos, tasas y contribuciones',
      'Gastos del local',
      'Comisiones y costos de cobro',
      'Honorarios',
      'Gastos bancarios y financieros',
      'Seguros',
      'Alimentos y bebidas',
      'Insumos y descartables',
      FIXED_ASSETS_GROUP_NAME,
    ])
    expect(groups.reduce((n, g) => n + g.options.length, 0)).toBe(51)
    for (const g of groups) expect(g.options.length, g.name).toBeGreaterThan(0)
  })

  it('los equipos y muebles van todos juntos, al final', () => {
    const fixed = groups.at(-1)
    expect(fixed?.id).toBe(FIXED_ASSETS_GROUP_ID)
    expect(fixed?.name).toBe('Equipos y muebles')
    const names = fixed?.options.map((o) => o.shortName) ?? []
    expect(names).toEqual(
      expect.arrayContaining([
        'Equipamiento de cocina y barra',
        'Muebles y útiles',
        'Instalaciones',
        'Equipos de computación',
        'Software y licencias',
      ]),
    )
    // Toda cuenta de activo cae ahí, y ninguna de gasto.
    const assets = new Set(PLAN.filter((a) => a.type === 'asset').map((a) => a.id))
    expect(fixed?.options.every((o) => assets.has(o.id))).toBe(true)
    for (const g of groups.slice(0, -1)) {
      expect(
        g.options.some((o) => assets.has(o.id)),
        g.name,
      ).toBe(false)
    }
  })

  it('van al final aunque en la lista vengan primero', () => {
    const options = categoryOptions(
      [
        account({ id: 'e', code: '1.2.01', name: 'Muebles y útiles', type: 'asset' }),
        account({ id: 'g', code: '4.1.00', name: 'Gastos del local', postable: false }),
        account({ id: 'a', code: '4.1.01', name: 'Alquiler' }),
      ],
      all,
    )
    expect(options.map((o) => o.id)).toEqual(['a', 'e'])
    expect(categoryGroups(options).map((g) => g.id)).toEqual(['g', FIXED_ASSETS_GROUP_ID])
    // Y si a `categoryGroups` le llegan desordenadas, igual.
    expect(categoryGroups([...options].reverse()).map((g) => g.id)).toEqual([
      'g',
      FIXED_ASSETS_GROUP_ID,
    ])
  })

  it('«Seguros» es un grupo con una sola categoría de su mismo nombre', () => {
    const insurance = groups.find((g) => g.name === 'Seguros')
    expect(insurance?.options.map((o) => o.shortName)).toEqual(['Seguros'])
  })

  it('sin opciones no hay grupos', () => {
    expect(categoryGroups([])).toEqual([])
  })
})

describe('featuredCategories', () => {
  it('la mercadería: las de clave `purchases_*`, en el orden del plan', () => {
    const featured = featuredCategories(PLAN)
    const names = featured.map((id) => PLAN.find((a) => a.id === id)?.name)
    expect(names).toEqual([
      'Compras: alimentos',
      'Compras: bebidas sin alcohol',
      'Compras: bebidas con alcohol',
      'Compras: café e infusiones',
      'Compras: panadería y pastelería',
      'Compras: descartables y packaging',
      'Compras: otros insumos',
    ])
    // Todas se pueden elegir: la fila «Mercadería» nunca queda con un hueco.
    expect(featured.every(quick)).toBe(true)
  })

  it('ordena por código aunque la lista llegue en otro orden', () => {
    expect(featuredCategories([...PLAN].reverse())).toEqual(featuredCategories(PLAN))
  })

  it('en un plan sin esas claves no hay mercadería', () => {
    const plan = PLAN.map((a) => ({ ...a, systemKey: null }))
    expect(featuredCategories(plan)).toEqual([])
    expect(featuredCategories([])).toEqual([])
  })

  it('no trae una dada de baja ni un grupo', () => {
    const plan = [
      account({ id: 'a', code: '5.1.01', name: 'Compras: alimentos', systemKey: 'purchases_food' }),
      account({
        id: 'b',
        code: '5.1.02',
        name: 'Compras: café',
        systemKey: 'purchases_coffee',
        active: false,
      }),
      account({
        id: 'c',
        code: '5.1.00',
        name: 'Compras',
        systemKey: 'purchases_other',
        postable: false,
      }),
      account({ id: 'd', code: '4.1.01', name: 'Alquiler', systemKey: 'maintenance' }),
    ]
    expect(featuredCategories(plan)).toEqual(['a'])
  })
})

describe('topCategories', () => {
  const usage = new Map([
    ['limpieza', 2],
    ['alquiler', 9],
    ['hielo', 2],
    ['alimentos', 30],
    ['sin-uso', 0],
    ['fletes', 1],
  ])

  it('las más usadas primero; a igual uso, en el orden en que llegaron', () => {
    expect(topCategories(usage)).toEqual(['alimentos', 'alquiler', 'limpieza', 'hielo', 'fletes'])
  })

  it('lo que nunca se usó no entra', () => {
    expect(topCategories(usage)).not.toContain('sin-uso')
    expect(topCategories(new Map([['a', 0]]))).toEqual([])
    expect(topCategories(new Map())).toEqual([])
  })

  it('corta en `max` (seis por defecto)', () => {
    expect(topCategories(usage, 2)).toEqual(['alimentos', 'alquiler'])
    expect(topCategories(usage, 0)).toEqual([])
    const many = new Map(Array.from({ length: 10 }, (_, i) => [`c${i}`, 10 - i] as const))
    expect(topCategories(many)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5'])
  })

  it('`exclude` saca las que ya tienen su fila, sin achicar la lista', () => {
    expect(topCategories(usage, 3, new Set(['alimentos']))).toEqual([
      'alquiler',
      'limpieza',
      'hielo',
    ])
  })
})
