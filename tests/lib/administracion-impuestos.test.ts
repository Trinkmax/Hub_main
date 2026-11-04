import { describe, expect, it } from 'vitest'
import { buildPurchase } from '@/lib/accounting/posting/purchase'
import { buildSalesClose } from '@/lib/accounting/posting/sales-close'
import {
  AUTO_BANK_TAX_NOTE,
  buildCashMovement,
  withBankTax,
} from '@/lib/accounting/posting/treasury'
import {
  bankTaxOf,
  bpLabel,
  chargesBankTax,
  closeTaxBase,
  closeTaxes,
  DEFAULT_TAX_SETTINGS,
  parsePercentToBp,
  parseTaxSettings,
  percentOfCents,
  taxSettingsPayload,
} from '@/lib/accounting/taxes'
import type { PartyRef, PostingContext, PostingResult } from '@/lib/accounting/types'
import { voucherNumberRequired } from '@/lib/accounting/voucher-types'
import { cashMovementInput, E8, prepare, purchaseInput } from './accounting-fixtures'

/**
 * Los impuestos que se calculan solos (reunión del 29/10/2026): «ese número se debería crear solo».
 * Ingresos Brutos y Comercio e Industria van adentro del asiento del cierre; el impuesto al cheque,
 * en el mismo bundle de lo que hizo salir la plata.
 */

/** El contexto con los impuestos prendidos y los partícipes del sistema como los deja la base. */
function withTaxes(ctx: PostingContext, overrides: Partial<typeof DEFAULT_TAX_SETTINGS> = {}) {
  const parties = new Map(ctx.parties)
  for (const [id, party] of parties) {
    if (party.name.startsWith('Rentas')) parties.set(id, { ...party, systemKey: 'rentas' })
  }
  const [first] = parties.values()
  if (!first) throw new Error('Sin partícipes')
  const municipal: PartyRef = {
    ...first,
    id: '00000000-0000-4000-8000-999999999999',
    kind: 'tax_agency',
    name: 'Municipalidad de Córdoba',
    systemKey: 'municipalidad',
    payableAccountId: ctx.sys.municipal_payable.id,
  }
  parties.set(municipal.id, municipal)
  return {
    ...ctx,
    parties,
    settings: {
      ...ctx.settings,
      taxSettings: { ...DEFAULT_TAX_SETTINGS, ...overrides },
    },
  } satisfies PostingContext
}

function kinds(result: PostingResult) {
  if (!result.ok) throw new Error(`Falló: ${JSON.stringify(result.errors)}`)
  return result.bundle.documents.map((d) => d.kind)
}

describe('percentOfCents', () => {
  it('redondea a la mitad hacia arriba, sin errores de coma flotante', () => {
    expect(percentOfCents(70_000_000, 60)).toBe(420_000) // 700.000 → 4.200: el ejemplo de la reunión
    expect(percentOfCents(100, 60)).toBe(1) // 0,60 → 1 centavo
    expect(percentOfCents(83, 60)).toBe(0) // 0,498 → 0
    expect(percentOfCents(84, 60)).toBe(1) // 0,504 → 1
    expect(percentOfCents(Number.MAX_SAFE_INTEGER, 1)).toBeGreaterThan(0)
  })

  it('con importes o porcentajes raros, cero', () => {
    expect(percentOfCents(0, 60)).toBe(0)
    expect(percentOfCents(-100, 60)).toBe(0)
    expect(percentOfCents(100, 0)).toBe(0)
    expect(percentOfCents(1.5, 60)).toBe(0)
  })
})

describe('parseTaxSettings', () => {
  it('los porcentajes de la reunión son los de fábrica', () => {
    expect(DEFAULT_TAX_SETTINGS).toEqual({
      auto: true,
      iibbBp: 300,
      municipalBp: 70,
      bankTaxBp: 60,
      base: 'invoiced_net',
    })
    expect(parseTaxSettings(null)).toEqual(DEFAULT_TAX_SETTINGS)
    expect(parseTaxSettings([])).toEqual(DEFAULT_TAX_SETTINGS)
  })

  it('un valor raro cae en el de fábrica, sin perder los demás', () => {
    expect(
      parseTaxSettings({ auto: false, iibb_bp: 'x', municipal_bp: -1, bank_tax_bp: 50 }),
    ).toEqual({ auto: false, iibbBp: 300, municipalBp: 70, bankTaxBp: 50, base: 'invoiced_net' })
  })

  it('ida y vuelta con lo que guarda la base', () => {
    const settings = {
      auto: false,
      iibbBp: 250,
      municipalBp: 10,
      bankTaxBp: 120,
      base: 'all_sales',
    } as const
    expect(parseTaxSettings(taxSettingsPayload(settings))).toEqual(settings)
  })
})

