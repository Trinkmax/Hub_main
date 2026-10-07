import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
  accountSchema,
  allocateSchema,
  bankExpenseSchema,
  bootstrapSchema,
  bootstrapSchemaAt,
  cashMovementSchema,
  centsInt,
  closeFiscalYearSchema,
  closePeriodSchema,
  collectionSchema,
  cuitField,
  formBool,
  formInt,
  generateIvaSettlementSchema,
  grantAccessSchema,
  isoDay,
  isoMonth,
  isValidCbu,
  MAX_CENTS,
  manualEntrySchema,
  markTreasuryCheckedSchema,
  openingSchema,
  partySchema,
  paymentSchema,
  payrollTemplateSchema,
  posField,
  purchaseCreditNoteSchema,
  purchaseSchema,
  quickExpenseSchema,
  reasonField,
  recurringSchema,
  reopenFiscalYearSchema,
  reopenSchema,
  reverseSchema,
  revokeAccessSchema,
  salesCloseSchema,
  salesInvoiceSchema,
  salesMethodSchema,
  salesPointSchema,
  settingsSchema,
  skipRecurringDueSchema,
  transferSchema,
  treasuryAdjustmentSchema,
  treasurySchema,
  unallocateSchema,
  undoDocumentSchema,
  voidDocumentSchema,
  voucherNumberField,
  walletCheckSchema,
} from '@/lib/accounting/schemas'
import { fixedUuid, makeCuit } from './accounting-core-context'

const U1 = fixedUuid(1)
const U2 = fixedUuid(2)
const U3 = fixedUuid(3)
const HASH = 'a'.repeat(64)
const META = { clientRef: fixedUuid(900), previewHash: HASH }
const CUIT_RI = makeCuit('30', '86091390')

/** Los mensajes de los issues, en orden. */
function messages(schema: z.ZodType, value: unknown): string[] {
  const r = schema.safeParse(value)
  return r.success ? [] : r.error.issues.map((i) => i.message)
}

/** El mensaje del issue en esa ruta (`'lines.0.vatRateBp'`), o `undefined`. */
function messageAt(schema: z.ZodType, value: unknown, path: string): string | undefined {
  const r = schema.safeParse(value)
  if (r.success) return undefined
  return r.error.issues.find((i) => i.path.join('.') === path)?.message
}

function ok<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value)
  if (!r.success) throw new Error(JSON.stringify(r.error.issues, null, 2))
  return r.data
}

describe('campos base', () => {
  it('centsInt: centavos enteros > 0 hasta $ 9.999.999.999,99', () => {
    expect(ok(centsInt(), 1)).toBe(1)
    expect(ok(centsInt(), MAX_CENTS)).toBe(999_999_999_999)
    expect(messages(centsInt(), 0)).toEqual(['Tiene que ser mayor a cero.'])
    expect(ok(centsInt({ allowZero: true }), 0)).toBe(0)
    expect(messages(centsInt({ allowZero: true }), -1)).toEqual(['El importe va sin signo menos.'])
    expect(messages(centsInt(), 1.5)).toEqual(['El importe tiene que estar en centavos enteros.'])
    expect(messages(centsInt(), MAX_CENTS + 1)).toEqual([
      'Ese importe es demasiado grande. Revisalo.',
    ])
    expect(messages(centsInt(), undefined)).toEqual(['Falta el importe.'])
    expect(messages(centsInt(), '1234')).toEqual(['Falta el importe.'])
    expect(messages(centsInt(), Number.NaN)).toEqual(['Falta el importe.'])
  })

  it('isoDay: fechas reales', () => {
    expect(ok(isoDay, '2026-10-06')).toBe('2026-10-06')
    expect(messages(isoDay, '2026-02-31')).toEqual(['Esa fecha no existe.'])
    expect(messages(isoDay, '06/10/2026')).toEqual(['Elegí una fecha.'])
    expect(messages(isoDay, undefined)).toEqual(['Elegí una fecha.'])
  })

  it('isoMonth normaliza al primer día', () => {
    expect(ok(isoMonth, '2026-09')).toBe('2026-09-01')
    expect(ok(isoMonth, '2026-09-30')).toBe('2026-09-01')
    expect(messages(isoMonth, '2026-13')).toEqual(['Ese mes no existe.'])
    expect(messages(isoMonth, 'septiembre')).toEqual(['Elegí un mes.'])
  })

  it('CUIT con dígito verificador', () => {
    expect(ok(cuitField, CUIT_RI)).toBe(CUIT_RI)
    expect(
      ok(cuitField, `${CUIT_RI.slice(0, 2)}-${CUIT_RI.slice(2, 10)}-${CUIT_RI.slice(10)}`),
    ).toBe(CUIT_RI)
    const wrong = `${CUIT_RI.slice(0, 10)}${(Number(CUIT_RI[10]) + 1) % 10}`
    expect(messages(cuitField, wrong)).toEqual(['El CUIT no es válido: revisá el último número.'])
    expect(messages(cuitField, '')).toEqual(['Falta el CUIT.'])
  })

  it('punto de venta y número', () => {
    expect(ok(posField, 0)).toBe(0)
    expect(ok(posField, 99_999)).toBe(99_999)
    expect(messages(posField, 100_000)).toEqual(['Revisá el punto de venta.'])
    expect(messages(voucherNumberField, 0)).toEqual(['Revisá el número.'])
    expect(ok(voucherNumberField, 99_999_999)).toBe(99_999_999)
    expect(messages(voucherNumberField, 100_000_000)).toEqual(['Revisá el número.'])
  })

  it('motivo de 5 a 300 caracteres', () => {
    expect(ok(reasonField, '  error de carga  ')).toBe('error de carga')
    expect(messages(reasonField, 'nop')).toEqual([
      'Contá brevemente el motivo (al menos 5 letras).',
    ])
    expect(messages(reasonField, 'x'.repeat(301))).toEqual([
      'El motivo puede tener hasta 300 caracteres.',
    ])
  })

  it('formInt: número u texto de FormData, sin convertir el vacío en cero', () => {
    const required = formInt({ min: 1, max: 28, message: 'El vencimiento va del 1 al 28.' })
    expect(ok(required, '20')).toBe(20)
    expect(ok(required, 20)).toBe(20)
    expect(messages(required, '')).toEqual(['El vencimiento va del 1 al 28.'])
    expect(messages(required, '29')).toEqual(['El vencimiento va del 1 al 28.'])
    expect(messages(required, '2,5')).toEqual(['El vencimiento va del 1 al 28.'])
    const optional = formInt({ min: 0, max: 100, message: 'Revisá.', optional: true })
    expect(ok(optional, '')).toBeNull()
    expect(ok(optional, '0')).toBe(0)
  })

  it('formBool: tildes de FormData', () => {
    expect(ok(formBool, 'on')).toBe(true)
    expect(ok(formBool, 'true')).toBe(true)
    expect(ok(formBool, undefined)).toBe(false)
    expect(ok(formBool, 'false')).toBe(false)
    expect(ok(formBool, true)).toBe(true)
  })

  it('CBU/CVU con sus dos verificadores', () => {
    expect(isValidCbu('2850590940090418135201')).toBe(true)
    expect(isValidCbu('2850590-940090418135201')).toBe(true)
    expect(isValidCbu('2850590940090418135202')).toBe(false)
    expect(isValidCbu('2850590840090418135201')).toBe(false)
    expect(isValidCbu('123')).toBe(false)
  })
})

