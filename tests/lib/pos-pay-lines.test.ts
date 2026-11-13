import { describe, expect, it } from 'vitest'
import { byProductAmount, picksToItemIds } from '@/lib/pos/cash/bill'
import {
  chosenLabel,
  chosenUnits,
  expandChosen,
  freeUnits,
  groupLines,
  picksForGroup,
  pruneChosen,
  setChosen,
  tapChosen,
} from '@/lib/pos/pay/lines'
import { line, makeBill, pesos } from './pos-pay-fixtures'

describe('los renglones de la cuenta', () => {
  it('junta lo mismo de distintas tandas en un solo renglón', () => {
    const groups = groupLines([
      line('Mojito', 2, 6500),
      line('Branca y Cola', 1, 7000),
      line('Mojito', 2, 6500),
      line('Mojito', 1, 6500),
    ])
    expect(groups.map((g) => [g.name, g.quantity, g.totalCents])).toEqual([
      ['Mojito', 5, pesos(32_500)],
      ['Branca y Cola', 1, pesos(7000)],
    ])
    expect(groups[0]?.lines).toHaveLength(3)
    expect(groups[0]?.unitCents).toBe(pesos(6500))
  })

  it('no junta lo que vale distinto ni lo que lleva otro extra con precio', () => {
    const cheddar = [{ id: 'm1', label: 'Extra cheddar', group: 'Extras', delta_cents: 150_000 }]
    const bacon = [{ id: 'm2', label: 'Extra bacon', group: 'Extras', delta_cents: 150_000 }]
    const groups = groupLines([
      line('Clásica', 1, 11_000),
      line('Clásica', 1, 12_500, { modifiers: cheddar }),
      line('Clásica', 1, 12_500, { modifiers: bacon }),
      line('Clásica', 2, 12_500, { modifiers: cheddar }),
    ])
    expect(groups.map((g) => [g.quantity, g.extras.map((e) => e.label)])).toEqual([
      [1, []],
      [3, ['Extra cheddar']],
      [1, ['Extra bacon']],
    ])
  })

  it('las aclaraciones sin precio y las notas no separan: son cosa de cocina', () => {
    const free = [{ id: 'm3', label: 'Sin hielo', group: 'Hielo', delta_cents: 0 }]
    const groups = groupLines([
      line('Mojito', 1, 6500, { modifiers: free }),
      line('Mojito', 1, 6500, { notes: 'poca menta' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.quantity).toBe(2)
    expect(groups[0]?.extras).toEqual([])
  })

  it('cuenta lo que ya se cobró por producto', () => {
    const [group] = groupLines([
      line('Mojito', 2, 6500, { paid_units: 2 }),
      line('Mojito', 3, 6500, { paid_units: 1 }),
    ])
    expect(group?.paidUnits).toBe(3)
    expect(group?.freeUnits).toBe(2)
    expect(freeUnits(groupLines([line('Lomo', 1, 30_000, { paid_units: 1 })]))).toBe(0)
  })
})

describe('elegir qué paga cada uno', () => {
  const first = line('Mojito', 2, 6500, { paid_units: 1 })
  const second = line('Mojito', 3, 6500)
  const lomo = line('Lomo', 1, 30_000)
  const groups = groupLines([first, second, lomo])
  const mojito = groups[0]
  const lomoGroup = groups[1]
  if (!mojito || !lomoGroup) throw new Error('faltan los renglones de la prueba')

  it('reparte las unidades entre los renglones de verdad, primero los más viejos', () => {
    expect(picksForGroup(mojito, 3)).toEqual([
      { lineId: first.id, units: 1 },
      { lineId: second.id, units: 2 },
    ])
  })

  it('nunca elige más de lo que queda sin cobrar', () => {
    expect(picksForGroup(mojito, 99)).toEqual([
      { lineId: first.id, units: 1 },
      { lineId: second.id, units: 3 },
    ])
    expect(picksForGroup(mojito, 0)).toEqual([])
  })

  it('un toque suma uno; cuando están todas, el que sigue lo deja en cero', () => {
    let chosen = tapChosen(lomoGroup, {})
    expect(chosen).toEqual({ [lomoGroup.key]: 1 })
    chosen = tapChosen(lomoGroup, chosen)
    expect(chosen).toEqual({})

    let many = {}
    for (let i = 0; i < 4; i += 1) many = tapChosen(mojito, many)
    expect(many).toEqual({ [mojito.key]: 4 })
    expect(tapChosen(mojito, many)).toEqual({})
  })

  it('el «−» baja de a uno y no deja negativos', () => {
    expect(setChosen(mojito, { [mojito.key]: 2 }, 1)).toEqual({ [mojito.key]: 1 })
    expect(setChosen(mojito, { [mojito.key]: 1 }, -3)).toEqual({})
    expect(setChosen(mojito, {}, 10)).toEqual({ [mojito.key]: 4 })
  })

  it('lo elegido viaja como renglones repetidos y da la plata que corresponde', () => {
    const chosen = { [mojito.key]: 2, [lomoGroup.key]: 1 }
    const picks = expandChosen(groups, chosen)
    expect(chosenUnits(groups, chosen)).toBe(3)
    expect(picksToItemIds(picks)).toEqual([first.id, second.id, lomo.id])
    const bill = makeBill({ lines: [first, second, lomo] })
    expect(byProductAmount(bill.lines, picks, bill.bill)).toBe(pesos(43_000))
  })

  it('rotula el cobro con lo que se llevó', () => {
    expect(chosenLabel(groups, { [mojito.key]: 2, [lomoGroup.key]: 1 })).toBe('2 Mojito + 1 Lomo')
    const long = groupLines([
      line('Hamburguesa doble con cheddar y panceta', 2, 15_000),
      line('Papas con cheddar, bacon y verdeo', 1, 14_500),
    ])
    const all = Object.fromEntries(long.map((g) => [g.key, g.quantity]))
    const label = chosenLabel(long, all)
    expect(label.length).toBeLessThanOrEqual(60)
    expect(label.endsWith('…')).toBe(true)
  })

  it('se pone al día cuando otro celular cobró algo de lo elegido', () => {
    const chosen = { [mojito.key]: 4, [lomoGroup.key]: 1, viejo: 2 }
    const after = groupLines([
      { ...first, paid_units: 2 },
      { ...second, paid_units: 2 },
      { ...lomo, paid_units: 1 },
    ])
    expect(pruneChosen(after, chosen)).toEqual({ [mojito.key]: 1 })
    const same = { [mojito.key]: 1 }
    expect(pruneChosen(after, same)).toBe(same)
  })
})
