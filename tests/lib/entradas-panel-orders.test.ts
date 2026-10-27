import { describe, expect, it } from 'vitest'
import {
  attentionView,
  canRefund,
  formatOrderMoment,
  holdExpired,
  orderAmountCents,
  orderFunctionLabel,
  orderStatusView,
  paymentOptionLabel,
  peopleLabel,
} from '@/app/(manager)/[tenantSlug]/entradas/_lib/orders'

/**
 * Marketing › Entradas › Ventas online: cada compra dice en qué quedó. «Vencido»
 * no existe en la base: es pending/rejected con el lugar ya liberado.
 */

const NOW = new Date('2026-10-26T21:00:00.000Z') // 18:00 en Córdoba
const LATER = '2026-10-26T21:10:00.000Z'
const EARLIER = '2026-10-26T20:50:00.000Z'

describe('orderStatusView', () => {
  it('pagado y devuelto no dependen del lugar guardado', () => {
    expect(orderStatusView({ status: 'approved', hold_expires_at: EARLIER }, NOW)).toMatchObject({
      label: 'Pagado',
      tone: 'paid',
    })
    expect(orderStatusView({ status: 'refunded', hold_expires_at: LATER }, NOW)).toMatchObject({
      label: 'Devuelto',
      tone: 'refunded',
    })
  })

  it('pendiente con el lugar guardado: está pagando', () => {
    expect(orderStatusView({ status: 'pending', hold_expires_at: LATER }, NOW)).toMatchObject({
      label: 'Pagando…',
      tone: 'paying',
    })
  })

  it('rechazado con el lugar guardado: puede reintentar con otra tarjeta', () => {
    expect(orderStatusView({ status: 'rejected', hold_expires_at: LATER }, NOW)).toMatchObject({
      label: 'Reintentando',
      tone: 'retrying',
    })
  })

  it('pendiente o rechazado con el lugar vencido: sin pagar', () => {
    for (const status of ['pending', 'rejected'] as const) {
      expect(orderStatusView({ status, hold_expires_at: EARLIER }, NOW)).toMatchObject({
        label: 'Sin pagar',
        tone: 'unpaid',
      })
    }
  })

  it('justo en el vencimiento ya cuenta como vencido (igual que la base: hold > now)', () => {
    expect(
      orderStatusView({ status: 'pending', hold_expires_at: NOW.toISOString() }, NOW).label,
    ).toBe('Sin pagar')
  })

  it('cada estado trae una explicación para el lector de pantalla', () => {
    for (const status of ['approved', 'refunded', 'pending', 'rejected'] as const) {
      expect(orderStatusView({ status, hold_expires_at: LATER }, NOW).hint.length).toBeGreaterThan(
        10,
      )
    }
  })
})

describe('holdExpired', () => {
  it('una fecha ilegible cuenta como vencida (nunca un «Pagando…» eterno)', () => {
    expect(holdExpired('no-es-fecha', NOW)).toBe(true)
    expect(holdExpired(LATER, NOW)).toBe(false)
  })
})

describe('attentionView', () => {
  it('los cuatro avisos con las palabras del pedido', () => {
    expect(attentionView('overbooked')?.label).toBe('Sobrecupo')
    expect(attentionView('event_missing')?.label).toBe('Sin fecha: cargá la reserva a mano')
    expect(attentionView('amount_mismatch')?.label).toBe('Monto distinto')
    expect(attentionView('duplicate_payment')?.label).toBe('Pago doble')
  })

  it('sin aviso: null', () => {
    expect(attentionView(null)).toBeNull()
    expect(attentionView(undefined)).toBeNull()
  })
})

describe('canRefund', () => {
  it('solo una compra pagada se puede devolver', () => {
    expect(canRefund({ status: 'approved' })).toBe(true)
    expect(canRefund({ status: 'refunded' })).toBe(false)
    expect(canRefund({ status: 'pending' })).toBe(false)
    expect(canRefund({ status: 'rejected' })).toBe(false)
  })
})

describe('orderAmountCents', () => {
  it('pagado: lo que cobró Mercado Pago', () => {
    expect(
      orderAmountCents({ status: 'approved', paid_cents: 1_000_000, total_cents: 1_000_000 }),
    ).toBe(1_000_000)
    // Pagó de menos (amount_mismatch): se muestra lo que entró de verdad.
    expect(
      orderAmountCents({ status: 'approved', paid_cents: 900_000, total_cents: 1_000_000 }),
    ).toBe(900_000)
  })

  it('sin pagar: lo que se iba a cobrar', () => {
    expect(orderAmountCents({ status: 'pending', paid_cents: null, total_cents: 2_000_000 })).toBe(
      2_000_000,
    )
    expect(orderAmountCents({ status: 'approved', paid_cents: null, total_cents: 2_000_000 })).toBe(
      2_000_000,
    )
  })

  it('devuelto: lo que se había cobrado', () => {
    expect(
      orderAmountCents({ status: 'refunded', paid_cents: 700_000, total_cents: 700_000 }),
    ).toBe(700_000)
  })
})

describe('textos de la fila', () => {
  it('seña o total', () => {
    expect(paymentOptionLabel('deposit')).toBe('Seña')
    expect(paymentOptionLabel('full')).toBe('Total')
  })

  it('la función como en la cartelera', () => {
    expect(orderFunctionLabel({ event_date: '2026-12-01', event_time: '21:00:00' })).toBe(
      'Mar 01 dic 21:00',
    )
  })

  it('personas en singular y plural', () => {
    expect(peopleLabel(1)).toBe('1 persona')
    expect(peopleLabel(4)).toBe('4 personas')
  })
})

describe('formatOrderMoment (reloj de Córdoba)', () => {
  it('hoy y ayer, con la hora del bar', () => {
    expect(formatOrderMoment('2026-10-26T20:42:00.000Z', NOW)).toBe('Hoy 17:42')
    expect(formatOrderMoment('2026-10-26T02:10:00.000Z', NOW)).toBe('Ayer 23:10')
  })

  it('a la medianoche UTC el día todavía es el anterior en Córdoba', () => {
    const lateNight = new Date('2026-10-27T02:30:00.000Z') // 23:30 del 26 en Córdoba
    expect(formatOrderMoment('2026-10-27T01:00:00.000Z', lateNight)).toBe('Hoy 22:00')
  })

  it('más viejo: día y mes; de otro año, con el año', () => {
    expect(formatOrderMoment('2026-10-24T21:42:00.000Z', NOW)).toBe('24/10 18:42')
    expect(formatOrderMoment('2025-12-24T21:42:00.000Z', NOW)).toBe('24/12/2025 18:42')
  })

  it('una fecha ilegible no rompe la fila', () => {
    expect(formatOrderMoment('nada', NOW)).toBe('—')
  })
})