describe('quickExpenseSchema (Nuevo gasto, G.2)', () => {
  const base = {
    ...META,
    amountCents: 360_000,
    target: { type: 'account', accountId: U1 },
    treasuryAccountId: U2,
    voucher: 'none',
    date: '2026-10-06',
  }

  it('sin comprobante: lo mínimo, con defaults', () => {
    const v = ok(quickExpenseSchema, base)
    expect(v.vatRateBp).toBe(2100)
    expect(v.vatAdjustCents).toBe(0)
    expect(v.warningsAck).toEqual([])
    expect(v.newParty).toBeNull()
    expect(v.detail).toBeNull()
  })

  it('con factura hace falta el proveedor y el número', () => {
    expect(messageAt(quickExpenseSchema, { ...base, voucher: 'a' }, 'target')).toBe(
      'Elegí el proveedor de la factura.',
    )
    expect(
      messageAt(
        quickExpenseSchema,
        { ...base, voucher: 'a', target: { type: 'party', partyId: U3, accountId: U1 } },
        'number',
      ),
    ).toBe('Con factura, cargá el punto de venta y el número.')
    ok(quickExpenseSchema, {
      ...base,
      voucher: 'a',
      target: { type: 'party', partyId: U3, accountId: U1 },
      pointOfSale: 3,
      number: 1290,
    })
  })

  it('proveedor nuevo con factura: el CUIT es obligatorio', () => {
    const withNew = {
      ...base,
      voucher: 'bc',
      newParty: { name: 'Verdulería López', ivaCondition: 'monotributo' },
      pointOfSale: 2,
      number: 33,
    }
    expect(messageAt(quickExpenseSchema, withNew, 'newParty.taxId')).toBe(
      'Con factura, cargá el CUIT del proveedor.',
    )
    const v = ok(quickExpenseSchema, {
      ...withNew,
      newParty: { ...withNew.newParty, taxId: CUIT_RI },
    })
    expect(v.newParty?.kind).toBe('supplier')
  })

  it('el ajuste silencioso del IVA es de hasta ±1 peso', () => {
    expect(messageAt(quickExpenseSchema, { ...base, vatAdjustCents: 101 }, 'vatAdjustCents')).toBe(
      'El ajuste va hasta $ 1.',
    )
  })

  it('avisos aceptados: solo claves conocidas', () => {
    expect(
      ok(quickExpenseSchema, { ...base, warningsAck: ['treasury_negative'] }).warningsAck,
    ).toEqual(['treasury_negative'])
    expect(messageAt(quickExpenseSchema, { ...base, warningsAck: ['nada'] }, 'warningsAck.0')).toBe(
      'Aviso desconocido. Recargá la página.',
    )
  })

  it('previewHash y clientRef obligatorios', () => {
    expect(messageAt(quickExpenseSchema, { ...base, previewHash: 'abc' }, 'previewHash')).toBe(
      'Falta la vista previa. Recargá la página.',
    )
    expect(messageAt(quickExpenseSchema, { ...base, clientRef: 'x' }, 'clientRef')).toBe(
      'Falta la referencia del formulario. Recargá la página.',
    )
  })
})

