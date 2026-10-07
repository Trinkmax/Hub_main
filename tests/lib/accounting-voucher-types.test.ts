import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_KINDS,
  IVA_CONDITIONS,
  type IvaCondition,
  VOUCHER_TYPE_KEYS,
  type VoucherType,
} from '@/lib/accounting/types'
import {
  AFIP_CURRENCY,
  AFIP_EXCHANGE_RATE,
  afipDocType,
  afipVoucherCode,
  FINAL_CONSUMER,
  isFiscalVoucherType,
  isVatComputable,
  isVoucherAllowedForKind,
  purchaseAllowsVatLines,
  SALES_CLOSE_VOUCHERS,
  VOUCHER_CATALOG,
  voucherConditionCheck,
  voucherDisplay,
  voucherLabel,
  voucherTypesForKind,
} from '@/lib/accounting/voucher-types'

describe('catálogo de comprobantes (E.3)', () => {
  it('cubre todos los tipos del CHECK adoc_voucher_type', () => {
    expect(Object.keys(VOUCHER_CATALOG).sort()).toEqual([...VOUCHER_TYPE_KEYS].sort())
    for (const t of VOUCHER_TYPE_KEYS) expect(VOUCHER_CATALOG[t].type).toBe(t)
  })

  it('códigos AFIP', () => {
    const codes = Object.fromEntries(VOUCHER_TYPE_KEYS.map((t) => [t, afipVoucherCode(t)]))
    expect(codes).toEqual({
      factura_a: 1,
      nota_debito_a: 2,
      nota_credito_a: 3,
      recibo_a: 4,
      factura_b: 6,
      nota_debito_b: 7,
      nota_credito_b: 8,
      recibo_b: 9,
      factura_c: 11,
      nota_debito_c: 12,
      nota_credito_c: 13,
      recibo_c: 15,
      factura_m: 51,
      nota_debito_m: 52,
      nota_credito_m: 53,
      tique_factura_a: 81,
      tique_factura_b: 82,
      tique: 83,
      tique_factura_c: 111,
      liquidacion: null, // a confirmar con la contadora (J.1, 13)
      resumen_bancario: null,
      otro_comprobante: 99,
      ddjj_impuesto: null,
      sin_comprobante: null,
    })
  })

  it('etiquetas y número', () => {
    expect(voucherLabel('factura_a')).toBe('Factura A')
    expect(voucherLabel('nota_credito_b')).toBe('Nota de crédito B')
    expect(voucherLabel('algo_viejo')).toBe('algo_viejo')
    expect(voucherDisplay('factura_a', 3, 1290)).toBe('Factura A 0003-00001290')
    expect(voucherDisplay('sin_comprobante', null, null)).toBe('Sin comprobante')
  })

  it('DDJJ y «sin comprobante» no van a un libro IVA ni llevan número', () => {
    expect(isFiscalVoucherType('ddjj_impuesto')).toBe(false)
    expect(isFiscalVoucherType('sin_comprobante')).toBe(false)
    expect(VOUCHER_CATALOG.ddjj_impuesto.numbered).toBe(false)
    for (const t of VOUCHER_TYPE_KEYS) {
      if (t !== 'ddjj_impuesto' && t !== 'sin_comprobante')
        expect(isFiscalVoucherType(t), t).toBe(true)
    }
  })

  it('discrimina IVA para quien compra: A, M, tique factura A, liquidación y resumen bancario', () => {
    const yes = VOUCHER_TYPE_KEYS.filter((t) => VOUCHER_CATALOG[t].purchaseVat === 'yes')
    expect(yes.sort()).toEqual(
      [
        'factura_a',
        'nota_debito_a',
        'nota_credito_a',
        'recibo_a',
        'factura_m',
        'nota_debito_m',
        'nota_credito_m',
        'tique_factura_a',
        'liquidacion',
        'resumen_bancario',
      ].sort(),
    )
    expect(VOUCHER_CATALOG.otro_comprobante.purchaseVat).toBe('optional')
    expect(purchaseAllowsVatLines('factura_b')).toBe(false)
    expect(purchaseAllowsVatLines('factura_c')).toBe(false)
    expect(purchaseAllowsVatLines('tique')).toBe(false)
    expect(purchaseAllowsVatLines('factura_a')).toBe(true)
    expect(purchaseAllowsVatLines('otro_comprobante')).toBe(true)
  })
})

