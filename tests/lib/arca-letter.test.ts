/**
 * La letra de la factura de venta y las reglas de la emisión con ARCA (diseño
 * §3.2.2–§3.2.3).
 *
 * - `letterFor` (el formulario «Ya la emití en otro sistema»): A a un responsable
 *   inscripto **y a un monotributista** (RG 5003/2021; antes devolvía B).
 * - `arcaLetterFor` (la emisión): A a 1, 6, 13 y 16 solo si ARCA habilitó la
 *   Factura A; si no, no se puede emitir (no se le hace B a quien le corresponde A).
 * - La ventana de fechas, el documento del cliente, el tope de la B sin
 *   identificar y el esquema de la acción.
 */

import { describe, expect, it } from 'vitest'
import { LETTER_A_CONDITIONS, letterFor } from '@/lib/accounting/letter'
import { IVA_CONDITIONS } from '@/lib/accounting/types'
import {
  ARCA_DAYS_BACK,
  arcaCbteFor,
  arcaDateWindow,
  arcaEmitSchema,
  arcaLetterFor,
  arcaPaymentDue,
  arcaReceiverIssue,
  arcaTestVoucherSchema,
  arcaVoucherTypeFor,
  isArcaVoucherType,
  letterOfVoucherType,
} from '@/lib/arca/emit-form'
import { CONDICION_IVA_RECEPTOR, condicionFromIvaCondition } from '@/lib/arca/vouchers'

describe('letterFor (factura cargada a mano)', () => {
  it('A al responsable inscripto y al monotributista; B al resto', () => {
    expect(letterFor('responsable_inscripto')).toBe('a')
    expect(letterFor('monotributo')).toBe('a')
    for (const c of ['exento', 'consumidor_final', 'no_alcanzado', 'sin_datos'] as const) {
      expect(letterFor(c), c).toBe('b')
    }
    expect(letterFor(undefined)).toBe('b')
    expect(letterFor(null)).toBe('b')
    expect([...LETTER_A_CONDITIONS].sort()).toEqual(['monotributo', 'responsable_inscripto'])
  })

  it('sin Factura A habilitada, todo va con B', () => {
    for (const c of IVA_CONDITIONS) expect(letterFor(c, { classA: false }), c).toBe('b')
  })

  it('coincide con la letra de ARCA para la condición que sale del cliente', () => {
    for (const c of IVA_CONDITIONS) {
      const id = condicionFromIvaCondition(c)
      if (id === null) continue
      const arca = arcaLetterFor(id, ['A', 'B'])
      expect(arca.ok && arca.letter.toLowerCase(), c).toBe(letterFor(c))
    }
  })
})

describe('arcaLetterFor (emitir con ARCA)', () => {
  it('A a 1, 6, 13 y 16 con la Factura A habilitada; B al resto', () => {
    const a = CONDICION_IVA_RECEPTOR.filter((c) => {
      const r = arcaLetterFor(c.id, ['A', 'B'])
      return r.ok && r.letter === 'A'
    }).map((c) => c.id)
    expect(a).toEqual([1, 6, 13, 16])
    for (const id of [4, 5, 7, 8, 9, 10, 15]) {
      expect(arcaLetterFor(id, ['B']), String(id)).toEqual({ ok: true, letter: 'B' })
    }
  })

  it('le corresponde A y no está habilitada: no se emite (ni se cambia a B)', () => {
    for (const id of [1, 6, 13, 16]) {
      expect(arcaLetterFor(id, ['B']), String(id)).toEqual({
        ok: false,
        reason: 'class_a_not_enabled',
        letter: 'A',
      })
      // Las «A con leyenda» no son la A común: la v1 no las emite.
      expect(arcaLetterFor(id, ['B', 'A51', 'ACBU']).ok, String(id)).toBe(false)
    }
  })

  it('sin condición (o una que no existe) hay que elegirla', () => {
    expect(arcaLetterFor(null, ['A', 'B'])).toEqual({
      ok: false,
      reason: 'condition_missing',
      letter: null,
    })
    expect(arcaLetterFor(2, ['A', 'B']).ok).toBe(false)
  })

  it('el tipo y el código de ARCA según qué se carga y la letra', () => {
    expect(arcaVoucherTypeFor('sales_invoice', 'A')).toBe('factura_a')
    expect(arcaVoucherTypeFor('sales_credit_note', 'B')).toBe('nota_credito_b')
    expect(arcaVoucherTypeFor('sales_debit_note', 'A')).toBe('nota_debito_a')
    expect(arcaCbteFor('sales_invoice', 'B')).toBe(6)
    expect(arcaCbteFor('sales_credit_note', 'A')).toBe(3)
    expect(arcaCbteFor('sales_debit_note', 'B')).toBe(7)
    expect(isArcaVoucherType('factura_b')).toBe(true)
    expect(isArcaVoucherType('tique_factura_b')).toBe(false)
    expect(letterOfVoucherType('nota_credito_a')).toBe('A')
    expect(letterOfVoucherType('factura_c')).toBeNull()
  })
})