describe('purchaseSchema (comprobante de compra)', () => {
  const e1 = {
    ...META,
    partyId: U1,
    voucherType: 'factura_a',
    pointOfSale: 3,
    number: 1290,
    issueDate: '2026-10-03',
    dueDate: '2026-10-24',
    lines: [{ role: 'net', accountId: U2, amountCents: 71_074_380, vatRateBp: 2100 }],
  }

  it('E1 en detalle', () => {
    const v = ok(purchaseSchema, e1)
    expect(v.docKind).toBe('purchase')
    expect(v.amountMode).toBe('detail')
    expect(v.lines[0]?.vatRateBp).toBe(2100)
  })

  it('E1 desde el total', () => {
    ok(purchaseSchema, {
      ...e1,
      lines: [],
      amountMode: 'total',
      total: { totalCents: 86_000_000, vatRateBp: 2100, accountId: U2 },
    })
    expect(
      messageAt(
        purchaseSchema,
        { ...e1, lines: [], amountMode: 'total', total: null },
        'total.totalCents',
      ),
    ).toBe('Falta el total de la factura.')
  })

  it('una B o C no discrimina IVA', () => {
    expect(messageAt(purchaseSchema, { ...e1, voucherType: 'factura_b' }, 'lines')).toBe(
      'Las facturas B y C no discriminan IVA: cargá solo el total.',
    )
    ok(purchaseSchema, {
      ...e1,
      voucherType: 'factura_c',
      lines: [{ role: 'gross', accountId: U2, amountCents: 4_500_000 }],
    })
  })

  it('el neto lleva alícuota y el resto no', () => {
    expect(
      messageAt(
        purchaseSchema,
        { ...e1, lines: [{ role: 'net', accountId: U2, amountCents: 100 }] },
        'lines.0.vatRateBp',
      ),
    ).toBe('Elegí la alícuota.')
    expect(
      messageAt(
        purchaseSchema,
        { ...e1, lines: [{ role: 'gross', accountId: U2, amountCents: 100, vatRateBp: 2100 }] },
        'lines.0.vatRateBp',
      ),
    ).toBe('Solo el neto gravado lleva alícuota.')
  })

  it('proveedor: uno existente o uno nuevo, no los dos ni ninguno', () => {
    expect(messageAt(purchaseSchema, { ...e1, partyId: null }, 'partyId')).toBe(
      'Elegí el proveedor.',
    )
    expect(
      messageAt(purchaseSchema, { ...e1, newParty: { name: 'Otro', taxId: CUIT_RI } }, 'partyId'),
    ).toBe('Elegí el proveedor.')
  })

  it('número obligatorio salvo DDJJ y sin comprobante', () => {
    expect(messageAt(purchaseSchema, { ...e1, number: null }, 'number')).toBe(
      'Cargá el punto de venta y el número.',
    )
    ok(purchaseSchema, {
      ...e1,
      voucherType: 'ddjj_impuesto',
      pointOfSale: null,
      number: null,
      lines: [{ role: 'gross', accountId: U2, amountCents: 380_000_000 }],
      controlAccountId: U3,
    })
  })

  it('percepción de IIBB con jurisdicción', () => {
    expect(
      messageAt(
        purchaseSchema,
        { ...e1, perceptions: [{ taxKind: 'iibb', amountCents: 400_000 }] },
        'perceptions.0.jurisdictionCode',
      ),
    ).toBe('Elegí la jurisdicción.')
    ok(purchaseSchema, {
      ...e1,
      perceptions: [{ taxKind: 'iibb', amountCents: 400_000, jurisdictionCode: 904 }],
    })
  })

  it('NC: el tipo tiene que ser una nota de crédito y no se paga', () => {
    expect(
      messageAt(purchaseSchema, { ...e1, docKind: 'purchase_credit_note' }, 'voucherType'),
    ).toBe('Ese tipo de comprobante no corresponde acá.')
    const nc = {
      ...e1,
      docKind: 'purchase_credit_note',
      voucherType: 'nota_credito_a',
      relatedDocumentId: U3,
    }
    ok(purchaseCreditNoteSchema, nc)
    expect(messageAt(purchaseSchema, { ...nc, payNow: { treasuryAccountId: U3 } }, 'payNow')).toBe(
      'Una nota de crédito no se paga.',
    )
    expect(messageAt(purchaseCreditNoteSchema, e1, 'docKind')).toBe('Elegí una nota de crédito.')
  })

  it('fechas coherentes', () => {
    expect(messageAt(purchaseSchema, { ...e1, dueDate: '2026-10-01' }, 'dueDate')).toBe(
      'El vencimiento no puede ser anterior a la fecha del comprobante.',
    )
    expect(
      messageAt(purchaseSchema, { ...e1, accountingDate: '2026-10-02' }, 'accountingDate'),
    ).toBe('La fecha contable no puede ser anterior a la fecha del comprobante.')
  })
})

describe('paymentSchema (Pagar)', () => {
  const base = {
    ...META,
    partyId: U1,
    date: '2026-10-20',
    applications: [{ lineId: U2, amountCents: 50_000_000 }],
    methods: [{ type: 'treasury', treasuryAccountId: U3, amountCents: 50_000_000 }],
  }

  it('E7: aplicaciones y medios', () => {
    expect(ok(paymentSchema, base).writeOffCents).toBe(0)
  })

  it('sin medios ni diferencia no hay pago', () => {
    expect(messageAt(paymentSchema, { ...base, methods: [] }, 'methods')).toBe(
      'Elegí con qué pagás.',
    )
  })

  it('saldos a favor sin comprobante que cancelen', () => {
    expect(
      messageAt(
        paymentSchema,
        { ...base, applications: [], creditsUsed: [{ lineId: U3, amountCents: 1 }] },
        'creditsUsed',
      ),
    ).toBe('Para usar un saldo a favor, elegí qué comprobante cancela.')
  })

  it('la diferencia que se da por cancelada: hasta $ 1.000', () => {
    expect(messageAt(paymentSchema, { ...base, writeOffCents: 100_001 }, 'writeOffCents')).toBe(
      'Hasta $ 1.000 se puede dar por cancelado.',
    )
    ok(paymentSchema, { ...base, writeOffCents: 300 })
  })

  it('compensación con un saldo de impuestos', () => {
    ok(paymentSchema, {
      ...base,
      methods: [{ type: 'compensation', accountId: U3, amountCents: 50_000_000 }],
    })
  })
})

