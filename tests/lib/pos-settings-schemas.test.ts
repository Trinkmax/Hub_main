// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PAY_METHODS } from '@/lib/pos/cash/types'
import { fullRow, rowPatch, SETTINGS_COLUMNS, settingsFromRow } from '@/lib/pos/settings/row'
import {
  parseSettingChanges,
  readAlias,
  readHolder,
  saveSettingsSchema,
} from '@/lib/pos/settings/schemas'
import { DEFAULT_POS_SETTINGS, SETTING_KEYS } from '@/lib/pos/settings/types'

const INVOICE = DEFAULT_POS_SETTINGS.invoiceByMethod

describe('readAlias', () => {
  it('acepta un alias de banco y lo deja sin espacios', () => {
    expect(readAlias(' hub.bar.mp ')).toEqual({ ok: true, alias: 'hub.bar.mp' })
    expect(readAlias('HUB-SAS')).toEqual({ ok: true, alias: 'HUB-SAS' })
  })

  it('acepta un CBU o CVU de 22 números, aunque venga con espacios', () => {
    expect(readAlias('0000003100012345678901')).toEqual({
      ok: true,
      alias: '0000003100012345678901',
    })
    expect(readAlias('00000031 0001234567 8901')).toEqual({
      ok: true,
      alias: '0000003100012345678901',
    })
  })

  it('vacío es «sin alias»', () => {
    expect(readAlias('')).toEqual({ ok: true, alias: null })
    expect(readAlias('   ')).toEqual({ ok: true, alias: null })
    expect(readAlias(null)).toEqual({ ok: true, alias: null })
  })

  it('rechaza lo que un banco no aceptaría, y explica cómo es', () => {
    for (const bad of ['hub', 'un alias con espacios raros!', 'a'.repeat(21), 'hub_bar', '123']) {
      const read = readAlias(bad)
      expect(read.ok, bad).toBe(false)
      if (!read.ok) expect(read.message).toContain('6 a 20')
    }
  })
})

describe('readHolder', () => {
  it('deja el nombre prolijo, y vacío es «sin titular»', () => {
    expect(readHolder('  HUB   Coffee & Bar SAS ')).toEqual({
      ok: true,
      holder: 'HUB Coffee & Bar SAS',
    })
    expect(readHolder(' ')).toEqual({ ok: true, holder: null })
  })

  it('entra en 80 letras', () => {
    expect(readHolder('x'.repeat(80)).ok).toBe(true)
    expect(readHolder('x'.repeat(81)).ok).toBe(false)
  })
})