describe('matriz de compras por condición del partícipe (E.3)', () => {
  const A = ['factura_a', 'nota_debito_a', 'nota_credito_a', 'recibo_a', 'tique_factura_a'] as const
  const B = ['factura_b', 'nota_debito_b', 'nota_credito_b', 'recibo_b', 'tique_factura_b'] as const
  const C = ['factura_c', 'nota_debito_c', 'nota_credito_c', 'recibo_c', 'tique_factura_c'] as const
  const M = ['factura_m', 'nota_debito_m', 'nota_credito_m'] as const

  function statuses(condition: IvaCondition) {
    const by: Record<'allowed' | 'warn' | 'rejected', VoucherType[]> = {
      allowed: [],
      warn: [],
      rejected: [],
    }
    for (const t of VOUCHER_TYPE_KEYS) by[voucherConditionCheck(t, condition).status].push(t)
    return by
  }

  it('responsable inscripto: A y M (con aviso), C rechazada, B y tiques con aviso', () => {
    const s = statuses('responsable_inscripto')
    expect(s.rejected.sort()).toEqual([...C].sort())
    expect(s.warn.sort()).toEqual([...B, ...M, 'tique', 'sin_comprobante'].sort())
    for (const t of [
      ...A,
      'liquidacion',
      'resumen_bancario',
      'otro_comprobante',
      'ddjj_impuesto',
    ] as const) {
      expect(s.allowed, t).toContain(t)
    }
    for (const t of M)
      expect(voucherConditionCheck(t, 'responsable_inscripto').warnings).toEqual(['voucher_m'])
    for (const t of B) {
      expect(voucherConditionCheck(t, 'responsable_inscripto').warnings).toEqual([
        'voucher_condition',
      ])
    }
    expect(voucherConditionCheck('tique', 'responsable_inscripto').warnings).toEqual([
      'voucher_condition',
    ])
  })

  it('monotributo: C, recibo C, tique factura C, tique y sin comprobante; A, B y M rechazadas', () => {
    const s = statuses('monotributo')
    expect(s.rejected.sort()).toEqual([...A, ...B, ...M].sort())
    expect(s.warn).toEqual([])
    for (const t of [...C, 'tique', 'sin_comprobante'] as const) expect(s.allowed, t).toContain(t)
  })

  it('exento: B, C, tique y sin comprobante; A y M rechazadas', () => {
    const s = statuses('exento')
    expect(s.rejected.sort()).toEqual([...A, ...M].sort())
    for (const t of [...B, ...C, 'tique', 'sin_comprobante'] as const)
      expect(s.allowed, t).toContain(t)
  })

  it('consumidor final, no alcanzado y sin datos: tique, otro y sin comprobante; ninguna letra', () => {
    for (const condition of ['consumidor_final', 'no_alcanzado', 'sin_datos'] as const) {
      const s = statuses(condition)
      expect(s.rejected.sort(), condition).toEqual([...A, ...B, ...C, ...M].sort())
      for (const t of ['tique', 'otro_comprobante', 'sin_comprobante'] as const) {
        expect(s.allowed, `${condition} ${t}`).toContain(t)
      }
    }
  })

  it('la DDJJ no depende de la condición (su regla es el organismo)', () => {
    for (const condition of IVA_CONDITIONS) {
      expect(voucherConditionCheck('ddjj_impuesto', condition).status, condition).toBe('allowed')
    }
  })
})

describe('crédito fiscal computable', () => {
  it('discrimina + partícipe RI + SAS RI', () => {
    expect(isVatComputable('factura_a', 'responsable_inscripto', 'responsable_inscripto')).toBe(
      true,
    )
    expect(
      isVatComputable('tique_factura_a', 'responsable_inscripto', 'responsable_inscripto'),
    ).toBe(true)
    expect(isVatComputable('liquidacion', 'responsable_inscripto', 'responsable_inscripto')).toBe(
      true,
    )
    expect(
      isVatComputable('otro_comprobante', 'responsable_inscripto', 'responsable_inscripto'),
    ).toBe(true)
  })

  it('en cualquier otro caso el IVA va al costo', () => {
    expect(isVatComputable('factura_b', 'responsable_inscripto', 'responsable_inscripto')).toBe(
      false,
    ) // E3b
    expect(isVatComputable('factura_c', 'monotributo', 'responsable_inscripto')).toBe(false) // E3
    expect(isVatComputable('tique', 'responsable_inscripto', 'responsable_inscripto')).toBe(false)
    expect(isVatComputable('factura_a', 'exento', 'responsable_inscripto')).toBe(false)
    expect(isVatComputable('factura_a', 'responsable_inscripto', 'monotributo')).toBe(false)
    expect(isVatComputable('factura_a', 'responsable_inscripto', 'exento')).toBe(false)
  })
})