describe('salesCloseSchema (Cierre del día)', () => {
  const base = {
    ...META,
    date: '2026-10-05',
    methods: [
      { salesMethodId: U1, amountCents: 35_000_000 },
      { salesMethodId: U2, amountCents: 0 },
    ],
    invoiced: [
      {
        voucherType: 'factura_b',
        pointOfSale: 3,
        numberFrom: 14_501,
        numberTo: 14_662,
        channel: 'salon',
        totalCents: 121_000_000,
      },
    ],
  }

  it('E8 en forma', () => {
    const v = ok(salesCloseSchema, base)
    expect(v.invoiced[0]?.vatRateBp).toBe(2100)
    expect(v.cashCountedCents).toBeNull()
  })

  it('rango con «hasta» menor que «desde»', () => {
    const bad = { ...base, invoiced: [{ ...base.invoiced[0], numberTo: 14_500 }] }
    expect(messageAt(salesCloseSchema, bad, 'invoiced.0.numberTo')).toBe(
      'El «hasta» no puede ser menor que el «desde».',
    )
  })

  it('una factura A necesita el cliente', () => {
    const a = {
      ...base,
      invoiced: [{ ...base.invoiced[0], voucherType: 'factura_a', numberTo: 14_501 }],
    }
    expect(messageAt(salesCloseSchema, a, 'invoiced.0.partyId')).toBe(
      'Una factura A necesita el cliente con su CUIT.',
    )
  })

  it('facturado de más con aviso aceptado: hace falta el motivo', () => {
    const acked = { ...base, warningsAck: ['invoiced_exceeds_sold'] }
    expect(messageAt(salesCloseSchema, acked, 'overrideReason')).toBe(
      'Contá brevemente el motivo (al menos 5 letras).',
    )
    ok(salesCloseSchema, { ...acked, overrideReason: 'Factura de una venta del domingo' })
  })

  it('el efectivo contado no puede ser negativo', () => {
    expect(messageAt(salesCloseSchema, { ...base, cashCountedCents: -1 }, 'cashCountedCents')).toBe(
      'El efectivo contado no puede ser negativo.',
    )
    expect(ok(salesCloseSchema, { ...base, cashCountedCents: 34_950_000 }).cashCountedCents).toBe(
      34_950_000,
    )
  })

  it('sin ventas no hay cierre; medios repetidos; cuenta corriente que no suma', () => {
    expect(
      messageAt(
        salesCloseSchema,
        { ...base, methods: [{ salesMethodId: U1, amountCents: 0 }] },
        'methods',
      ),
    ).toBe('Cargá al menos un medio con ventas.')
    expect(
      messageAt(
        salesCloseSchema,
        { ...base, methods: [base.methods[0], { salesMethodId: U1, amountCents: 1 }] },
        'methods',
      ),
    ).toBe('Ese medio de cobro está dos veces.')
    const cc = {
      ...base,
      methods: [
        {
          salesMethodId: U3,
          amountCents: 12_100_000,
          customers: [{ partyId: U1, amountCents: 12_000_000 }],
        },
      ],
    }
    expect(messageAt(salesCloseSchema, cc, 'methods.0.customers')).toBe(
      'Lo de cada cliente tiene que sumar el total de la cuenta corriente.',
    )
  })
})

describe('collectionSchema y walletCheckSchema', () => {
  const e9 = {
    ...META,
    partyId: U1,
    date: '2026-10-15',
    applications: [{ lineId: U2, amountCents: 33_000_000 }],
    grossCents: 33_000_000,
    received: [{ treasuryAccountId: U3, amountCents: 31_555_260 }],
    deductions: [
      { taxKind: 'comision', amountCents: 594_000 },
      { taxKind: 'iva_comision', amountCents: 124_740 },
      { taxKind: 'ret_iibb', amountCents: 396_000 },
      { taxKind: 'ret_ganancias', amountCents: 330_000, certificateNumber: '0001-00004567' },
    ],
    commissionVoucher: {
      mode: 'included',
      voucherType: 'liquidacion',
      pointOfSale: 0,
      number: 4512,
      issueDate: '2026-10-15',
    },
  }

  it('E9: bruto = recibido + descuentos', () => {
    ok(collectionSchema, e9)
    expect(messageAt(collectionSchema, { ...e9, grossCents: 33_000_001 }, 'grossCents')).toBe(
      'Lo que entró más los descuentos suma $ 330.000,00, no el bruto liquidado.',
    )
  })

  it('la retención de Ganancias lleva certificado', () => {
    const deductions = e9.deductions.map((d) =>
      d.taxKind === 'ret_ganancias' ? { ...d, certificateNumber: '' } : d,
    )
    expect(
      messageAt(collectionSchema, { ...e9, deductions }, 'deductions.3.certificateNumber'),
    ).toBe('Cargá el número de certificado de la retención.')
  })

  it('E10b: neto negativo sin lo recibido (le debemos a la plataforma)', () => {
    ok(collectionSchema, {
      ...META,
      partyId: U1,
      date: '2026-10-20',
      applications: [{ lineId: U2, amountCents: 10_000_000 }],
      deductions: [
        { taxKind: 'comision', amountCents: 18_000_000 },
        { taxKind: 'iva_comision', amountCents: 3_780_000 },
      ],
      commissionVoucher: { mode: 'later' },
    })
  })

  it('no se aplica más de lo cobrado', () => {
    expect(
      messageAt(
        collectionSchema,
        { ...e9, applications: [{ lineId: U2, amountCents: 40_000_000 }], grossCents: null },
        'applications',
      ),
    ).toBe('Estás aplicando más de lo que se cobró. Revisá los importes.')
  })

  it('E17: saldo de la app con signo y partidas', () => {
    ok(walletCheckSchema, {
      ...META,
      treasuryAccountId: U1,
      date: '2026-10-12',
      countedCents: 88_200_000,
      expectedBookCents: 50_000_000,
      items: [
        { lineId: U2, amountCents: 18_000_000 },
        { lineId: U3, amountCents: 22_000_000 },
      ],
      breakdown: [{ taxKind: 'diferencia', amountCents: 700 }],
    })
    expect(
      messageAt(
        walletCheckSchema,
        {
          ...META,
          treasuryAccountId: U1,
          date: '2026-10-12',
          countedCents: 5,
          expectedBookCents: 5,
        },
        'countedCents',
      ),
    ).toBe('No hay diferencia ni partidas para acreditar.')
  })
})

