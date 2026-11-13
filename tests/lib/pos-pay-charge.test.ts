import { describe, expect, it } from 'vitest'
import { NBSP } from '@/lib/money'
import type { InboxApproval } from '@/lib/pos/cash/types'
import {
  agoLabel,
  approvalCents,
  approvalReason,
  approvalTitle,
  approvalWhere,
  discountFromApproval,
  latestDecision,
  unseenAnswers,
} from '@/lib/pos/pay/approvals'
import {
  bpLabel,
  chargeReady,
  composeCharge,
  payFailureKind,
  tipCentsOf,
  toChargeInput,
} from '@/lib/pos/pay/charge'
import { discount, pesos } from './pos-pay-fixtures'

const settings = {
  credit_surcharge_bp: 1000,
  invoice_by_method: { cash: false, transfer: true, qr: true, debit: true, credit: true },
}
const whole = { amountCents: pesos(47_000), closes: true }

describe('armar un cobro', () => {
  it('efectivo justo: sin vuelto y sin factura', () => {
    const charge = composeCharge({
      method: 'cash',
      portion: whole,
      tip: { kind: 'none' },
      tender: { kind: 'exact' },
      invoice: null,
      settings,
      remainingCents: pesos(47_000),
    })
    expect(charge).toMatchObject({
      amountCents: pesos(47_000),
      totalCents: pesos(47_000),
      surchargeCents: 0,
      tenderedCents: null,
      changeCents: 0,
      invoice: false,
      afterCents: 0,
      closes: true,
    })
    expect(chargeReady(charge)).toBe(true)
  })

  it('efectivo con un billete más grande: el vuelto', () => {
    const charge = composeCharge({
      method: 'cash',
      portion: whole,
      tip: { kind: 'none' },
      tender: { kind: 'given', cents: pesos(50_000) },
      invoice: null,
      settings,
      remainingCents: pesos(47_000),
    })
    expect(charge.tenderedCents).toBe(pesos(50_000))
    expect(charge.changeCents).toBe(pesos(3000))
  })

  it('la propina sale de lo que entregó: no es vuelto', () => {
    const charge = composeCharge({
      method: 'cash',
      portion: whole,
      tip: { kind: 'pct', pct: 10 },
      tender: { kind: 'given', cents: pesos(60_000) },
      invoice: null,
      settings,
      remainingCents: pesos(47_000),
    })
    expect(charge.tipCents).toBe(pesos(4700))
    expect(charge.totalCents).toBe(pesos(51_700))
    expect(charge.changeCents).toBe(pesos(8300))
  })

  it('si entrega justo lo que tiene que pagar, viaja como «justo»', () => {
    const charge = composeCharge({
      method: 'cash',
      portion: whole,
      tip: { kind: 'amount', cents: pesos(3000) },
      tender: { kind: 'given', cents: pesos(50_000) },
      invoice: null,
      settings,
      remainingCents: pesos(47_000),
    })
    expect(charge.tenderedCents).toBeNull()
    expect(charge.changeCents).toBe(0)
  })

  it('lo que entregó no alcanza: no se puede cobrar', () => {
    const short = composeCharge({
      method: 'cash',
      portion: whole,
      tip: { kind: 'none' },
      tender: { kind: 'given', cents: pesos(40_000) },
      invoice: null,
      settings,
      remainingCents: pesos(47_000),
    })
    expect(short.changeCents).toBeNull()
    expect(chargeReady(short)).toBe(false)
    const blank = composeCharge({
      method: 'cash',
      portion: whole,
      tip: { kind: 'none' },
      tender: { kind: 'given', cents: null },
      invoice: null,
      settings,
      remainingCents: pesos(47_000),
    })
    expect(chargeReady(blank)).toBe(false)
  })

  it('crédito: el recargo a la vista antes de cobrar, solo sobre esta parte', () => {
    const charge = composeCharge({
      method: 'credit',
      portion: { amountCents: pesos(23_500), closes: false },
      tip: { kind: 'none' },
      tender: { kind: 'exact' },
      invoice: null,
      settings,
      remainingCents: pesos(47_000),
    })
    expect(charge.surchargeCents).toBe(pesos(2350))
    expect(charge.totalCents).toBe(pesos(25_850))
    expect(charge.invoice).toBe(true)
    expect(charge.afterCents).toBe(pesos(23_500))
    expect(charge.closes).toBe(false)
  })

  it('«facturar» viene según el medio y se cambia con un toque', () => {
    const base = {
      portion: whole,
      tip: { kind: 'none' } as const,
      tender: { kind: 'exact' } as const,
      settings,
      remainingCents: pesos(47_000),
    }
    expect(composeCharge({ ...base, method: 'transfer', invoice: null }).invoice).toBe(true)
    expect(composeCharge({ ...base, method: 'other', invoice: null }).invoice).toBe(false)
    expect(composeCharge({ ...base, method: 'cash', invoice: true }).invoice).toBe(true)
    expect(composeCharge({ ...base, method: 'debit', invoice: false }).invoice).toBe(false)
  })

  it('el vuelto solo existe en efectivo', () => {
    const charge = composeCharge({
      method: 'debit',
      portion: whole,
      tip: { kind: 'none' },
      tender: { kind: 'given', cents: pesos(50_000) },
      invoice: null,
      settings,
      remainingCents: pesos(47_000),
    })
    expect(charge.tenderedCents).toBeNull()
    expect(charge.changeCents).toBe(0)
  })

  it('la propina: porcentaje del bar o un monto', () => {
    expect(tipCentsOf({ kind: 'pct', pct: 10 }, pesos(47_000))).toBe(pesos(4700))
    expect(tipCentsOf({ kind: 'amount', cents: pesos(2000) }, pesos(47_000))).toBe(pesos(2000))
    expect(tipCentsOf({ kind: 'amount', cents: null }, pesos(47_000))).toBe(0)
    expect(tipCentsOf({ kind: 'none' }, pesos(47_000))).toBe(0)
  })

  it('sin monto no hay cobro', () => {
    const empty = composeCharge({
      method: 'cash',
      portion: { amountCents: 0, closes: false },
      tip: { kind: 'none' },
      tender: { kind: 'exact' },
      invoice: null,
      settings,
      remainingCents: pesos(47_000),
    })
    expect(chargeReady(empty)).toBe(false)
  })
})