describe('ventana de fechas', () => {
  const today = '2026-10-08'

  it('5 días para atrás con productos y 10 con servicios; nunca futura', () => {
    expect(arcaDateWindow({ today, concepto: 1 })).toEqual({
      min: '2026-10-03',
      max: today,
      limitedBy: 'arca',
    })
    expect(arcaDateWindow({ today, concepto: 2 }).min).toBe('2026-09-28')
    expect(arcaDateWindow({ today, concepto: 3 }).min).toBe('2026-09-28')
    expect(ARCA_DAYS_BACK).toEqual({ 1: 5, 2: 10, 3: 10 })
  })

  it('no antes del último comprobante, del primer día abierto ni del inicio de los libros', () => {
    expect(arcaDateWindow({ today, concepto: 1, lastIssueDate: '2026-10-06' })).toMatchObject({
      min: '2026-10-06',
      limitedBy: 'last_voucher',
    })
    expect(arcaDateWindow({ today, concepto: 2, firstOpenDate: '2026-10-01' })).toMatchObject({
      min: '2026-10-01',
      limitedBy: 'closed_month',
    })
    expect(arcaDateWindow({ today, concepto: 1, booksStartDate: '2026-10-07' })).toMatchObject({
      min: '2026-10-07',
      limitedBy: 'books_start',
    })
    // Lo más restrictivo gana.
    expect(
      arcaDateWindow({
        today,
        concepto: 1,
        lastIssueDate: '2026-10-05',
        firstOpenDate: '2026-10-07',
      }).min,
    ).toBe('2026-10-07')
  })

  it('un último comprobante «de mañana» deja solo hoy', () => {
    expect(arcaDateWindow({ today, concepto: 1, lastIssueDate: '2026-10-09' })).toMatchObject({
      min: today,
      max: today,
    })
  })
})

describe('el documento del cliente', () => {
  it('la Factura A necesita CUIT', () => {
    expect(
      arcaReceiverIssue({
        letter: 'A',
        receiver: { taxIdType: 'cuit', taxId: '30711111111' },
        totalCents: 100,
      }),
    ).toBeNull()
    for (const receiver of [
      { taxIdType: 'none' as const, taxId: null },
      { taxIdType: 'dni' as const, taxId: '12345678' },
      { taxIdType: 'cuit' as const, taxId: '30711111112' },
    ]) {
      expect(arcaReceiverIssue({ letter: 'A', receiver, totalCents: 100 })?.key).toBe(
        'a_needs_cuit',
      )
    }
  })

  it('B sin identificar: hasta el tope de la RG 5700 ($ 10.000.000)', () => {
    const anonymous = { taxIdType: 'none' as const, taxId: null }
    expect(
      arcaReceiverIssue({ letter: 'B', receiver: anonymous, totalCents: 999_999_999 }),
    ).toBeNull()
    expect(
      arcaReceiverIssue({ letter: 'B', receiver: anonymous, totalCents: 1_000_000_000 })?.key,
    ).toBe('anonymous_over_cap')
    // Identificado, cualquier monto.
    expect(
      arcaReceiverIssue({
        letter: 'B',
        receiver: { taxIdType: 'dni', taxId: '12345678' },
        totalCents: 5_000_000_000,
      }),
    ).toBeNull()
    expect(
      arcaReceiverIssue({
        letter: 'B',
        receiver: { taxIdType: 'dni', taxId: '12' },
        totalCents: 100,
      })?.key,
    ).toBe('receiver_document')
  })
})