describe('venta suelta, cajas y asientos', () => {
  it('salesInvoiceSchema: E16 y la NC', () => {
    const e16 = {
      ...META,
      partyId: U1,
      voucherType: 'factura_a',
      pointOfSale: 3,
      number: 88,
      issueDate: '2026-10-20',
      aliquots: [{ vatRateBp: 2100, netCents: 60_000_000 }],
    }
    expect(ok(salesInvoiceSchema, e16).channel).toBe('events')
    expect(
      messageAt(salesInvoiceSchema, { ...e16, docKind: 'sales_credit_note' }, 'voucherType'),
    ).toBe('Ese tipo de comprobante no corresponde acá.')
    expect(messageAt(salesInvoiceSchema, { ...e16, aliquots: [] }, 'aliquots')).toBe(
      'Cargá al menos un importe.',
    )
  })

  it('transferSchema: dos cuentas distintas', () => {
    const t = {
      ...META,
      fromTreasuryId: U1,
      toTreasuryId: U1,
      amountCents: 50_000_000,
      date: '2026-10-10',
    }
    expect(messageAt(transferSchema, t, 'toTreasuryId')).toBe('Elegí dos cuentas distintas.')
    ok(transferSchema, { ...t, toTreasuryId: U2 })
  })

  it('bankExpenseSchema: E12 y el libro IVA con comprobante', () => {
    const e12 = {
      ...META,
      treasuryAccountId: U1,
      date: '2026-10-31',
      feesNetCents: 800_000,
      ley25413CreditCents: 180_000,
      ley25413DebitCents: 120_000,
      sircrebCents: 250_000,
    }
    ok(bankExpenseSchema, e12)
    expect(messageAt(bankExpenseSchema, { ...e12, includeInIvaBook: true }, 'voucher')).toBe(
      'Para que entre al Libro IVA, cargá el comprobante del banco.',
    )
    expect(
      messageAt(
        bankExpenseSchema,
        { ...META, treasuryAccountId: U1, date: '2026-10-31' },
        'feesNetCents',
      ),
    ).toBe('Cargá al menos un importe.')
  })

  it('cashMovementSchema: E21', () => {
    const v = ok(cashMovementSchema, {
      ...META,
      treasuryAccountId: U1,
      direction: 'out',
      counterpartAccountId: U2,
      partyId: U3,
      amountCents: 10_000_000,
      date: '2026-10-21',
      shortcut: 'partner_withdrawal',
    })
    expect(v.detail).toBeNull()
  })

  it('treasuryAdjustmentSchema y markTreasuryCheckedSchema', () => {
    const e18 = {
      ...META,
      treasuryAccountId: U1,
      date: '2026-10-31',
      countedCents: 45_000_000,
      expectedBookCents: 45_230_000,
    }
    ok(treasuryAdjustmentSchema, e18)
    expect(
      messageAt(treasuryAdjustmentSchema, { ...e18, countedCents: 45_230_000 }, 'countedCents'),
    ).toBe('No hay diferencia: marcala como ajustada sin cargar nada.')
    expect(
      messageAt(
        treasuryAdjustmentSchema,
        { ...e18, splits: [{ accountId: U2, amountCents: 1 }] },
        'splits',
      ),
    ).toBe('El reparto tiene que sumar la diferencia.')
    // Un banco puede estar en negativo.
    ok(markTreasuryCheckedSchema, {
      treasuryAccountId: U1,
      countedCents: -500,
      expectedBookCents: -500,
      asOf: '2026-10-31',
    })
    expect(
      messageAt(
        markTreasuryCheckedSchema,
        { treasuryAccountId: U1, countedCents: 1, expectedBookCents: 2, asOf: '2026-10-31' },
        'countedCents',
      ),
    ).toBe('Hay diferencia: registrala con «Ajustar saldo».')
  })

  it('manualEntrySchema: dos líneas, un lado por línea, cuadra', () => {
    const e13 = {
      ...META,
      entryKind: 'payroll',
      date: '2026-10-31',
      description: 'Sueldos de octubre',
      lines: [
        { accountId: U1, debitCents: 450_000_000 },
        { accountId: U2, debitCents: 108_000_000 },
        { accountId: U3, creditCents: 373_500_000, partyId: U1, dueDate: '2026-11-05' },
        { accountId: U3, creditCents: 184_500_000, partyId: U2 },
      ],
    }
    ok(manualEntrySchema, e13)
    expect(messageAt(manualEntrySchema, { ...e13, lines: [e13.lines[0]] }, 'lines')).toBe(
      'Un asiento necesita al menos dos líneas.',
    )
    const unbalanced = { ...e13, lines: e13.lines.slice(0, 3) }
    expect(messageAt(manualEntrySchema, unbalanced, 'lines')).toBe(
      'El asiento no cuadra: falta $ 1.845.000,00 en el Haber.',
    )
    expect(
      messageAt(
        manualEntrySchema,
        { ...e13, lines: [{ accountId: U1, debitCents: 1, creditCents: 1 }, e13.lines[1]] },
        'lines.0.creditCents',
      ),
    ).toBe('Cada línea va en el Debe o en el Haber, no en los dos.')
    expect(
      messageAt(
        manualEntrySchema,
        { ...e13, lines: [{ accountId: U1, debitCents: 1, dueDate: '2026-11-01' }, e13.lines[1]] },
        'lines.0.dueDate',
      ),
    ).toBe('El vencimiento va solo con un partícipe.')
  })

  it('payrollTemplateSchema: E13', () => {
    ok(payrollTemplateSchema, {
      grossSalariesCents: 450_000_000,
      employerContributionsCents: 108_000_000,
      withheldContributionsCents: 76_500_000,
      date: '2026-10-31',
    })
    expect(
      messageAt(
        payrollTemplateSchema,
        {
          grossSalariesCents: 100,
          employerContributionsCents: 0,
          withheldContributionsCents: 101,
          date: '2026-10-31',
        },
        'withheldContributionsCents',
      ),
    ).toBe('Los aportes no pueden superar los sueldos brutos.')
  })

  it('openingSchema: E14 y «Arrancar en cero» es otra acción', () => {
    ok(openingSchema, {
      ...META,
      treasuries: [{ treasuryAccountId: U1, balanceCents: 15_000_000 }],
      payables: [
        {
          partyId: U2,
          amountCents: 38_000_000,
          dueDate: '2026-10-21',
          reference: 'Factura A 0003-00001234',
        },
      ],
      shareCapitalCents: 100_000_000,
    })
    expect(messageAt(openingSchema, { ...META }, 'treasuries')).toBe(
      'Cargá al menos un saldo o elegí «Arrancar en cero».',
    )
  })
})