describe('lo que viaja a la base', () => {
  const charge = composeCharge({
    method: 'cash',
    portion: { amountCents: pesos(21_250), closes: false },
    tip: { kind: 'none' },
    tender: { kind: 'given', cents: pesos(25_000) },
    invoice: null,
    settings,
    remainingCents: pesos(85_000),
  })

  it('lleva la clave, el rótulo y con cuánto pagó', () => {
    expect(
      toChargeInput('session-1', charge, {
        key: 'clave-de-prueba',
        portion: { label: 'Parte 1 de 4', itemIds: [] },
      }),
    ).toEqual({
      sessionId: 'session-1',
      method: 'cash',
      amountCents: pesos(21_250),
      idempotencyKey: 'clave-de-prueba',
      tenderedCents: pesos(25_000),
      tipCents: 0,
      invoice: false,
      payerLabel: 'Parte 1 de 4',
      reference: null,
      shiftId: null,
    })
  })

  it('por producto lleva los renglones; la referencia va recortada', () => {
    const input = toChargeInput('session-1', charge, {
      key: 'clave-de-prueba',
      portion: { label: '2 Mojito', itemIds: ['a', 'a'] },
      reference: `  ${'x'.repeat(120)}  `,
      shiftId: 'shift-2',
    })
    expect(input.itemIds).toEqual(['a', 'a'])
    expect(input.reference).toHaveLength(80)
    expect(input.shiftId).toBe('shift-2')
  })
})

describe('cuando un cobro no entra', () => {
  it('sin señal o con un error de la base se reintenta con la misma clave', () => {
    expect(payFailureKind('network')).toBe('retry')
    expect(payFailureKind('unknown')).toBe('retry')
    expect(payFailureKind(undefined)).toBe('retry')
  })

  it('si la cuenta cambió por debajo, se vuelve a leer', () => {
    for (const code of [
      'amount_exceeds_remaining',
      'nothing_to_pay',
      'session_not_open',
      'no_open_shift',
      'shift_required',
      'items_already_paid',
    ]) {
      expect(payFailureKind(code)).toBe('refresh')
    }
  })

  it('lo que está mal cargado se corrige; sin permiso no se sigue', () => {
    expect(payFailureKind('tendered_too_low')).toBe('fix')
    expect(payFailureKind('forbidden')).toBe('stop')
    expect(payFailureKind('unauthenticated')).toBe('stop')
  })

  it('escribe el recargo como se dice', () => {
    expect(bpLabel(1000)).toBe('10 %')
    expect(bpLabel(1250)).toBe('12,5 %')
    expect(bpLabel(875)).toBe('8,75 %')
    expect(bpLabel(0)).toBe('0 %')
  })
})