describe('parsePercentToBp y bpLabel', () => {
  it('entiende la coma y el signo de por ciento', () => {
    expect(parsePercentToBp('0,7')).toBe(70)
    expect(parsePercentToBp('3 %')).toBe(300)
    expect(parsePercentToBp('0.6')).toBe(60)
  })

  it('rechaza lo que no es un porcentaje', () => {
    expect(parsePercentToBp('')).toBeNull()
    expect(parsePercentToBp('abc')).toBeNull()
    expect(parsePercentToBp('101')).toBeNull()
    expect(parsePercentToBp('-1')).toBeNull()
  })

  it('se muestra como se habla', () => {
    expect(bpLabel(300)).toBe('3 %')
    expect(bpLabel(70)).toBe('0,7 %')
    expect(bpLabel(60)).toBe('0,6 %')
  })
})

describe('chargesBankTax y bankTaxOf', () => {
  it('sin decidir: bancos y billeteras sí, efectivo no', () => {
    expect(chargesBankTax({ kind: 'bank' })).toBe(true)
    expect(chargesBankTax({ kind: 'wallet' })).toBe(true)
    expect(chargesBankTax({ kind: 'cash' })).toBe(false)
  })

  it('el interruptor de la cuenta manda', () => {
    expect(chargesBankTax({ kind: 'bank', chargesBankTax: false })).toBe(false)
    expect(chargesBankTax({ kind: 'cash', chargesBankTax: true })).toBe(true)
    expect(chargesBankTax({ kind: 'wallet', chargesBankTax: null })).toBe(true)
  })

  it('apagado o sin cuenta, cero', () => {
    expect(bankTaxOf(70_000_000, { kind: 'bank' }, DEFAULT_TAX_SETTINGS)).toBe(420_000)
    expect(bankTaxOf(70_000_000, { kind: 'cash' }, DEFAULT_TAX_SETTINGS)).toBe(0)
    expect(bankTaxOf(70_000_000, null, DEFAULT_TAX_SETTINGS)).toBe(0)
    expect(bankTaxOf(70_000_000, { kind: 'bank' }, null)).toBe(0)
    expect(bankTaxOf(70_000_000, { kind: 'bank' }, { ...DEFAULT_TAX_SETTINGS, auto: false })).toBe(
      0,
    )
  })
})

describe('closeTaxBase y closeTaxes', () => {
  const day = { invoicedNetCents: 115_000_000, uninvoicedCents: 30_850_000 }

  it('por defecto, sobre lo facturado sin IVA', () => {
    expect(closeTaxBase(day, 'invoiced_net')).toBe(115_000_000)
    expect(closeTaxes(day, DEFAULT_TAX_SETTINGS)).toEqual({
      iibbCents: 3_450_000,
      municipalCents: 805_000,
    })
  })

  it('«Todo lo vendido» suma lo que no tiene factura', () => {
    expect(closeTaxBase(day, 'all_sales')).toBe(145_850_000)
    expect(closeTaxes(day, { ...DEFAULT_TAX_SETTINGS, base: 'all_sales' })).toEqual({
      iibbCents: 4_375_500,
      municipalCents: 1_020_950,
    })
  })

  it('un día con notas de crédito de más no da impuesto negativo', () => {
    expect(
      closeTaxes({ invoicedNetCents: -100, uninvoicedCents: -50 }, DEFAULT_TAX_SETTINGS),
    ).toEqual({
      iibbCents: 0,
      municipalCents: 0,
    })
  })

  it('apagados o sin configurar, nada', () => {
    const off = { iibbCents: 0, municipalCents: 0 }
    expect(closeTaxes(day, { ...DEFAULT_TAX_SETTINGS, auto: false })).toEqual(off)
    expect(closeTaxes(day, null)).toEqual(off)
    expect(closeTaxes(day, undefined)).toEqual(off)
  })
})