describe('correcciones, períodos y accesos', () => {
  it('anular, deshacer, anular con fecha de hoy, imputar y desimputar', () => {
    expect(ok(voidDocumentSchema, { documentId: U1, reason: 'Cargada dos veces' }).withBundle).toBe(
      false,
    )
    ok(undoDocumentSchema, { documentId: U1 })
    expect(
      messageAt(
        reverseSchema,
        { clientRef: U2, documentId: U1, reason: 'mal', reversalDate: '2026-11-12' },
        'reason',
      ),
    ).toBe('Contá brevemente el motivo (al menos 5 letras).')
    expect(
      messageAt(
        allocateSchema,
        { pairs: [{ debitLineId: U1, creditLineId: U1, amountCents: 1 }], date: '2026-10-20' },
        'pairs.0.creditLineId',
      ),
    ).toBe('Elegí dos comprobantes distintos.')
    expect(messageAt(allocateSchema, { pairs: [], date: '2026-10-20' }, 'pairs')).toBe(
      'Elegí qué imputar.',
    )
    ok(unallocateSchema, { allocationId: U1, reason: 'Se aplicó a otra factura' })
  })

  it('cerrar, reabrir y liquidar el IVA', () => {
    const v = ok(closePeriodSchema, { month: '2026-10', warningsAck: ['missing_daily_closes'] })
    expect(v.month).toBe('2026-10-01')
    expect(v.ivaSettlement).toEqual({ generate: true, expected: null })
    expect(
      messageAt(
        closePeriodSchema,
        { month: '2026-10', warningsAck: ['vat_diff'] },
        'warningsAck.0',
      ),
    ).toBe('Aviso desconocido. Recargá la página.')
    ok(reopenSchema, { month: '2026-10-01', reason: 'Faltaba una factura' })
    ok(generateIvaSettlementSchema, {
      month: '2026-10',
      expected: {
        debitCents: 131_040_000,
        creditCents: 41_000_000,
        perceptionsCents: 600_000,
        withholdingsCents: 300_000,
        toPayCents: 89_140_000,
        technicalBalanceNewCents: 0,
        freeBalanceNewCents: 0,
      },
    })
    ok(closeFiscalYearSchema, {
      fiscalYearId: U1,
      expected: { resultCents: -32_090_865, balanceSheetAccounts: 12 },
    })
    ok(reopenFiscalYearSchema, { fiscalYearId: U1, reason: 'Ajuste de la contadora' })
  })

  it('dar y quitar accesos', () => {
    expect(ok(grantAccessSchema, { userId: U1, isAdmin: 'on' })).toEqual({
      userId: U1,
      isAdmin: true,
      displayName: null,
    })
    expect(ok(revokeAccessSchema, { userId: U1 }).reason).toBeNull()
  })
})

