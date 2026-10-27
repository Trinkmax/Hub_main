import { afterEach, describe, expect, it, vi } from 'vitest'
import { MercadoPagoError, refundPayment } from '@/lib/mercadopago/client'

/**
 * «Devolver» del panel: la devolución total de un pago. Sin `amount` en el
 * cuerpo (Mercado Pago devuelve el total) y con clave de idempotencia, que
 * Mercado Pago exige.
 */

type FetchArgs = { url: string; init: RequestInit }

function mockFetch(handler: (args: FetchArgs) => { status: number; body: unknown }) {
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const res = handler({ url, init })
    return new Response(JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mercadopago.refundPayment', () => {
  it('POSTea la devolución total al pago, con token y clave de idempotencia', async () => {
    let captured: FetchArgs | null = null
    mockFetch((args) => {
      captured = args
      return {
        status: 201,
        body: { id: 9988776655, payment_id: 1234567890, amount: 5000, status: 'approved' },
      }
    })

    const refund = await refundPayment('APP_USR-token', '1234567890', 'clave-1')

    if (!captured) throw new Error('fetch no se llamó')
    const { url, init } = captured as FetchArgs
    expect(url).toBe('https://api.mercadopago.com/v1/payments/1234567890/refunds')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer APP_USR-token')
    expect(headers['X-Idempotency-Key']).toBe('clave-1')
    // Sin amount: total.
    expect(JSON.parse(String(init.body))).toEqual({})
    expect(refund).toEqual({
      id: '9988776655',
      payment_id: '1234567890',
      amount: 5000,
      status: 'approved',
    })
  })

  it('no llama a Mercado Pago con un id de pago que no es un número', async () => {
    const fetchFn = mockFetch(() => ({ status: 201, body: {} }))
    await expect(refundPayment('APP_USR-token', '12/../34', 'clave-1')).rejects.toBeInstanceOf(
      MercadoPagoError,
    )
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('un rechazo de Mercado Pago llega como MercadoPagoError con su estado', async () => {
    mockFetch(() => ({
      status: 400,
      body: { message: 'Insufficient balance', error: 'bad_request', status: 400 },
    }))
    const error = await refundPayment('APP_USR-token', '1234567890', 'clave-1').catch((e) => e)
    expect(error).toBeInstanceOf(MercadoPagoError)
    expect(error.status).toBe(400)
    expect(error.isAuth).toBe(false)
    expect(error.message).toBe('Insufficient balance')
  })

  it('un token que ya no sirve se reconoce como error de autenticación', async () => {
    mockFetch(() => ({ status: 401, body: { message: 'invalid access token' } }))
    const error = await refundPayment('APP_USR-token', '1234567890', 'clave-1').catch((e) => e)
    expect(error).toBeInstanceOf(MercadoPagoError)
    expect(error.isAuth).toBe(true)
  })
})
