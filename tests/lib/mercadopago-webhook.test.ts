import { describe, expect, it } from 'vitest'
import { isPaymentId, parseNotification } from '@/lib/mercadopago/webhook'

const base = 'https://hubbar.com.ar/api/webhooks/mercadopago?t=23cf2e05-ea4d-4004-adcf-6b2346b7d676'

describe('parseNotification', () => {
  it('entiende el formato Webhooks (query + cuerpo)', () => {
    const url = new URL(`${base}&data.id=123456&type=payment`)
    const body = { type: 'payment', action: 'payment.updated', data: { id: '123456' }, id: 99 }
    expect(parseNotification(url, body)).toEqual({ topic: 'payment', dataId: '123456' })
  })

  it('entiende el formato IPN viejo (?topic=&id=)', () => {
    const url = new URL(`${base}&topic=payment&id=777`)
    expect(parseNotification(url, null)).toEqual({ topic: 'payment', dataId: '777' })
  })

  it('saca el id del resource cuando no viene en la query', () => {
    const url = new URL(base)
    const body = { topic: 'payment', resource: 'https://api.mercadopago.com/v1/payments/4242' }
    expect(parseNotification(url, body)).toEqual({ topic: 'payment', dataId: '4242' })
  })

  it('el id de arriba del cuerpo es del aviso: no se toma como pago', () => {
    const url = new URL(base)
    expect(parseNotification(url, { type: 'payment', id: 12345 })).toEqual({
      topic: 'payment',
      dataId: null,
    })
  })

  it('deduce el tipo de la acción si falta', () => {
    const url = new URL(base)
    const body = { action: 'payment.created', data: { id: 55 } }
    expect(parseNotification(url, body)).toEqual({ topic: 'payment', dataId: '55' })
  })

  it('merchant_order queda con su tipo (el handler lo ignora)', () => {
    const url = new URL(`${base}&topic=merchant_order&id=1`)
    expect(parseNotification(url, null).topic).toBe('merchant_order')
  })

  it('un cuerpo cualquiera no rompe', () => {
    expect(parseNotification(new URL(base), 'hola')).toEqual({ topic: null, dataId: null })
  })
})

describe('isPaymentId', () => {
  it('solo dígitos', () => {
    expect(isPaymentId('123456789')).toBe(true)
    expect(isPaymentId('12a')).toBe(false)
    expect(isPaymentId('../users/me')).toBe(false)
    expect(isPaymentId(null)).toBe(false)
  })
})