describe('Ajustes (FormData)', () => {
  const settings = {
    expectedUpdatedAt: '2026-10-06T21:10:00.123456+00:00',
    legalName: 'HUB SAS',
    cuit: '',
    ivaCondition: 'responsable_inscripto',
    iibbRegime: 'local',
    iibbJurisdictionCode: '904',
    booksStartDate: '2026-10-01',
    fiscalYearEndMonth: '12',
    ivaSettlementMode: 'on_close',
    ivaDueDay: '20',
    iibbDueDay: '15',
    vatToleranceCents: '1',
    bankTaxCreditComputableBp: '3300',
    bankTaxDebitComputableBp: '3300',
    uninvoicedSalesMode: 'separate_accounts',
    closedPeriodVoidIvaMode: 'adjustment_only',
    dueSoonDays: '7',
  }

  it('settingsSchema lee los textos de FormData', () => {
    const v = ok(settingsSchema, settings)
    expect(v.iibbJurisdictionCode).toBe(904)
    expect(v.cuit).toBeNull()
    expect(v.bankTaxCreditComputableBp).toBe(3300)
    expect(messageAt(settingsSchema, { ...settings, ivaDueDay: '31' }, 'ivaDueDay')).toBe(
      'El vencimiento va del 1 al 28.',
    )
    expect(messageAt(settingsSchema, { ...settings, cuit: '30-71876543-6' }, 'cuit')).toBe(
      'El CUIT no es válido: revisá el último número.',
    )
    expect(
      messageAt(settingsSchema, { ...settings, activityStartDate: '2026-11-01' }, 'booksStartDate'),
    ).toBe('Los libros no pueden arrancar antes del inicio de actividades.')
  })

  it('accountSchema: alta y edición', () => {
    const created = ok(accountSchema, {
      mode: 'create',
      parentId: U1,
      name: 'Fumigación',
      postable: 'on',
    })
    expect(created).toMatchObject({
      mode: 'create',
      code: null,
      postable: true,
      manualSelectable: true,
    })
    expect(
      messageAt(
        accountSchema,
        { mode: 'create', parentId: U1, name: 'X', code: '5.3.02.12' },
        'name',
      ),
    ).toBe('Escribí el nombre de la cuenta.')
    expect(
      messageAt(
        accountSchema,
        { mode: 'create', parentId: U1, name: 'Fumigación', code: '5.3.a' },
        'code',
      ),
    ).toBe('El código va con números y puntos (por ejemplo, 5.3.02.12).')
    ok(accountSchema, {
      mode: 'update',
      id: U1,
      expectedUpdatedAt: settings.expectedUpdatedAt,
      name: 'Limpieza',
    })
  })

  it('partySchema: el número según el tipo de documento', () => {
    const base = { kind: 'supplier', name: 'Coca-Cola (distribuidor)' }
    expect(
      ok(partySchema, {
        ...base,
        taxIdType: 'cuit',
        taxId: `${CUIT_RI.slice(0, 2)}-${CUIT_RI.slice(2, 10)}-${CUIT_RI.slice(10)}`,
      }).taxId,
    ).toBe(CUIT_RI)
    expect(messageAt(partySchema, { ...base, taxIdType: 'cuit', taxId: '30123' }, 'taxId')).toBe(
      'El CUIT no es válido: revisá el último número.',
    )
    expect(messageAt(partySchema, { ...base, taxIdType: 'dni', taxId: '123' }, 'taxId')).toBe(
      'El DNI tiene 7 u 8 números.',
    )
    expect(
      messageAt(partySchema, { ...base, taxIdType: 'none', taxId: '20123456786' }, 'taxIdType'),
    ).toBe('Elegí si es CUIT, CUIL o DNI.')
    const v = ok(partySchema, { ...base, paymentTermDays: '21', commissionBp: '', active: 'on' })
    expect(v).toMatchObject({
      paymentTermDays: 21,
      commissionBp: null,
      active: true,
      taxIdType: 'none',
      taxId: null,
    })
    expect(messageAt(partySchema, { ...base, email: 'no-es-email' }, 'email')).toBe(
      'Revisá el email.',
    )
  })

  it('treasurySchema: CBU, alias y tildes', () => {
    const v = ok(treasurySchema, {
      name: 'Banco Nación · cuenta corriente',
      kind: 'bank',
      cbuCvu: '2850590940090418135201',
      alias: 'hub.sas.mp',
      allowNegative: 'on',
    })
    expect(v).toMatchObject({ allowNegative: true, createBankParty: false, active: true })
    expect(
      messageAt(
        treasurySchema,
        { name: 'Banco', kind: 'bank', cbuCvu: '2850590940090418135202' },
        'cbuCvu',
      ),
    ).toBe('El CBU no es válido: revisá los números.')
    expect(messageAt(treasurySchema, { name: 'Banco', kind: 'bank', alias: 'ab' }, 'alias')).toBe(
      'El alias va de 6 a 20 letras, números, puntos o guiones.',
    )
  })

  it('salesMethodSchema: cada tipo va a una caja, a un partícipe o a los dos', () => {
    ok(salesMethodSchema, {
      name: 'Efectivo',
      kind: 'treasury',
      channel: 'salon',
      treasuryAccountId: U1,
    })
    ok(salesMethodSchema, {
      name: 'QR',
      kind: 'settled_now',
      channel: 'salon',
      treasuryAccountId: U1,
      partyId: U2,
    })
    ok(salesMethodSchema, {
      name: 'Débito',
      kind: 'receivable',
      channel: 'salon',
      partyId: U2,
      settlementDays: '1',
    })
    expect(
      messageAt(
        salesMethodSchema,
        { name: 'Débito', kind: 'receivable', channel: 'salon' },
        'partyId',
      ),
    ).toBe('Revisá adónde va este medio de cobro.')
    expect(
      messageAt(
        salesMethodSchema,
        { name: 'Efectivo', kind: 'treasury', channel: 'salon' },
        'treasuryAccountId',
      ),
    ).toBe('Revisá adónde va este medio de cobro.')
  })

  it('salesPointSchema y recurringSchema (monto en el hidden de MoneyField)', () => {
    expect(
      ok(salesPointSchema, { number: '3', label: 'Salón', defaultChannel: 'salon' }).number,
    ).toBe(3)
    const r = {
      name: 'Alquiler',
      accountId: U1,
      frequency: 'monthly',
      dueDay: '10',
      nextDueDate: '2026-11-10',
    }
    expect(ok(recurringSchema, { ...r, amountCents: '' }).amountCents).toBeNull()
    expect(ok(recurringSchema, { ...r, amountCents: '45000000' })).toMatchObject({
      amountCents: 45_000_000,
      remindDaysBefore: 5,
    })
    expect(messages(recurringSchema, { ...r, amountCents: '0' }).length).toBeGreaterThan(0)
    expect(ok(recurringSchema, { ...r, vatRateBp: '2700' }).vatRateBp).toBe(2700)
    ok(skipRecurringDueSchema, { id: U1, dueDate: '2026-11-10' })
  })
})

