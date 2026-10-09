import { describe, expect, it } from 'vitest'
import {
  amountAfterRecurring,
  buildQuickExpenseValues,
  type QuickExpenseFormState,
  quickVoucherFromType,
  recurringDueText,
  recurringNote,
  recurringPrefill,
  sortRecurringForSheet,
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
