// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  applyRouteSchema,
  cleanText,
  createGroupSchema,
  createOptionSchema,
  createStationsSchema,
  deleteStationsSchema,
  GROUP_NAME_MAX,
  groupIdSchema,
  MAX_ROUTE_CHANGES,
  OPTION_DELTA_MAX_CENTS,
  OPTION_LABEL_MAX,
  patchGroupSchema,
  patchOptionSchema,
  patchStationSchema,
  reorderGroupsSchema,
  reorderOptionsSchema,
  reorderStationsSchema,
  STATION_NAME_MAX,
  setLinkSchema,
} from '@/lib/menu/kitchen/schemas'
import { BARRA, COCINA, COMIDA, FRIOS, id, JUGOSO, PIZZA, PUNTO } from './menu-kitchen-fixtures'

/**
 * El borde: lo que el servidor acepta del navegador. Los topes son los `check` de la base, así
 * lo que pasa por acá no rebota después.
 */

describe('cleanText', () => {
  it('saca los espacios de más', () => {
    expect(cleanText('  Punto   de la\tcarne \n')).toBe('Punto de la carne')
    expect(cleanText('   ')).toBe('')
  })
})

describe('applyRouteSchema', () => {
  const change = (over: Record<string, unknown> = {}) => ({
    node: 'category',
    id: PIZZA,
    to: FRIOS,
    expected: null,
    ...over,
  })
  const parse = (changes: unknown[], reason: unknown = 'mark') =>
    applyRouteSchema.safeParse({ changes, reason })

  it('acepta marcar y sacar la marca', () => {
    expect(parse([change()]).success).toBe(true)
    expect(parse([change({ to: null, expected: COCINA })]).success).toBe(true)
    expect(parse([change({ node: 'item' })]).success).toBe(true)
  })

  it('no acepta ids que no son ids, ni nodos inventados', () => {
    expect(parse([change({ id: 'pizza' })]).success).toBe(false)
    expect(parse([change({ to: 'cocina' })]).success).toBe(false)
    expect(parse([change({ node: 'station' })]).success).toBe(false)
    expect(parse([change({ expected: undefined })]).success).toBe(false)
  })

  it('no acepta la misma cosa dos veces, pero sí una categoría y un producto distintos', () => {
    expect(parse([change(), change({ to: BARRA })]).success).toBe(false)
    expect(parse([change(), change({ id: COMIDA })]).success).toBe(true)
  })

  it('pide al menos un cambio y un motivo conocido, y tiene tope', () => {
    expect(parse([]).success).toBe(false)
    expect(parse([change()], 'porque sí').success).toBe(false)
    const many = Array.from({ length: MAX_ROUTE_CHANGES + 1 }, (_, n) => change({ id: id('e', n) }))
    expect(parse(many).success).toBe(false)
    expect(parse(many.slice(1)).success).toBe(true)
  })
})

describe('estaciones', () => {
  const station = (over: Record<string, unknown> = {}) => ({
    id: COCINA,
    name: 'Cocina',
    color: '#B45309',
    position: 0,
    active: true,
    ...over,
  })

  it('limpia el nombre y pasa el color a minúsculas', () => {
    const parsed = createStationsSchema.parse({
      stations: [station({ name: '  Fuegos   fuertes ' })],
    })
    expect(parsed.stations[0]).toMatchObject({ name: 'Fuegos fuertes', color: '#b45309' })
  })

  it('el nombre va de 1 a 30 letras, ya limpio', () => {
    const ok = (name: string) =>
      createStationsSchema.safeParse({ stations: [station({ name })] }).success
    expect(ok('a'.repeat(STATION_NAME_MAX))).toBe(true)
    expect(ok('a'.repeat(STATION_NAME_MAX + 1))).toBe(false)
    expect(ok('   ')).toBe(false)
    expect(ok('')).toBe(false)
  })

  it('el color es #rrggbb', () => {
    const ok = (color: string) =>
      createStationsSchema.safeParse({ stations: [station({ color })] }).success
    expect(ok('#0e7490')).toBe(true)
    expect(ok('0e7490')).toBe(false)
    expect(ok('#0e749')).toBe(false)
    expect(ok('red')).toBe(false)
  })

  it('no acepta dos con el mismo id ni con el mismo nombre', () => {
    const two = (second: Record<string, unknown>) =>
      createStationsSchema.safeParse({ stations: [station(), station(second)] }).success
    expect(two({ id: FRIOS, name: 'Fríos' })).toBe(true)
    expect(two({ name: 'Otra' })).toBe(false)
    expect(two({ id: FRIOS, name: 'COCINA' })).toBe(false)
  })

  it('un cambio dice de qué a qué, y al menos un campo', () => {
    const patch = (value: unknown) =>
      patchStationSchema.safeParse({ id: COCINA, patch: value }).success
    expect(patch({ name: { from: 'Cocina', to: 'Plancha' } })).toBe(true)
    expect(
      patch({ active: { from: true, to: false }, color: { from: '#b45309', to: '#0e7490' } }),
    ).toBe(true)
    expect(patch({})).toBe(false)
    expect(patch({ name: { to: 'Plancha' } })).toBe(false)
    expect(patch({ name: { from: 'Cocina', to: '   ' } })).toBe(false)
  })

  it('borrar pide ids de verdad', () => {
    expect(deleteStationsSchema.safeParse({ ids: [COCINA] }).success).toBe(true)
    expect(deleteStationsSchema.safeParse({ ids: [] }).success).toBe(false)
    expect(deleteStationsSchema.safeParse({ ids: ['x'] }).success).toBe(false)
  })
})