describe('bootstrapSchema (asistente)', () => {
  const payload = {
    displayName: 'Franco',
    settings: { legalName: 'HUB SAS', cuit: '30718765435', booksStartDate: '2026-10-01' },
    treasuries: [
      { key: 'cash_main', name: 'Caja', kind: 'cash' },
      { key: 'wallet_main', name: 'Mercado Pago SAS', kind: 'wallet', alias: 'hub.sas.mp' },
      {
        key: 'bank_main',
        name: 'Banco Nación · cuenta corriente',
        kind: 'bank',
        createBankParty: true,
      },
    ],
    sales: {
      transferDestination: 'wallet_main',
      enabledMethods: ['cash', 'transfer', 'qr_mp', 'debit', 'credit', 'customer_account'],
      enabledPlatforms: ['pedidosya', 'rappi'],
      rates: {
        mercado_pago: { commissionBp: 150, sircupaBp: 350 },
        posnet_credito: { commissionBp: 180, iibbWithholdingBp: 120 },
      },
      salesPoints: [
        { number: 3, label: 'Salón', defaultChannel: 'salon' },
        { number: 4, label: 'Delivery', defaultChannel: 'delivery' },
      ],
    },
  }

  it('el payload de C.2', () => {
    const v = ok(bootstrapSchema, payload)
    expect(v.settings).toMatchObject({
      ivaCondition: 'responsable_inscripto',
      fiscalYearEndMonth: 12,
      iibbJurisdictionCode: 904,
    })
  })

  it('al menos una caja de efectivo, nombres y puntos de venta únicos, destino conocido', () => {
    expect(
      messageAt(
        bootstrapSchema,
        { ...payload, treasuries: payload.treasuries.slice(1) },
        'treasuries',
      ),
    ).toBe('Agregá al menos una caja de efectivo.')
    expect(
      messageAt(
        bootstrapSchema,
        {
          ...payload,
          treasuries: [...payload.treasuries, { key: 'cash_2', name: 'caja', kind: 'cash' }],
        },
        'treasuries',
      ),
    ).toBe('Ya hay una caja con ese nombre.')
    expect(
      messageAt(
        bootstrapSchema,
        { ...payload, sales: { ...payload.sales, transferDestination: 'nada' } },
        'sales.transferDestination',
      ),
    ).toBe('Elegí adónde entran las transferencias.')
    expect(
      messageAt(
        bootstrapSchema,
        {
          ...payload,
          sales: {
            ...payload.sales,
            salesPoints: [payload.sales.salesPoints[0], payload.sales.salesPoints[0]],
          },
        },
        'sales.salesPoints',
      ),
    ).toBe('Ese punto de venta ya está cargado.')
  })

  it('la fecha de arranque: hasta 400 días atrás y no futura', () => {
    const at = bootstrapSchemaAt('2026-10-06')
    ok(at, payload)
    expect(
      messageAt(
        at,
        { ...payload, settings: { ...payload.settings, booksStartDate: '2026-10-07' } },
        'settings.booksStartDate',
      ),
    ).toBe('La fecha de arranque tiene que ser de los últimos 13 meses y no puede ser futura.')
    expect(
      messageAt(
        at,
        { ...payload, settings: { ...payload.settings, booksStartDate: '2025-08-01' } },
        'settings.booksStartDate',
      ),
    ).toBe('La fecha de arranque tiene que ser de los últimos 13 meses y no puede ser futura.')
  })
})

describe('ningún esquema contesta en inglés', () => {
  const schemas: Record<string, z.ZodType> = {
    quickExpenseSchema,
    purchaseSchema,
    paymentSchema,
    salesCloseSchema,
    collectionSchema,
    walletCheckSchema,
    salesInvoiceSchema,
    transferSchema,
    bankExpenseSchema,
    cashMovementSchema,
    treasuryAdjustmentSchema,
    markTreasuryCheckedSchema,
    manualEntrySchema,
    payrollTemplateSchema,
    openingSchema,
    voidDocumentSchema,
    undoDocumentSchema,
    reverseSchema,
    allocateSchema,
    unallocateSchema,
    settingsSchema,
    accountSchema,
    partySchema,
    treasurySchema,
    salesMethodSchema,
    salesPointSchema,
    recurringSchema,
    skipRecurringDueSchema,
    closePeriodSchema,
    reopenSchema,
    generateIvaSettlementSchema,
    closeFiscalYearSchema,
    reopenFiscalYearSchema,
    grantAccessSchema,
    revokeAccessSchema,
    bootstrapSchema,
  }
  const garbage: unknown[] = [
    {},
    {
      amountCents: 'mucho',
      date: 'ayer',
      lines: 'x',
      methods: [{}],
      items: [{}],
      kind: 'x',
      mode: 'x',
    },
    {
      ...META,
      lines: [{ role: 'x' }],
      methods: [{ type: 'x' }],
      invoiced: [{}],
      deductions: [{}],
      treasuries: [{}],
      pairs: [{}],
      settings: {},
      sales: { salesPoints: [{}] },
    },
  ]
  for (const [name, schema] of Object.entries(schemas)) {
    it(name, () => {
      for (const value of garbage) {
        for (const message of messages(schema, value)) {
          expect(message, `${name}: «${message}»`).not.toMatch(
            /invalid|expected|received|required|must be|too (small|big)/i,
          )
        }
      }
    })
  }
})
