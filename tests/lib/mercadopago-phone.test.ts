import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPreference,
  MercadoPagoError,
  mercadoPagoPhone,
  type PreferenceInput,
} from '@/lib/mercadopago/client'

describe('mercadoPagoPhone', () => {
  it('celular argentino: sin el 9 y con la característica aparte', () => {
    expect(mercadoPagoPhone('+5493512345678')).toEqual({ area_code: '351', number: '2345678' })
    expect(mercadoPagoPhone('+5491155551234')).toEqual({ area_code: '11', number: '55551234' })
  })
  it('fijo argentino y de otro país', () => {
    expect(mercadoPagoPhone('+543514221234')).toEqual({ area_code: '351', number: '4221234' })
    expect(mercadoPagoPhone('+14155552671')).toEqual({ area_code: '415', number: '5552671' })
  })
  it('si no se puede partir se omite: el pago no depende del teléfono', () => {
    expect(mercadoPagoPhone('')).toBeUndefined()
    expect(mercadoPagoPhone('no es un teléfono')).toBeUndefined()
    expect(mercadoPagoPhone('+54')).toBeUndefined()
  })
})

describe('createPreference con teléfono', () => {
  const preference: PreferenceInput = {
    items: [{ id: 'x', title: 'Shrek 2', quantity: 2, currency_id: 'ARS', unit_price: 20000 }],
    payer: { name: 'Juan', phone: { area_code: '351', number: '5550000' } },
    back_urls: { success: 'https://x.test', pending: 'https://x.test', failure: 'https://x.test' },
    external_reference: 'pedido',
    expires: true,
  }
  const ok = { id: 'pref-1', init_point: 'https://www.mercadopago.com.ar/checkout?pref_id=pref-1' }

  function stubResponses(...responses: Array<{ status: number; body: unknown }>) {
    const calls: Array<{ body: PreferenceInput; key: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push({
          body: JSON.parse(String(init.body)) as PreferenceInput,
          key: (init.headers as Record<string, string>)['X-Idempotency-Key'] ?? '',
        })
        const res = responses[calls.length - 1] ?? { status: 500, body: {} }
        return new Response(JSON.stringify(res.body), { status: res.status })
      }),
    )
    return calls
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lo manda a Mercado Pago', async () => {
    const calls = stubResponses({ status: 201, body: ok })
    await expect(createPreference('token', preference, 'pedido')).resolves.toMatchObject(ok)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body.payer?.phone).toEqual({ area_code: '351', number: '5550000' })
  })

  it('si Mercado Pago lo rechaza, se crea sin teléfono y con otra clave', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const calls = stubResponses(
      { status: 400, body: { error: 'bad_request' } },
      { status: 201, body: ok },
    )
    await expect(createPreference('token', preference, 'pedido')).resolves.toMatchObject(ok)
    expect(calls).toHaveLength(2)
    expect(calls[1]?.body.payer).toEqual({ name: 'Juan' })
    expect(calls[1]?.key).toBe('pedido-sin-telefono')
  })

  it('otro error no se reintenta', async () => {
    const calls = stubResponses({ status: 401, body: { message: 'invalid token' } })
    await expect(createPreference('token', preference, 'pedido')).rejects.toBeInstanceOf(
      MercadoPagoError,
    )
    expect(calls).toHaveLength(1)
  })

  it('un 400 sin teléfono tampoco', async () => {
    const calls = stubResponses({ status: 400, body: {} })
    const { payer: _payer, ...sinPayer } = preference
    await expect(createPreference('token', sinPayer, 'pedido')).rejects.toBeInstanceOf(
      MercadoPagoError,
    )
    expect(calls).toHaveLength(1)
  })
})