describe('ordenar', () => {
  it('el orden nuevo tiene que ser de las mismas filas que se miraban', () => {
    const order = (ids: string[], expected: string[]) =>
      reorderStationsSchema.safeParse({ ids, expected }).success
    expect(order([BARRA, COCINA, FRIOS], [COCINA, FRIOS, BARRA])).toBe(true)
    expect(order([BARRA, COCINA], [COCINA, FRIOS, BARRA])).toBe(false)
    expect(order([BARRA, BARRA, FRIOS], [COCINA, FRIOS, BARRA])).toBe(false)
    expect(order([BARRA, COCINA, id('a', 9)], [COCINA, FRIOS, BARRA])).toBe(false)
    expect(order([], [])).toBe(false)
  })

  it('las opciones se ordenan dentro de su grupo', () => {
    const base = { ids: [JUGOSO], expected: [JUGOSO] }
    expect(reorderOptionsSchema.safeParse({ groupId: PUNTO, ...base }).success).toBe(true)
    expect(reorderOptionsSchema.safeParse(base).success).toBe(false)
    expect(reorderGroupsSchema.safeParse({ ids: [PUNTO], expected: [PUNTO] }).success).toBe(true)
  })
})

describe('aclaraciones', () => {
  const group = (over: Record<string, unknown> = {}) => ({
    id: PUNTO,
    name: 'Punto de la carne',
    selection: 'single',
    required: false,
    position: 0,
    active: true,
    ...over,
  })
  const option = (over: Record<string, unknown> = {}) => ({
    id: JUGOSO,
    label: 'Jugoso',
    priceDeltaCents: 0,
    position: 0,
    active: true,
    ...over,
  })
  const create = (value: Record<string, unknown>) =>
    createGroupSchema.safeParse({ group: group(), options: [], links: [], ...value })

  it('un grupo puede nacer vacío, o con sus opciones y sus enganches', () => {
    expect(create({}).success).toBe(true)
    expect(
      create({
        options: [option(), option({ id: id('d', 2), label: 'A punto', position: 1 })],
        links: [
          { target: 'category', targetId: COMIDA },
          { target: 'item', targetId: COMIDA },
        ],
      }).success,
    ).toBe(true)
  })

  it('no acepta opciones ni enganches repetidos', () => {
    expect(create({ options: [option(), option()] }).success).toBe(false)
    expect(
      create({
        links: [
          { target: 'category', targetId: COMIDA },
          { target: 'category', targetId: COMIDA },
        ],
      }).success,
    ).toBe(false)
  })

  it('los nombres van de 1 a 40, ya limpios', () => {
    expect(create({ group: group({ name: 'a'.repeat(GROUP_NAME_MAX) }) }).success).toBe(true)
    expect(create({ group: group({ name: 'a'.repeat(GROUP_NAME_MAX + 1) }) }).success).toBe(false)
    expect(create({ group: group({ name: '  ' }) }).success).toBe(false)
    expect(create({ options: [option({ label: 'a'.repeat(OPTION_LABEL_MAX + 1) })] }).success).toBe(
      false,
    )
    expect(create({ group: group({ selection: 'varias' }) }).success).toBe(false)
  })

  it('lo que suma una opción va de $ 0 a $ 1.000.000, en centavos enteros', () => {
    const delta = (priceDeltaCents: unknown) =>
      createOptionSchema.safeParse({ groupId: PUNTO, option: option({ priceDeltaCents }) }).success
    expect(delta(0)).toBe(true)
    expect(delta(150_000)).toBe(true)
    expect(delta(OPTION_DELTA_MAX_CENTS)).toBe(true)
    expect(delta(OPTION_DELTA_MAX_CENTS + 1)).toBe(false)
    expect(delta(-100)).toBe(false)
    expect(delta(1500.5)).toBe(false)
    expect(delta('1500')).toBe(false)
  })

  it('los cambios de un grupo y de una opción dicen de qué a qué', () => {
    expect(
      patchGroupSchema.safeParse({
        id: PUNTO,
        patch: {
          selection: { from: 'single', to: 'multi' },
          required: { from: false, to: true },
        },
      }).success,
    ).toBe(true)
    expect(patchGroupSchema.safeParse({ id: PUNTO, patch: {} }).success).toBe(false)
    expect(
      patchOptionSchema.safeParse({
        id: JUGOSO,
        patch: { priceDeltaCents: { from: 0, to: 150_000 } },
      }).success,
    ).toBe(true)
    expect(
      patchOptionSchema.safeParse({
        id: JUGOSO,
        patch: { priceDeltaCents: { from: 0, to: -1 } },
      }).success,
    ).toBe(false)
    expect(
      patchOptionSchema.safeParse({ id: JUGOSO, patch: { label: { from: 'Jugoso', to: '' } } })
        .success,
    ).toBe(false)
  })

  it('enganchar pide grupo, a qué y si se pone o se saca', () => {
    const link = { groupId: PUNTO, target: 'category', targetId: COMIDA, linked: true }
    expect(setLinkSchema.safeParse(link).success).toBe(true)
    expect(setLinkSchema.safeParse({ ...link, target: 'station' }).success).toBe(false)
    expect(setLinkSchema.safeParse({ ...link, linked: 'sí' }).success).toBe(false)
    expect(groupIdSchema.safeParse({ id: PUNTO }).success).toBe(true)
    expect(groupIdSchema.safeParse({ id: 'punto' }).success).toBe(false)
  })
})
