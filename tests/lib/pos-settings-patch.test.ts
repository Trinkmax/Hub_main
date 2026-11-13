// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PAY_METHODS } from '@/lib/pos/cash/types'
import {
  billChoices,
  billsAllowed,
  normalizeBills,
  PESO_BILLS,
  toggleBill,
} from '@/lib/pos/settings/bills'
import {
  applyChanges,
  invertChanges,
  normalizeSetting,
  planSettingsPatch,
} from '@/lib/pos/settings/patch'
import {
  DEFAULT_POS_SETTINGS,
  type PosSettings,
  SETTING_COLUMN,
  SETTING_KEYS,
  type SettingChange,
  sameSetting,
} from '@/lib/pos/settings/types'

const NOW: PosSettings = {
  ...DEFAULT_POS_SETTINGS,
  creditSurchargeBp: 1000,
  transferAlias: 'demo.bar.mp',
}

describe('los billetes', () => {
  it('la lista de los que existen va de mayor a menor y sin repetidos', () => {
    expect([...PESO_BILLS]).toEqual(normalizeBills(PESO_BILLS))
    expect(PESO_BILLS[0]).toBe(20000)
  })

  it('los de fábrica son billetes que existen', () => {
    for (const bill of DEFAULT_POS_SETTINGS.billDenominations) {
      expect(PESO_BILLS, String(bill)).toContain(bill)
    }
  })

  it('normalizeBills ordena, saca repetidos y lo que no es un billete', () => {
    expect(normalizeBills([100, 20000, 100, 0, -50, 12.5, 500])).toEqual([20000, 500, 100])
  })

  it('tocar un billete lo suma o lo saca, y la lista queda ordenada', () => {
    expect(toggleBill([1000, 500], 2000)).toEqual([2000, 1000, 500])
    expect(toggleBill([2000, 1000, 500], 1000)).toEqual([2000, 500])
  })

  it('el último billete no se puede sacar', () => {
    expect(toggleBill([1000], 1000)).toBeNull()
  })

  it('se ofrece también un billete que el bar ya usa aunque no esté en la lista', () => {
    expect(billChoices([50000, 1000])[0]).toBe(50000)
    expect(billChoices([1000])).toEqual([...PESO_BILLS])
  })

  it('se puede guardar lo que existe o lo que el bar ya usaba, pero no un número suelto', () => {
    expect(billsAllowed([20000, 1000], [1000])).toBe(true)
    expect(billsAllowed([50000, 1000], [50000])).toBe(true)
    expect(billsAllowed([50000, 1000], [1000])).toBe(false)
    expect(billsAllowed([1234], [1000])).toBe(false)
    expect(billsAllowed([], [1000])).toBe(false)
  })
})

describe('sameSetting', () => {
  it('las listas comparan por contenido, no por orden', () => {
    expect(sameSetting('billDenominations', [100, 500], [500, 100])).toBe(true)
    expect(sameSetting('billDenominations', [100, 500], [500])).toBe(false)
    expect(sameSetting('approverRoles', ['owner', 'cashier'], ['cashier', 'owner'])).toBe(true)
    expect(sameSetting('tipPresetsPct', [], [])).toBe(true)
  })

  it('qué se factura compara medio por medio', () => {
    const base = DEFAULT_POS_SETTINGS.invoiceByMethod
    expect(sameSetting('invoiceByMethod', base, { ...base })).toBe(true)
    expect(sameSetting('invoiceByMethod', base, { ...base, cash: true })).toBe(false)
  })

  it('lo demás compara tal cual', () => {
    expect(sameSetting('creditSurchargeBp', 1000, 1000)).toBe(true)
    expect(sameSetting('transferAlias', null, 'x')).toBe(false)
    expect(sameSetting('discountNeedsApproval', true, false)).toBe(false)
  })
})

describe('normalizeSetting', () => {
  it('el dueño siempre puede dar el OK, y los roles quedan en su orden', () => {
    expect(normalizeSetting('approverRoles', ['waiter'])).toEqual(['owner', 'waiter'])
    expect(normalizeSetting('approverRoles', ['host', 'cashier', 'owner'])).toEqual([
      'owner',
      'cashier',
      'host',
    ])
  })

  it('las propinas quedan de menor a mayor y sin repetidos', () => {
    expect(normalizeSetting('tipPresetsPct', [15, 10, 15])).toEqual([10, 15])
  })

  it('qué se factura sale siempre con los seis medios', () => {
    const partial = { cash: true } as PosSettings['invoiceByMethod']
    const full = normalizeSetting('invoiceByMethod', partial)
    expect(Object.keys(full).sort()).toEqual([...PAY_METHODS].sort())
    expect(full.cash).toBe(true)
    expect(full.credit).toBe(false)
  })
})

