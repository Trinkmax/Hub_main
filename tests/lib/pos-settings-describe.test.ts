// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { NBSP } from '@/lib/money'
import { APPROVER_LABEL, describeChanges } from '@/lib/pos/settings/describe'
import { applyChanges, invertChanges } from '@/lib/pos/settings/patch'
import {
  APPROVER_ROLES,
  DEFAULT_POS_SETTINGS,
  type PosSettings,
  type SettingChange,
} from '@/lib/pos/settings/types'
import { ROLE_LABELS } from '@/lib/tenant/roles'

const NOW: PosSettings = { ...DEFAULT_POS_SETTINGS, creditSurchargeBp: 1000 }

/** El aviso de un gesto: lo que cambia, sobre los ajustes como quedan. */
const say = (changes: SettingChange[], base: PosSettings = NOW) =>
  describeChanges(changes, applyChanges(base, changes))

describe('describeChanges', () => {
  it('los tiempos', () => {
    expect(say([{ key: 'orderWarnMinutes', value: 8, expected: 6 }])).toBe(
      'Sin pedido: avisa a los 8 min',
    )
    expect(say([{ key: 'billWarnMinutes', value: 5, expected: 4 }])).toBe(
      'Cuenta pedida: avisa a los 5 min',
    )
    expect(say([{ key: 'readyWarnMinutes', value: 3, expected: 2 }])).toBe(
      'Comida lista: roja a los 9 min',
    )
  })

  it('los dos tiempos de la cocina se dicen juntos, aunque se haya movido uno', () => {
    expect(say([{ key: 'kitchenWarnMinutes', value: 15, expected: 12 }])).toBe(
      'Esperando la comida: avisa a los 15 min, roja a los 20',
    )
    expect(
      say([
        { key: 'kitchenWarnMinutes', value: 24, expected: 12 },
        { key: 'kitchenLateMinutes', value: 24, expected: 20 },
      ]),
    ).toBe('Esperando la comida: avisa a los 24 min, roja a los 24')
  })

  it('el recargo, con de cuánto a cuánto', () => {
    expect(say([{ key: 'creditSurchargeBp', value: 1250, expected: 1000 }])).toBe(
      `Recargo de crédito: 10${NBSP}% → 12,5${NBSP}%`,
    )
    expect(say([{ key: 'creditSurchargeBp', value: 0, expected: 1000 }])).toBe(
      'Crédito sin recargo',
    )
    expect(say([{ key: 'creditSurchargeBp', value: 800, expected: 0 }])).toBe(
      `Recargo de crédito: 8${NBSP}%`,
    )
  })

  it('qué se factura: el medio que cambió', () => {
    const base = NOW.invoiceByMethod
    expect(say([{ key: 'invoiceByMethod', value: { ...base, cash: true }, expected: base }])).toBe(
      'Efectivo: se factura',
    )
    expect(say([{ key: 'invoiceByMethod', value: { ...base, qr: false }, expected: base }])).toBe(
      'QR: no se factura',
    )
    expect(
      say([{ key: 'invoiceByMethod', value: { ...base, qr: false, cash: true }, expected: base }]),
    ).toBe('Cambió qué se factura')
  })

  it('las propinas', () => {
    expect(say([{ key: 'tipPresetsPct', value: [15, 10], expected: [10] }])).toBe(
      `Propinas sugeridas: 10${NBSP}% y 15${NBSP}%`,
    )
    expect(say([{ key: 'tipPresetsPct', value: [], expected: [10] }])).toBe(
      'Sin propinas sugeridas',
    )
  })

  it('quién da el OK', () => {
    expect(
      say([
        {
          key: 'approverRoles',
          value: ['owner', 'cashier', 'waiter'],
          expected: ['owner', 'cashier'],
        },
      ]),
    ).toBe('Mozo: ahora da el OK')
    expect(say([{ key: 'approverRoles', value: ['owner'], expected: ['owner', 'cashier'] }])).toBe(
      'Cajero: ya no da el OK',
    )
    expect(say([{ key: 'discountNeedsApproval', value: false, expected: true }])).toBe(
      'Los descuentos ya no piden el OK',
    )
    expect(say([{ key: 'voidNeedsApproval', value: true, expected: false }])).toBe(
      'Las bajas piden el OK',
    )
  })

  it('el alias y el titular', () => {
    expect(say([{ key: 'transferAlias', value: 'hub.bar', expected: null }])).toBe('Alias: hub.bar')
    expect(say([{ key: 'transferAlias', value: null, expected: 'hub.bar' }])).toBe('Alias borrado')
    expect(say([{ key: 'transferHolder', value: 'HUB SAS', expected: null }])).toBe(
      'Titular: HUB SAS',
    )
  })

  it('los billetes, en pesos', () => {
    const bills = NOW.billDenominations
    expect(say([{ key: 'billDenominations', value: [...bills, 50], expected: bills }])).toBe(
      `$${NBSP}50 se cuenta en la caja`,
    )
    expect(
      say([
        {
          key: 'billDenominations',
          value: bills.filter((bill) => bill !== 20000),
          expected: bills,
        },
      ]),
    ).toBe(`$${NBSP}20.000 ya no se cuenta en la caja`)
  })

  it('deshacer se describe con el gesto contrario: dice cómo quedó', () => {
    const changes: SettingChange[] = [{ key: 'creditSurchargeBp', value: 1250, expected: 1000 }]
    const after = applyChanges(NOW, changes)
    const undo = invertChanges(changes)
    expect(describeChanges(undo, applyChanges(after, undo))).toBe(
      `Recargo de crédito: 12,5${NBSP}% → 10${NBSP}%`,
    )
  })

  it('sin cambios no inventa nada', () => {
    expect(describeChanges([], NOW)).toBe('Sin cambios')
  })
})

describe('los nombres de los roles', () => {
  it('son los mismos que en Equipo', () => {
    for (const role of APPROVER_ROLES) expect(APPROVER_LABEL[role]).toBe(ROLE_LABELS[role])
  })
})