describe('parseSettingChanges', () => {
  it('acepta un ajuste con lo que la persona veía', () => {
    expect(
      parseSettingChanges({
        changes: [{ key: 'creditSurchargeBp', value: 1250, expected: 1000 }],
      }),
    ).toEqual({ ok: true, changes: [{ key: 'creditSurchargeBp', value: 1250, expected: 1000 }] })
  })

  it('respeta los topes de la base en cada tiempo', () => {
    const minutes = (key: string, value: number) =>
      parseSettingChanges({ changes: [{ key, value, expected: 6 }] }).ok
    expect(minutes('orderWarnMinutes', 120)).toBe(true)
    expect(minutes('orderWarnMinutes', 121)).toBe(false)
    expect(minutes('orderWarnMinutes', 0)).toBe(false)
    expect(minutes('kitchenLateMinutes', 240)).toBe(true)
    expect(minutes('kitchenLateMinutes', 241)).toBe(false)
    expect(minutes('readyWarnMinutes', 60)).toBe(true)
    expect(minutes('readyWarnMinutes', 61)).toBe(false)
    expect(minutes('billWarnMinutes', 2.5)).toBe(false)
  })

  it('el recargo va de 0 a 50 %', () => {
    const bp = (value: number) =>
      parseSettingChanges({ changes: [{ key: 'creditSurchargeBp', value, expected: 0 }] }).ok
    expect(bp(0)).toBe(true)
    expect(bp(5000)).toBe(true)
    expect(bp(5001)).toBe(false)
    expect(bp(-1)).toBe(false)
  })

  it('qué se factura pide los seis medios; lo que la persona veía puede venir incompleto', () => {
    const parsed = parseSettingChanges({
      changes: [
        { key: 'invoiceByMethod', value: { ...INVOICE, cash: true }, expected: { cash: false } },
      ],
    })
    expect(parsed).toEqual({
      ok: true,
      changes: [
        {
          key: 'invoiceByMethod',
          value: { ...INVOICE, cash: true },
          expected: Object.fromEntries(PAY_METHODS.map((method) => [method, false])),
        },
      ],
    })
    expect(
      parseSettingChanges({
        changes: [{ key: 'invoiceByMethod', value: { cash: true }, expected: INVOICE }],
      }).ok,
    ).toBe(false)
  })

  it('las propinas: hasta cuatro, de 1 a 50 %', () => {
    const tips = (value: number[]) =>
      parseSettingChanges({ changes: [{ key: 'tipPresetsPct', value, expected: [10] }] }).ok
    expect(tips([])).toBe(true)
    expect(tips([5, 10, 15, 20])).toBe(true)
    expect(tips([5, 10, 15, 20, 25])).toBe(false)
    expect(tips([0])).toBe(false)
    expect(tips([51])).toBe(false)
  })

  it('quién da el OK: solo roles que existen, y al menos uno', () => {
    const roles = (value: string[]) =>
      parseSettingChanges({
        changes: [{ key: 'approverRoles', value, expected: ['owner', 'cashier'] }],
      }).ok
    expect(roles(['owner', 'waiter'])).toBe(true)
    expect(roles([])).toBe(false)
    expect(roles(['owner', 'kitchen'])).toBe(false)
    expect(roles(['owner', 'accountant'])).toBe(false)
  })

  it('un rol desconocido en lo que la persona veía se descarta, no rompe', () => {
    const parsed = parseSettingChanges({
      changes: [{ key: 'approverRoles', value: ['owner'], expected: ['owner', 'gerente'] }],
    })
    expect(parsed).toEqual({
      ok: true,
      changes: [{ key: 'approverRoles', value: ['owner'], expected: ['owner'] }],
    })
  })

  it('el alias se valida y el motivo se puede mostrar', () => {
    const bad = parseSettingChanges({
      changes: [{ key: 'transferAlias', value: 'hub', expected: null }],
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.message).toContain('6 a 20')
    expect(
      parseSettingChanges({
        changes: [{ key: 'transferAlias', value: ' hub.bar.mp ', expected: null }],
      }),
    ).toEqual({
      ok: true,
      changes: [{ key: 'transferAlias', value: 'hub.bar.mp', expected: null }],
    })
    expect(
      parseSettingChanges({
        changes: [{ key: 'transferAlias', value: '', expected: 'hub.bar.mp' }],
      }),
    ).toEqual({
      ok: true,
      changes: [{ key: 'transferAlias', value: null, expected: 'hub.bar.mp' }],
    })
  })

  it('los billetes: pesos enteros y al menos uno', () => {
    const bills = (value: number[]) =>
      parseSettingChanges({
        changes: [{ key: 'billDenominations', value, expected: [1000] }],
      }).ok
    expect(bills([20000, 1000])).toBe(true)
    expect(bills([])).toBe(false)
    expect(bills([0])).toBe(false)
    expect(bills([100.5])).toBe(false)
  })

  it('un pedido mal armado no tiene motivo para mostrar', () => {
    for (const input of [
      null,
      {},
      { changes: [] },
      { changes: [{ key: 'tenant_id', value: 'x', expected: 'y' }] },
      { changes: [{ key: 'updated_by', value: 'x', expected: 'y' }] },
      { changes: [{ key: 'creditSurchargeBp', value: '1000', expected: 1000 }] },
      {
        changes: [
          { key: 'orderWarnMinutes', value: 7, expected: 6 },
          { key: 'orderWarnMinutes', value: 8, expected: 6 },
        ],
      },
    ]) {
      expect(parseSettingChanges(input)).toEqual({ ok: false, message: null })
    }
  })

  it('un gesto mueve como mucho cuatro ajustes', () => {
    const five = {
      changes: [
        { key: 'orderWarnMinutes', value: 7, expected: 6 },
        { key: 'kitchenWarnMinutes', value: 13, expected: 12 },
        { key: 'kitchenLateMinutes', value: 21, expected: 20 },
        { key: 'readyWarnMinutes', value: 3, expected: 2 },
        { key: 'billWarnMinutes', value: 5, expected: 4 },
      ],
    }
    expect(saveSettingsSchema.safeParse(five).success).toBe(false)
  })
})

describe('settingsFromRow', () => {
  it('sin fila valen los de fábrica, en una copia que se puede tocar', () => {
    const settings = settingsFromRow(null)
    expect(settings).toEqual(DEFAULT_POS_SETTINGS)
    settings.billDenominations.push(1)
    settings.invoiceByMethod.cash = true
    expect(DEFAULT_POS_SETTINGS.billDenominations).not.toContain(1)
    expect(DEFAULT_POS_SETTINGS.invoiceByMethod.cash).toBe(false)
  })

  it('lee una fila como la devuelve la base', () => {
    const settings = settingsFromRow({
      order_warn_minutes: 8,
      kitchen_warn_minutes: 15,
      kitchen_late_minutes: 25,
      ready_warn_minutes: 3,
      bill_warn_minutes: 5,
      credit_surcharge_bp: 1250,
      invoice_by_method: { qr: true, cash: true, debit: false, other: false, credit: true },
      tip_presets_pct: [15, 10],
      approver_roles: ['cashier', 'owner'],
      discount_needs_approval: false,
      void_needs_approval: true,
      transfer_alias: ' demo.bar.mp ',
      transfer_holder: 'Bar de ejemplo SAS',
      bill_denominations: [100, 20000, 1000],
      updated_at: '2026-11-13T02:22:57.605825+00:00',
    })
    expect(settings).toEqual({
      orderWarnMinutes: 8,
      kitchenWarnMinutes: 15,
      kitchenLateMinutes: 25,
      readyWarnMinutes: 3,
      billWarnMinutes: 5,
      creditSurchargeBp: 1250,
      // `transfer` no venía en la fila: lo que falta es «no».
      invoiceByMethod: {
        cash: true,
        transfer: false,
        qr: true,
        debit: false,
        credit: true,
        other: false,
      },
      tipPresetsPct: [10, 15],
      approverRoles: ['cashier', 'owner'],
      discountNeedsApproval: false,
      voidNeedsApproval: true,
      transferAlias: 'demo.bar.mp',
      transferHolder: 'Bar de ejemplo SAS',
      billDenominations: [20000, 1000, 100],
    })
  })

  it('lo que falta o viene roto cae al valor de fábrica', () => {
    const settings = settingsFromRow({
      order_warn_minutes: 'ocho',
      credit_surcharge_bp: -40,
      invoice_by_method: 'no es un objeto',
      approver_roles: ['gerente'],
      bill_denominations: [],
      transfer_alias: '   ',
    })
    expect(settings.orderWarnMinutes).toBe(DEFAULT_POS_SETTINGS.orderWarnMinutes)
    expect(settings.creditSurchargeBp).toBe(0)
    expect(settings.invoiceByMethod).toEqual(DEFAULT_POS_SETTINGS.invoiceByMethod)
    expect(settings.approverRoles).toEqual(DEFAULT_POS_SETTINGS.approverRoles)
    expect(settings.billDenominations).toEqual(DEFAULT_POS_SETTINGS.billDenominations)
    expect(settings.transferAlias).toBeNull()
  })

  it('los números de la base pueden llegar como texto', () => {
    expect(settingsFromRow({ credit_surcharge_bp: '1000' }).creditSurchargeBp).toBe(1000)
  })
})

describe('rowPatch', () => {
  it('escribe solo las columnas de los ajustes que cambian', () => {
    const next = { ...DEFAULT_POS_SETTINGS, creditSurchargeBp: 1200, transferAlias: 'hub.bar' }
    expect(rowPatch(['creditSurchargeBp', 'transferAlias'], next)).toEqual({
      credit_surcharge_bp: 1200,
      transfer_alias: 'hub.bar',
    })
  })

  it('la fila entera lleva todas las columnas, y se vuelve a leer igual', () => {
    const row = fullRow(DEFAULT_POS_SETTINGS)
    expect(Object.keys(row)).toHaveLength(SETTING_KEYS.length)
    expect(settingsFromRow(row)).toEqual(DEFAULT_POS_SETTINGS)
  })

  it('lo que se pide a la base son esas columnas y la versión de la fila', () => {
    const columns = SETTINGS_COLUMNS.split(', ')
    expect(columns).toHaveLength(SETTING_KEYS.length + 1)
    expect(columns).toContain('updated_at')
    expect(columns).not.toContain('tenant_id')
  })
})
