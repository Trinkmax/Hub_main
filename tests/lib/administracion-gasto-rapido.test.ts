import { describe, expect, it } from 'vitest'
import {
  amountAfterRecurring,
  buildQuickExpenseValues,
  detailRoom,
  INVOICED_QUICK_VOUCHERS,
  QUICK_DETAIL_MAX,
  QUICK_VOUCHER_LABELS,
  QUICK_VOUCHERS,
  type QuickExpenseFormState,
  quickExpenseOutcome,
  quickVoucherFromType,
  quickVoucherHelp,
  quickVoucherInvoiced,
  recurringDueText,
  recurringNote,
  recurringPrefill,
  sortRecurringForSheet,
  suggestInvoicedVoucher,
  suggestQuickVoucher,
  withRemito,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import type { SheetRecurring } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-types'

const PARTY = '00000000-0000-4000-8000-0000000000a1'
const ACCOUNT = '00000000-0000-4000-8000-0000000000b1'
const OTHER_ACCOUNT = '00000000-0000-4000-8000-0000000000b2'
const CAJA = '00000000-0000-4000-8000-0000000000c1'
const BANCO = '00000000-0000-4000-8000-0000000000c2'
const RECURRING = '00000000-0000-4000-8000-0000000000d1'

function recurring(patch: Partial<SheetRecurring> = {}): SheetRecurring {
  return {
    id: RECURRING,
    name: 'Alquiler',
    partyId: PARTY,
    accountId: ACCOUNT,
    voucherType: 'factura_a',
    vatRateBp: 2100,
    amountCents: 85_000_000,
    treasuryAccountId: BANCO,
    nextDueDate: '2026-10-10',
    pending: true,
    ...patch,
  }
}

const USABLE = {
  payablePartyIds: new Set([PARTY]),
  imputableAccountIds: new Set([ACCOUNT]),
  activeTreasuryIds: new Set([CAJA, BANCO]),
}

describe('«Nuevo gasto» · gastos fijos en «¿En qué?»', () => {
  it('el comprobante habitual va al selector del sheet; lo que no es de los cuatro no se toca', () => {
    expect(quickVoucherFromType('sin_comprobante')).toBe('none')
    // «Otro comprobante» lleva número y va al Libro IVA: no es ninguno de los cuatro de la hoja.
    expect(quickVoucherFromType('otro_comprobante')).toBeNull()
    expect(quickVoucherFromType('tique')).toBe('ticket')
    expect(quickVoucherFromType('factura_a')).toBe('a')
    expect(quickVoucherFromType('factura_b')).toBe('bc')
    expect(quickVoucherFromType('factura_c')).toBe('bc')
    expect(quickVoucherFromType('nota_credito_a')).toBeNull()
    expect(quickVoucherFromType('factura_m')).toBeNull()
    expect(quickVoucherFromType(null)).toBeNull()
    expect(quickVoucherFromType(undefined)).toBeNull()
  })

  it('primero los pendientes de este mes por vencimiento; después el resto por vencimiento y nombre', () => {
    const rows = [
      recurring({ id: 'luz', name: 'Luz', nextDueDate: '2026-11-05', pending: false }),
      recurring({ id: 'internet', name: 'Internet', nextDueDate: '2026-10-20', pending: true }),
      recurring({ id: 'seguro', name: 'Seguro', nextDueDate: '2026-11-05', pending: false }),
      recurring({ id: 'alquiler', name: 'Alquiler', nextDueDate: '2026-10-10', pending: true }),
      recurring({ id: 'agua', name: 'Agua', nextDueDate: '2026-11-05', pending: false }),
      // Vencido de un mes anterior: sigue pendiente y va antes.
      recurring({ id: 'abl', name: 'ABL', nextDueDate: '2026-09-15', pending: true }),
    ]
    expect(sortRecurringForSheet(rows).map((r) => r.id)).toEqual([
      'abl',
      'alquiler',
      'internet',
      'agua',
      'luz',
      'seguro',
    ])
    // No toca la lista de entrada.
    expect(rows[0]?.id).toBe('luz')
  })

  it('«Gasto fijo · vence el dd/MM» solo si está pendiente (con «hoy» y «venció»)', () => {
    expect(recurringDueText('2026-10-10', '2026-10-09')).toBe('vence el 10/10')
    expect(recurringDueText('2026-10-09', '2026-10-09')).toBe('vence hoy')
    expect(recurringDueText('2026-10-05', '2026-10-09')).toBe('venció el 05/10')
    expect(recurringNote(recurring(), '2026-10-09')).toBe('Gasto fijo · vence el 10/10')
    expect(recurringNote(recurring({ pending: false }), '2026-10-09')).toBe('Gasto fijo')
  })

  it('con proveedor: precarga proveedor, cuenta, monto, caja, comprobante y alícuota', () => {
    expect(recurringPrefill(recurring(), USABLE)).toEqual({
      target: { kind: 'party', partyId: PARTY, accountId: ACCOUNT },
      amountCents: 85_000_000,
      voucher: 'a',
      vatRateBp: 2100,
      treasuryAccountId: BANCO,
    })
  })

  it('monto variable, caja dada de baja, alícuota rara o comprobante raro: no se precargan', () => {
    expect(
      recurringPrefill(
        recurring({
          amountCents: null,
          treasuryAccountId: '00000000-0000-4000-8000-0000000000c9',
          vatRateBp: 500,
          voucherType: 'recibo_c',
        }),
        USABLE,
      ),
    ).toEqual({
      target: { kind: 'party', partyId: PARTY, accountId: ACCOUNT },
      amountCents: null,
      voucher: null,
      vatRateBp: null,
      treasuryAccountId: null,
    })
  })

  it('sin proveedor que sirva: la cuenta sola, y una factura no se propone (pide proveedor)', () => {
    const noParty = recurringPrefill(recurring({ partyId: null }), USABLE)
    expect(noParty?.target).toEqual({ kind: 'account', accountId: ACCOUNT })
    expect(noParty?.voucher).toBeNull()

    const inactiveParty = recurringPrefill(
      recurring({ partyId: '00000000-0000-4000-8000-0000000000a9', voucherType: 'tique' }),
      USABLE,
    )
    expect(inactiveParty?.target).toEqual({ kind: 'account', accountId: ACCOUNT })
    expect(inactiveParty?.voucher).toBe('ticket')

    expect(
      recurringPrefill(recurring({ partyId: null, voucherType: 'sin_comprobante' }), USABLE)
        ?.voucher,
    ).toBe('none')
  })

  it('cuenta que ya no es imputable: con proveedor queda para elegir; sin proveedor, no se ofrece', () => {
    expect(recurringPrefill(recurring({ accountId: OTHER_ACCOUNT }), USABLE)?.target).toEqual({
      kind: 'party',
      partyId: PARTY,
      accountId: null,
    })
    expect(recurringPrefill(recurring({ accountId: OTHER_ACCOUNT, partyId: null }), USABLE)).toBe(
      null,
    )
  })

  it('el monto: se precarga si está vacío o si lo puso otro gasto fijo; lo tipeado no se pisa', () => {
    expect(amountAfterRecurring({ current: null, prefilled: null, recurring: 100 })).toBe(100)
    expect(amountAfterRecurring({ current: null, prefilled: null, recurring: null })).toBeNull()
    // Lo había puesto otro gasto fijo: se reemplaza (y si este es variable, queda vacío).
    expect(amountAfterRecurring({ current: 100, prefilled: 100, recurring: 200 })).toBe(200)
    expect(amountAfterRecurring({ current: 100, prefilled: 100, recurring: null })).toBeNull()
    // Lo tipeó la persona (o lo cambió después): queda.
    expect(amountAfterRecurring({ current: 120, prefilled: null, recurring: 200 })).toBe(120)
    expect(amountAfterRecurring({ current: 120, prefilled: 100, recurring: 200 })).toBe(120)
  })

  it('lo que se manda lleva el gasto fijo elegido (o null)', () => {
    const state: QuickExpenseFormState = {
      amountCents: 85_000_000,
      target: { kind: 'party', partyId: PARTY, accountId: ACCOUNT },
      treasuryAccountId: BANCO,
      voucher: 'a',
      vatRateBp: 2100,
      vatAdjustCents: 0,
      pointOfSale: 3,
      number: 1290,
      date: '2026-10-09',
      detail: '',
      recurringExpenseId: RECURRING,
    }
    expect(buildQuickExpenseValues(state).values?.recurringExpenseId).toBe(RECURRING)
    expect(
      buildQuickExpenseValues({ ...state, recurringExpenseId: null }).values?.recurringExpenseId,
    ).toBeNull()
  })
})

describe('«Nuevo gasto» · «¿Se factura?» (12/10/2026)', () => {
  const state: QuickExpenseFormState = {
    amountCents: 450_000,
    target: { kind: 'party', partyId: PARTY, accountId: ACCOUNT },
    treasuryAccountId: CAJA,
    voucher: 'none',
    vatRateBp: 2100,
    vatAdjustCents: 0,
    pointOfSale: null,
    number: null,
    date: '2026-10-12',
    detail: '',
    recurringExpenseId: null,
  }

  it('los valores que se guardan no cambiaron: «No» es `none`; «Sí» abre tique y facturas', () => {
    expect([...QUICK_VOUCHERS]).toEqual(['none', 'ticket', 'a', 'bc'])
    expect([...INVOICED_QUICK_VOUCHERS]).toEqual(['ticket', 'a', 'bc'])
    expect(quickVoucherInvoiced('none')).toBe(false)
    for (const voucher of INVOICED_QUICK_VOUCHERS) expect(quickVoucherInvoiced(voucher)).toBe(true)
    // En pantalla ya no hay «Sin comprobante».
    expect(QUICK_VOUCHER_LABELS.none).toBe('Remito u otro')
    expect(Object.values(QUICK_VOUCHER_LABELS).join(' ')).not.toMatch(/sin comprobante/i)
  })

  it('por defecto: sin proveedor, «No»; con proveedor, por su condición (como hasta ahora)', () => {
    expect(suggestQuickVoucher({ hasParty: false })).toBe('none')
    expect(suggestQuickVoucher({ hasParty: false, habitualVoucherType: 'factura_a' })).toBe('none')
    expect(suggestQuickVoucher({ hasParty: true, condition: 'responsable_inscripto' })).toBe('a')
    expect(suggestQuickVoucher({ hasParty: true, condition: 'monotributo' })).toBe('bc')
    expect(suggestQuickVoucher({ hasParty: true, condition: 'exento' })).toBe('bc')
    expect(suggestQuickVoucher({ hasParty: true, condition: 'consumidor_final' })).toBe('ticket')
    expect(suggestQuickVoucher({ hasParty: true })).toBe('ticket')
  })

  it('la ficha propone: el «Comprobante habitual» le gana al último que se le cargó', () => {
    // Un proveedor que no factura (su ficha dice «Remito u otro»), aunque la última vez facturó.
    expect(
      suggestQuickVoucher({
        hasParty: true,
        habitualVoucherType: 'sin_comprobante',
        lastVoucherType: 'factura_a',
        condition: 'responsable_inscripto',
      }),
    ).toBe('none')
    // Un habitual que la hoja no ofrece no decide: queda lo que corresponde por la condición.
    expect(
      suggestQuickVoucher({
        hasParty: true,
        habitualVoucherType: 'otro_comprobante',
        condition: 'responsable_inscripto',
      }),
    ).toBe('a')
    // Y al revés: la ficha dice Factura A y la última vez fue sin factura.
    expect(
      suggestQuickVoucher({
        hasParty: true,
        habitualVoucherType: 'factura_a',
        lastVoucherType: 'sin_comprobante',
        condition: 'monotributo',
      }),
    ).toBe('a')
    // Sin habitual, lo de siempre: el último; un tipo que no dice nada no decide.
    expect(
      suggestQuickVoucher({
        hasParty: true,
        habitualVoucherType: null,
        lastVoucherType: 'sin_comprobante',
        condition: 'responsable_inscripto',
      }),
    ).toBe('none')
    expect(suggestQuickVoucher({ hasParty: true, lastVoucherType: 'tique' })).toBe('ticket')
    expect(suggestQuickVoucher({ hasParty: true, lastVoucherType: 'factura_m' })).toBe('a')
    expect(suggestQuickVoucher({ hasParty: true, lastVoucherType: 'factura_c' })).toBe('bc')
    expect(
      suggestQuickVoucher({
        hasParty: true,
        habitualVoucherType: 'ddjj_impuesto',
        lastVoucherType: 'algo_viejo',
        condition: 'exento',
      }),
    ).toBe('bc')
  })

  it('al contestar «Sí»: la factura habitual o la última; si eran sin factura, por la condición', () => {
    expect(suggestInvoicedVoucher({ hasParty: false })).toBe('ticket')
    expect(suggestInvoicedVoucher({ hasParty: false, habitualVoucherType: 'factura_a' })).toBe(
      'ticket',
    )
    expect(
      suggestInvoicedVoucher({
        hasParty: true,
        habitualVoucherType: 'sin_comprobante',
        lastVoucherType: 'factura_c',
        condition: 'responsable_inscripto',
      }),
    ).toBe('bc')
    expect(
      suggestInvoicedVoucher({
        hasParty: true,
        habitualVoucherType: 'sin_comprobante',
        lastVoucherType: 'sin_comprobante',
        condition: 'responsable_inscripto',
      }),
    ).toBe('a')
    expect(
      suggestInvoicedVoucher({ hasParty: true, habitualVoucherType: 'tique', condition: 'exento' }),
    ).toBe('ticket')
    expect(suggestInvoicedVoucher({ hasParty: true })).toBe('ticket')
  })

  it('la ayuda dice la verdad: «No» y el tique sin proveedor no entran al Libro IVA', () => {
    expect(
      quickVoucherHelp({ voucher: 'none', outcome: 'expense', condition: 'responsable_inscripto' }),
    ).toMatch(/No entra al Libro IVA\.$/)
    expect(quickVoucherHelp({ voucher: 'ticket', outcome: 'expense', condition: null })).toBe(
      'Sin proveedor o sin número, el tique va como gasto: no entra al Libro IVA.',
    )
    expect(quickVoucherHelp({ voucher: 'ticket', outcome: 'purchase', condition: null })).toMatch(
      /entra al Libro IVA/,
    )
    expect(
      quickVoucherHelp({ voucher: 'bc', outcome: 'purchase', condition: 'responsable_inscripto' }),
    ).toMatch(/no computás el IVA/)
    expect(quickVoucherHelp({ voucher: 'bc', outcome: 'purchase', condition: 'monotributo' })).toBe(
      'Se guarda la factura y el pago, así la cuenta del proveedor queda en cero.',
    )
    expect(quickVoucherHelp({ voucher: 'a', outcome: 'purchase', condition: null })).toBe(
      'Se guarda la factura y el pago, así la cuenta del proveedor queda en cero.',
    )
    // «No» siempre es un gasto de contado, con o sin proveedor y con o sin número.
    expect(quickExpenseOutcome({ voucher: 'none', hasParty: true, hasNumber: true })).toBe(
      'expense',
    )
  })

  it('«N.º de remito»: va adelante del detalle; vacío, no agrega nada', () => {
    expect(withRemito('0001-00001234', '')).toBe('Remito 0001-00001234')
    expect(withRemito('  0001-00001234 ', ' hielo para el evento ')).toBe(
      'Remito 0001-00001234 · hielo para el evento',
    )
    expect(withRemito('', 'hielo')).toBe('hielo')
    expect(withRemito('   ', '')).toBe('')
    // Si ya escribieron «Remito», no se repite.
    expect(withRemito('remito 55', '')).toBe('remito 55')
    expect(withRemito('Remito   R-12', 'x')).toBe('Remito R-12 · x')
    // El detalle pierde el lugar que ocupa el número (y nunca queda negativo).
    expect(detailRoom('', QUICK_DETAIL_MAX)).toBe(280)
    expect(detailRoom('0001-00001234', QUICK_DETAIL_MAX)).toBe(
      280 - 'Remito 0001-00001234 · '.length,
    )
    expect(detailRoom('x'.repeat(40), 10)).toBe(0)
  })

  it('lo que se manda con «No»: `none`, sin punto de venta ni número, y el remito en el detalle', () => {
    const values = buildQuickExpenseValues({
      ...state,
      pointOfSale: 3,
      number: 1290,
      remito: '0001-00001234',
      detail: 'hielo',
    }).values
    expect(values).toMatchObject({
      voucher: 'none',
      pointOfSale: null,
      number: null,
      detail: 'Remito 0001-00001234 · hielo',
    })
    expect(buildQuickExpenseValues(state).values?.detail).toBeNull()
    expect(buildQuickExpenseValues({ ...state, remito: '77' }).values?.detail).toBe('Remito 77')
  })

  it('con «Sí» el número de remito no se manda (el comprobante lleva su propio número)', () => {
    const values = buildQuickExpenseValues({
      ...state,
      voucher: 'a',
      pointOfSale: 3,
      number: 1290,
      remito: '0001-00001234',
      detail: 'hielo',
    }).values
    expect(values).toMatchObject({ voucher: 'a', pointOfSale: 3, number: 1290, detail: 'hielo' })
  })
})
