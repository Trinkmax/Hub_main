import { afterEach, describe, expect, it, vi } from 'vitest'
import { paymentMethodLine, paymentTypeLabel } from '@/lib/ticketing/copy'
import { clearLastOrder, readLastOrder, saveLastOrder } from '@/lib/ticketing/last-order'
import {
  canConfirmTransfer,
  isManualTransfer,
  MANUAL_TRANSFER,
  transferPaymentId,
  transferReservationComment,
  voidedReservationComment,
} from '@/lib/ticketing/transfer'

// 21:00 del 04/11 en Córdoba.
const NOW = new Date('2026-11-05T00:00:00.000Z')

describe('canConfirmTransfer', () => {
  it('lo que no se pagó, aunque ya se haya vencido el lugar', () => {
    expect(canConfirmTransfer({ status: 'rejected', event_date: '2026-11-20' }, NOW)).toBe(true)
    expect(canConfirmTransfer({ status: 'pending', event_date: '2026-11-20' }, NOW)).toBe(true)
  })
  it('lo ya pagado o anulado, no', () => {
    expect(canConfirmTransfer({ status: 'approved', event_date: '2026-11-20' }, NOW)).toBe(false)
    expect(canConfirmTransfer({ status: 'refunded', event_date: '2026-11-20' }, NOW)).toBe(false)
  })
  it('hasta el día de la función, en el reloj del bar', () => {
    expect(canConfirmTransfer({ status: 'rejected', event_date: '2026-11-04' }, NOW)).toBe(true)
    expect(canConfirmTransfer({ status: 'rejected', event_date: '2026-11-03' }, NOW)).toBe(false)
  })
})

describe('la marca de la transferencia', () => {
  it('siempre el mismo número para una compra: confirmar dos veces no es un cobro doble', () => {
    expect(transferPaymentId('abc')).toBe(transferPaymentId('abc'))
    expect(transferPaymentId('abc')).toBe('manual_transfer-abc')
  })
  it('el comprobante dice cómo se pagó', () => {
    expect(isManualTransfer(MANUAL_TRANSFER)).toBe(true)
    expect(isManualTransfer('credit_card')).toBe(false)
    expect(isManualTransfer(null)).toBe(false)
    expect(paymentTypeLabel(MANUAL_TRANSFER)).toBe('Transferencia')
    expect(paymentMethodLine(MANUAL_TRANSFER)).toBe('Transferencia')
    expect(paymentMethodLine('credit_card')).toBe('Tarjeta de crédito · Mercado Pago')
  })
})

describe('el comentario de la reserva', () => {
  it('dice transferencia, no Mercado Pago', () => {
    expect(
      transferReservationComment(
        'Pagó online con Mercado Pago una seña de $ 40.000. Resta cobrar $ 50.000.',
      ),
    ).toBe('Pagó por transferencia una seña de $ 40.000. Resta cobrar $ 50.000.')
    expect(
      voidedReservationComment(
        'Mercado Pago devolvió el pago de esta reserva. Pagó por transferencia una seña.',
      ),
    ).toBe('Se anuló la transferencia de esta reserva. Pagó por transferencia una seña.')
  })
})

describe('la última compra de este celular', () => {
  function stubStorage() {
    const data = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => data.set(k, v),
        removeItem: (k: string) => data.delete(k),
      },
    })
    return data
  }
  const AT = 1_000_000

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('se recuerda en esa película, por unas horas', () => {
    stubStorage()
    saveLastOrder('shrek-2', 'pedido-1', AT)
    expect(readLastOrder('shrek-2', AT + 60_000)).toBe('pedido-1')
    expect(readLastOrder('coraline', AT + 60_000)).toBeNull()
    expect(readLastOrder('shrek-2', AT + 4 * 60 * 60_000)).toBeNull()
  })
  it('se olvida al pagar', () => {
    stubStorage()
    saveLastOrder('shrek-2', 'pedido-1', AT)
    clearLastOrder()
    expect(readLastOrder('shrek-2', AT)).toBeNull()
  })
  it('algo ilegible o sin almacenamiento no rompe la página', () => {
    const data = stubStorage()
    data.set('hub-entradas-last-order', 'no es json')
    expect(readLastOrder('shrek-2', AT)).toBeNull()
    vi.unstubAllGlobals()
    vi.stubGlobal('window', {})
    expect(readLastOrder('shrek-2', AT)).toBeNull()
    expect(() => saveLastOrder('shrek-2', 'x')).not.toThrow()
    expect(() => clearLastOrder()).not.toThrow()
  })
})