describe('pedidos de descuento y de baja', () => {
  const now = Date.parse('2026-11-13T02:40:00.000+00:00')
  const base: InboxApproval = {
    id: 'ap-1',
    kind: 'discount',
    status: 'pending',
    summary: 'Descuento 10 % · Demora',
    payload: { kind: 'percent', value: 1000, reason: 'Demora' },
    session_id: 'session-1',
    table_label: '12',
    alias: 'Cumple de Sofi',
    requested_by_name: 'Luz',
    requested_at: '2026-11-13T02:37:00.000+00:00',
    mine: false,
  }

  it('dice qué se pide, por qué y cuánta plata mueve', () => {
    expect(approvalTitle(base)).toBe('Descuento 10 %')
    expect(approvalReason(base)).toBe('Demora')
    expect(approvalCents(base)).toBeNull()
    const amount = { ...base, payload: { kind: 'amount' as const, value: 500_000, reason: 'x' } }
    expect(approvalTitle(amount)).toBe(`Descuento $${NBSP}5.000`)
    expect(approvalCents(amount)).toBe(500_000)
    const baja: InboxApproval = {
      ...base,
      kind: 'void_item',
      summary: 'Baja: 3 × Clásicas · Se cayó',
      payload: {
        item_id: 'i',
        reason: 'Se cayó',
        name: 'Clásicas',
        quantity: 3,
        amount_cents: 3_300_000,
      },
    }
    expect(approvalTitle(baja)).toBe('Baja: 3 × Clásicas')
    expect(approvalCents(baja)).toBe(3_300_000)
    expect(approvalWhere(baja)).toBe('Mesa 12')
    expect(approvalWhere({ table_label: null, alias: null })).toBe('Sin mesa')
  })

  it('lo ya contestado no trae el detalle: se arma con lo que escribió la base', () => {
    const decided: InboxApproval = { ...base, status: 'approved', payload: undefined }
    expect(approvalTitle(decided)).toBe('Descuento 10 %')
    expect(approvalReason(decided)).toBe('Demora')
  })

  it('hace cuánto espera', () => {
    expect(agoLabel('2026-11-13T02:39:40.000+00:00', now)).toBe('recién')
    expect(agoLabel('2026-11-13T02:37:00.000+00:00', now)).toBe('hace 3 min')
    expect(agoLabel('2026-11-13T01:35:00.000+00:00', now)).toBe('hace 1 h 05')
    expect(agoLabel(null, now)).toBe('')
  })

  it('lo que le contestaron y todavía no vio', () => {
    const recent: InboxApproval[] = [
      { ...base, id: 'a', status: 'approved', mine: true, decided_at: '2026-11-13T02:30:00Z' },
      { ...base, id: 'b', status: 'rejected', mine: true, decided_at: '2026-11-13T02:38:00Z' },
      { ...base, id: 'c', status: 'cancelled', mine: true, decided_at: '2026-11-13T02:39:00Z' },
      { ...base, id: 'd', status: 'approved', mine: false, decided_at: '2026-11-13T02:39:30Z' },
    ]
    expect(unseenAnswers(recent, null).map((a) => a.id)).toEqual(['a', 'b'])
    expect(unseenAnswers(recent, '2026-11-13T02:35:00Z').map((a) => a.id)).toEqual(['b'])
    expect(unseenAnswers(recent, '2026-11-13T02:39:30Z')).toEqual([])
    expect(latestDecision(recent)).toBe('2026-11-13T02:39:30Z')
    expect(latestDecision([])).toBeNull()
  })

  it('encuentra el descuento que nació de un pedido aprobado, para deshacerlo', () => {
    const approval = { payload: base.payload, requested_by_name: 'Luz' }
    const older = discount('percent', 1000, {
      approved_by_name: 'Dueño QA',
      at: '2026-11-13T02:10:00.000+00:00',
    })
    const newer = discount('percent', 1000, {
      approved_by_name: 'Dueño QA',
      at: '2026-11-13T02:38:00.000+00:00',
    })
    const direct = discount('percent', 1000, { at: '2026-11-13T02:39:00.000+00:00' })
    const other = discount('percent', 1500, { approved_by_name: 'Dueño QA' })
    expect(discountFromApproval([older, direct, other, newer], approval)?.id).toBe(newer.id)
    expect(discountFromApproval([direct, other], approval)).toBeNull()
  })
})