describe('el cierre del día devenga Ingresos Brutos y Comercio e Industria', () => {
  /** E8: facturado neto 115.000.000 (vendido 170.000.000, sin factura 30.850.000, IVA 24.150.000). */
  function close(ctx: PostingContext, meta: Parameters<typeof buildSalesClose>[2]) {
    const { r } = prepare(E8)
    return buildSalesClose(E8.input(r), ctx, meta)
  }
  const manualLines = (result: PostingResult) => {
    if (!result.ok) throw new Error(`Falló: ${JSON.stringify(result.errors)}`)
    return result.bundle.documents[0]?.lines.filter((l) => l.role === 'manual') ?? []
  }

  it('sin configurar, el asiento es el de siempre', () => {
    const { ctx, meta } = prepare(E8)
    expect(manualLines(close(ctx, meta))).toEqual([])
  })

  it('agrega los cuatro renglones en el mismo asiento, y el asiento cierra', () => {
    const { ctx, meta } = prepare(E8)
    const taxed = withTaxes(ctx)
    const result = close(taxed, meta)
    expect(result.ok).toBe(true)
    const lines = manualLines(result)
    expect(lines.map((l) => [l.accountId, l.side, l.amountCents])).toEqual([
      [taxed.sys.iibb_expense.id, 'debit', 3_450_000],
      [taxed.sys.iibb_payable.id, 'credit', 3_450_000],
      [taxed.sys.municipal_tax_expense.id, 'debit', 805_000],
      [taxed.sys.municipal_payable.id, 'credit', 805_000],
    ])
    // Los renglones de deuda llevan su partícipe: Rentas y la Municipalidad.
    const owed = lines.filter((l) => l.side === 'credit').map((l) => l.partyRef)
    expect(owed.every(Boolean)).toBe(true)
    // Un solo comprobante: se anulan y se corrigen con el cierre.
    expect(kinds(result)).toEqual(['sales_close'])
  })

  it('con base «Todo lo vendido» usa los números del día completo', () => {
    const { ctx, meta } = prepare(E8)
    const lines = manualLines(close(withTaxes(ctx, { base: 'all_sales' }), meta))
    expect(lines.map((l) => l.amountCents)).toEqual([4_375_500, 4_375_500, 1_020_950, 1_020_950])
  })

  it('apagados, nada', () => {
    const { ctx, meta } = prepare(E8)
    expect(manualLines(close(withTaxes(ctx, { auto: false }), meta))).toEqual([])
  })

  it('sin el partícipe del sistema no calcula ese impuesto, y el cierre no se frena', () => {
    const { ctx, meta } = prepare(E8)
    const taxed = withTaxes(ctx)
    const parties = new Map(taxed.parties)
    for (const [id, party] of parties) {
      if (party.systemKey === 'rentas') parties.delete(id)
    }
    const result = close({ ...taxed, parties }, meta)
    expect(result.ok).toBe(true)
    // Solo Comercio e Industria.
    expect(manualLines(result).map((l) => l.amountCents)).toEqual([805_000, 805_000])
  })
})