describe('tipos por documento (espejo de adoc_voucher_kind)', () => {
  it('compras y ND: cualquier comprobante de compra salvo NC', () => {
    for (const kind of ['purchase', 'purchase_debit_note'] as const) {
      expect(isVoucherAllowedForKind(kind, 'factura_a')).toBe(true)
      expect(isVoucherAllowedForKind(kind, 'nota_debito_b')).toBe(true)
      expect(isVoucherAllowedForKind(kind, 'ddjj_impuesto')).toBe(true)
      expect(isVoucherAllowedForKind(kind, 'tique')).toBe(true)
      expect(isVoucherAllowedForKind(kind, 'nota_credito_a')).toBe(false)
      expect(isVoucherAllowedForKind(kind, null)).toBe(false)
    }
  })

  it('NC de proveedor: solo notas de crédito', () => {
    const { types, allowsNull } = voucherTypesForKind('purchase_credit_note')
    expect([...types].sort()).toEqual([
      'nota_credito_a',
      'nota_credito_b',
      'nota_credito_c',
      'nota_credito_m',
    ])
    expect(allowsNull).toBe(false)
  })

  it('gasto de contado: sin comprobante o tique sin comercio', () => {
    expect(voucherTypesForKind('expense').types).toEqual(['sin_comprobante', 'tique'])
    expect(isVoucherAllowedForKind('expense', 'factura_a')).toBe(false)
  })

  it('ventas sueltas, cobranzas y gastos bancarios', () => {
    expect(isVoucherAllowedForKind('sales_invoice', 'factura_a')).toBe(true)
    expect(isVoucherAllowedForKind('sales_invoice', 'factura_c')).toBe(false)
    expect(isVoucherAllowedForKind('sales_credit_note', 'nota_credito_b')).toBe(true)
    expect(isVoucherAllowedForKind('sales_credit_note', 'factura_b')).toBe(false)
    expect(isVoucherAllowedForKind('collection', null)).toBe(true)
    expect(isVoucherAllowedForKind('collection', 'liquidacion')).toBe(true)
    expect(isVoucherAllowedForKind('collection', 'resumen_bancario')).toBe(false)
    expect(isVoucherAllowedForKind('bank_expense', 'resumen_bancario')).toBe(true)
    expect(isVoucherAllowedForKind('bank_expense', null)).toBe(true)
  })

  it('el resto va sin tipo de comprobante', () => {
    const typed = new Set([
      'purchase',
      'purchase_debit_note',
      'purchase_credit_note',
      'expense',
      'sales_invoice',
      'sales_debit_note',
      'sales_credit_note',
      'collection',
      'bank_expense',
    ])
    for (const kind of DOCUMENT_KINDS) {
      if (typed.has(kind)) continue
      expect(isVoucherAllowedForKind(kind, null), kind).toBe(true)
      expect(isVoucherAllowedForKind(kind, 'factura_a'), kind).toBe(false)
    }
  })

  it('filas del cierre del día: A y B, sus NC y ND y los tiques factura', () => {
    for (const t of SALES_CLOSE_VOUCHERS) expect(VOUCHER_CATALOG[t].sales, t).toBe(true)
  })
})

describe('datos para el Libro IVA Digital', () => {
  it('documento de la contraparte', () => {
    expect(afipDocType('cuit')).toBe(80)
    expect(afipDocType('cuil')).toBe(86)
    expect(afipDocType('dni')).toBe(96)
    expect(afipDocType('none')).toBe(99)
    expect(FINAL_CONSUMER).toEqual({
      name: 'Consumidor final',
      docType: 99,
      docNumber: '0',
      ivaCondition: 'consumidor_final',
    })
  })

  it('moneda y cambio', () => {
    expect(AFIP_CURRENCY).toBe('PES')
    expect(AFIP_EXCHANGE_RATE).toBe(1)
  })
})