describe('planSettingsPatch', () => {
  it('si el ajuste sigue como la persona lo veía, se escribe', () => {
    const plan = planSettingsPatch(NOW, [{ key: 'creditSurchargeBp', value: 1200, expected: 1000 }])
    expect(plan).toMatchObject({ kind: 'write', keys: ['creditSurchargeBp'] })
    expect(plan.kind === 'write' && plan.next.creditSurchargeBp).toBe(1200)
  })

  it('si ya está como se pidió, no hay nada que escribir', () => {
    expect(
      planSettingsPatch(NOW, [{ key: 'creditSurchargeBp', value: 1000, expected: 800 }]),
    ).toEqual({ kind: 'noop' })
  })

  it('si otro dueño lo cambió a otra cosa, no se escribe y se dice cuál', () => {
    expect(
      planSettingsPatch(NOW, [{ key: 'creditSurchargeBp', value: 1200, expected: 800 }]),
    ).toEqual({ kind: 'conflict', keys: ['creditSurchargeBp'] })
  })

  it('otro dueño puede estar cambiando OTRO ajuste: no molesta', () => {
    // La pantalla vio el alias vacío, pero lo que cambia es el recargo, que sigue como lo vio.
    const plan = planSettingsPatch(NOW, [{ key: 'creditSurchargeBp', value: 0, expected: 1000 }])
    expect(plan.kind).toBe('write')
  })

  it('los dos tiempos de la cocina van juntos o no va ninguno', () => {
    const together: SettingChange[] = [
      { key: 'kitchenWarnMinutes', value: 24, expected: 12 },
      { key: 'kitchenLateMinutes', value: 24, expected: 20 },
    ]
    expect(planSettingsPatch(NOW, together)).toMatchObject({
      kind: 'write',
      keys: ['kitchenWarnMinutes', 'kitchenLateMinutes'],
    })
    const stale: SettingChange[] = [
      { key: 'kitchenWarnMinutes', value: 24, expected: 12 },
      { key: 'kitchenLateMinutes', value: 24, expected: 30 },
    ]
    expect(planSettingsPatch(NOW, stale)).toEqual({
      kind: 'conflict',
      keys: ['kitchenLateMinutes'],
    })
  })

  it('no deja que la mesa se ponga roja antes de avisar', () => {
    expect(
      planSettingsPatch(NOW, [{ key: 'kitchenWarnMinutes', value: 25, expected: 12 }]),
    ).toMatchObject({ kind: 'invalid' })
    expect(
      planSettingsPatch(NOW, [{ key: 'kitchenLateMinutes', value: 5, expected: 20 }]),
    ).toMatchObject({ kind: 'invalid' })
  })

  it('los billetes: los mismos en otro orden no son un cambio', () => {
    expect(
      planSettingsPatch(NOW, [
        {
          key: 'billDenominations',
          value: [100, 200, 500, 1000, 2000, 10000, 20000],
          expected: NOW.billDenominations,
        },
      ]),
    ).toEqual({ kind: 'noop' })
  })

  it('los billetes: no acepta uno que no existe', () => {
    expect(
      planSettingsPatch(NOW, [
        {
          key: 'billDenominations',
          value: [...NOW.billDenominations, 1234],
          expected: NOW.billDenominations,
        },
      ]),
    ).toMatchObject({ kind: 'invalid' })
  })

  it('sacarle el OK a todos deja al dueño', () => {
    const plan = planSettingsPatch(NOW, [
      { key: 'approverRoles', value: ['owner'], expected: ['owner', 'cashier'] },
    ])
    expect(plan.kind === 'write' && plan.next.approverRoles).toEqual(['owner'])
  })

  it('lo que se pide igual a lo que hay, con el dueño agregado, no es un cambio', () => {
    expect(
      planSettingsPatch(NOW, [
        { key: 'approverRoles', value: ['cashier'], expected: ['owner', 'cashier'] },
      ]),
    ).toEqual({ kind: 'noop' })
  })

  it('no toca lo que recibe', () => {
    const before = JSON.stringify(NOW)
    planSettingsPatch(NOW, [{ key: 'tipPresetsPct', value: [15, 10], expected: [10] }])
    expect(JSON.stringify(NOW)).toBe(before)
  })
})

describe('applyChanges e invertChanges', () => {
  const changes: SettingChange[] = [
    { key: 'tipPresetsPct', value: [15, 10], expected: [10] },
    { key: 'voidNeedsApproval', value: false, expected: true },
  ]

  it('aplica encima sin tocar el original', () => {
    const next = applyChanges(NOW, changes)
    expect(next.tipPresetsPct).toEqual([10, 15])
    expect(next.voidNeedsApproval).toBe(false)
    expect(NOW.tipPresetsPct).toEqual([10])
  })

  it('deshacer es el mismo gesto al revés, y deja todo como estaba', () => {
    const inverse = invertChanges(changes)
    expect(inverse).toEqual([
      { key: 'tipPresetsPct', value: [10], expected: [15, 10] },
      { key: 'voidNeedsApproval', value: true, expected: false },
    ])
    const after = applyChanges(NOW, changes)
    const plan = planSettingsPatch(after, inverse)
    expect(plan.kind === 'write' && plan.next).toEqual(NOW)
  })
})

describe('las columnas', () => {
  it('cada ajuste tiene su columna, y ninguna se repite', () => {
    const columns = SETTING_KEYS.map((key) => SETTING_COLUMN[key])
    expect(new Set(columns).size).toBe(SETTING_KEYS.length)
    for (const column of columns) expect(column).toMatch(/^[a-z_]+$/)
  })
})