describe('withBankTax: el impuesto al cheque viaja con lo que hizo salir la plata', () => {
  function movement(treasuryKey: 'caja' | 'mp' | 'banco', direction: 'in' | 'out' = 'out') {
    const fixture = prepare()
    const { r, meta } = fixture
    const taxed = withTaxes(fixture.ctx)
    const input = cashMovementInput({
      treasuryAccountId: r.treasury(treasuryKey),
      direction,
      counterpartAccountId: r.account('partners_current'),
      partyId: r.party('maximo'),
      amountCents: 70_000_000,
      date: '2026-10-15',
      shortcut: direction === 'in' ? 'partner_contribution' : 'partner_withdrawal',
    })
    return { taxed, meta, r, input }
  }

  it('un movimiento del banco: 700.000 → 4.200, marcado y con la parte computable', () => {
    const { taxed, meta, r, input } = movement('banco')
    const result = withBankTax(buildCashMovement(input, taxed, meta), taxed, meta)
    expect(kinds(result)).toEqual(['cash_movement', 'bank_expense'])
    if (!result.ok) return
    const tax = result.bundle.documents[1]
    expect(tax?.notes).toBe(AUTO_BANK_TAX_NOTE)
    expect(tax?.totalCents).toBe(420_000)
    const treasury = tax?.lines.find((l) => l.role === 'treasury')
    expect(treasury).toMatchObject({
      side: 'credit',
      amountCents: 420_000,
      treasuryAccountId: r.treasury('banco'),
    })
    const taxes = tax?.lines.filter((l) => l.role === 'other_tax') ?? []
    // 33 % computable en Ganancias, el resto al gasto.
    expect(taxes.map((l) => [l.accountId, l.amountCents])).toEqual([
      [taxed.sys.bank_tax_credit.id, 138_600],
      [taxed.sys.bank_tax_expense.id, 281_400],
    ])
  })

  it('también de una billetera; del efectivo, no', () => {
    const mp = movement('mp')
    expect(
      kinds(withBankTax(buildCashMovement(mp.input, mp.taxed, mp.meta), mp.taxed, mp.meta)),
    ).toEqual(['cash_movement', 'bank_expense'])
    const box = movement('caja')
    expect(
      kinds(withBankTax(buildCashMovement(box.input, box.taxed, box.meta), box.taxed, box.meta)),
    ).toEqual(['cash_movement'])
  })

  it('el interruptor de la cuenta manda', () => {
    const { taxed, meta, r, input } = movement('banco')
    const treasuries = new Map(taxed.treasuries)
    const bank = treasuries.get(r.treasury('banco'))
    if (!bank) throw new Error('Falta el banco')
    treasuries.set(bank.id, { ...bank, chargesBankTax: false })
    const off = { ...taxed, treasuries }
    expect(kinds(withBankTax(buildCashMovement(input, off, meta), off, meta))).toEqual([
      'cash_movement',
    ])
  })

  it('si entra plata, no hay impuesto (el de créditos se reconoce con el extracto)', () => {
    const { taxed, meta, input } = movement('banco', 'in')
    expect(kinds(withBankTax(buildCashMovement(input, taxed, meta), taxed, meta))).toEqual([
      'cash_movement',
    ])
  })

  it('apagado o en cero, pasa igual', () => {
    const base = movement('banco')
    for (const overrides of [{ auto: false }, { bankTaxBp: 0 }]) {
      const ctx = withTaxes(base.taxed, overrides)
      expect(
        kinds(withBankTax(buildCashMovement(base.input, ctx, base.meta), ctx, base.meta)),
      ).toEqual(['cash_movement'])
    }
  })

  it('un error en la propuesta pasa como está', () => {
    const { taxed, meta } = movement('banco')
    const failed: PostingResult = { ok: false, errors: [{ key: 'same_treasury', field: 'x' }] }
    expect(withBankTax(failed, taxed, meta)).toBe(failed)
  })
})

describe('el tique no pide número', () => {
  it('factura sí, tique no', () => {
    expect(voucherNumberRequired('factura_a')).toBe(true)
    expect(voucherNumberRequired('factura_c')).toBe(true)
    expect(voucherNumberRequired('tique')).toBe(false)
  })

  it('una compra con tique sin número se guarda y no va al libro IVA', () => {
    const { ctx, meta, r } = prepare()
    const result = buildPurchase(
      purchaseInput({
        partyId: r.party('kiosco'),
        voucherType: 'tique',
        pointOfSale: null,
        number: null,
        issueDate: '2026-10-05',
        amountMode: 'total',
        total: {
          totalCents: 1_210_000,
          vatRateBp: 2100,
          accountId: r.account('purchases_soft_drinks'),
        },
        controlTotalCents: 1_210_000,
      }),
      ctx,
      meta,
    )
    expect(kinds(result)).toEqual(['purchase'])
    if (!result.ok) return
    expect(result.bundle.documents[0]?.fiscalVouchers).toEqual([])
  })

  it('una factura sin número sigue frenando', () => {
    const { ctx, meta, r } = prepare()
    const result = buildPurchase(
      {
        ...purchaseInput({
          partyId: r.party('cocacola'),
          voucherType: 'factura_a',
          pointOfSale: 3,
          number: 1290,
          issueDate: '2026-10-05',
          amountMode: 'total',
          total: {
            totalCents: 1_210_000,
            vatRateBp: 2100,
            accountId: r.account('purchases_soft_drinks'),
          },
          controlTotalCents: 1_210_000,
        }),
        pointOfSale: null,
        number: null,
      },
      ctx,
      meta,
    )
    expect(result.ok).toBe(false)
  })
})