describe('arcaEmitSchema', () => {
  const PARTY = '00000000-0000-4000-8000-0000000000a1'
  const base = {
    clientRef: '00000000-0000-4000-8000-0000000000f1',
    previewHash: 'b'.repeat(64),
    warningsAck: [],
    docKind: 'sales_invoice',
    partyId: PARTY,
    voucherType: 'factura_b',
    pointOfSale: 5,
    number: 105,
    issueDate: '2026-10-08',
    dueDate: null,
    channel: 'events',
    aliquots: [{ vatRateBp: 2100, netCents: 10_000, vatAdjustCents: 0 }],
    arca: {
      predictedNumber: 105,
      condicionIvaReceptorId: 5,
      concepto: 1,
      detail: 'Catering para 40 personas',
    },
  }
  const errors = (value: unknown) => {
    const r = arcaEmitSchema.safeParse(value)
    if (r.success) return {}
    return Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]))
  }

  it('una Factura B a consumidor final pasa (con los valores por defecto)', () => {
    const r = arcaEmitSchema.safeParse(base)
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.arca).toEqual({
      predictedNumber: 105,
      condicionIvaReceptorId: 5,
      concepto: 1,
      serviceFrom: null,
      serviceTo: null,
      paymentDue: null,
      detail: 'Catering para 40 personas',
      relatedVoucherId: null,
    })
    expect(arcaPaymentDue(r.data)).toBeNull()
  })

  it('el número tiene que ser el que dio ARCA', () => {
    expect(errors({ ...base, number: 106 })).toHaveProperty('number')
  })

  it('la condición tiene que ir con la letra', () => {
    expect(errors({ ...base, arca: { ...base.arca, condicionIvaReceptorId: 1 } })).toHaveProperty(
      'arca.condicionIvaReceptorId',
    )
    expect(
      errors({
        ...base,
        voucherType: 'factura_a',
        arca: { ...base.arca, condicionIvaReceptorId: 6 },
      }),
    ).toEqual({})
    expect(errors({ ...base, arca: { ...base.arca, condicionIvaReceptorId: 2 } })).toHaveProperty(
      'arca.condicionIvaReceptorId',
    )
  })

  it('los tiques no se emiten por ARCA', () => {
    expect(errors({ ...base, voucherType: 'tique_factura_b' })).toHaveProperty('voucherType')
  })

  it('servicios: período y vencimiento del pago obligatorios', () => {
    const services = { ...base, arca: { ...base.arca, concepto: 2 } }
    expect(Object.keys(errors(services)).sort()).toEqual(
      ['arca.serviceFrom', 'arca.serviceTo', 'dueDate'].sort(),
    )
    const ok = {
      ...base,
      dueDate: '2026-10-20',
      arca: { ...base.arca, concepto: 2, serviceFrom: '2026-10-01', serviceTo: '2026-10-07' },
    }
    expect(errors(ok)).toEqual({})
    const parsed = arcaEmitSchema.parse(ok)
    expect(arcaPaymentDue(parsed)).toBe('2026-10-20')
    expect(
      errors({ ...ok, arca: { ...ok.arca, serviceFrom: '2026-10-09', serviceTo: '2026-10-07' } }),
    ).toHaveProperty('arca.serviceTo')
    // Con productos no van fechas de servicio.
    expect(
      errors({
        ...base,
        arca: { ...base.arca, serviceFrom: '2026-10-01', serviceTo: '2026-10-07' },
      }),
    ).toHaveProperty('arca.serviceFrom')
  })

  it('NC y ND van asociadas a una factura de la plataforma; la factura no', () => {
    const nc = {
      ...base,
      docKind: 'sales_credit_note',
      voucherType: 'nota_credito_b',
    }
    expect(errors(nc)).toHaveProperty('arca.relatedVoucherId')
    expect(
      errors({
        ...nc,
        arca: { ...nc.arca, relatedVoucherId: '00000000-0000-4000-8000-0000000000b2' },
      }),
    ).toEqual({})
    expect(
      errors({
        ...base,
        arca: { ...base.arca, relatedVoucherId: '00000000-0000-4000-8000-0000000000b2' },
      }),
    ).toHaveProperty('arca.relatedVoucherId')
  })

  it('el detalle impreso: de 3 a 500 letras', () => {
    expect(errors({ ...base, arca: { ...base.arca, detail: 'ok' } })).toHaveProperty('arca.detail')
    expect(errors({ ...base, arca: { ...base.arca, detail: 'x'.repeat(501) } })).toHaveProperty(
      'arca.detail',
    )
  })
})

describe('factura de prueba', () => {
  it('la A pide la CUIT del cliente de prueba', () => {
    expect(arcaTestVoucherSchema.safeParse({}).success).toBe(true)
    expect(arcaTestVoucherSchema.safeParse({ kind: 'factura_a' }).success).toBe(false)
    const ok = arcaTestVoucherSchema.parse({ kind: 'factura_a', receiverCuit: '30-71111111-1' })
    expect(ok.receiverCuit).toBe('30711111111')
  })
})
