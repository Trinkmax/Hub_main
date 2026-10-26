import { describe, expect, it } from 'vitest'
import {
  buildSignatureManifest,
  parseSignatureHeader,
  verifyWebhookSignature,
} from '@/lib/mercadopago/signature'

// Los v1 esperados se calcularon con el validador del SDK oficial
// (mercadopago@3.6.1, WebhookSignatureValidator.validate los aceptó): son un
// oráculo independiente de esta implementación.
const SECRET = 'f3a1b2c4d5e6f708192a3b4c5d6e7f80'
const DATA_ID = '123456789012'
const REQUEST_ID = 'bb56a2f1-6aae-46ac-982e-9dcd3581d08e'
const TS = '1742505638683'
const V1 = '9dbc74ce5e1b6689d061353000aa2fbb30ea51854357dda5ca9111ecdec621f0'
const V1_WITHOUT_REQUEST_ID = 'd8c6c62c7d383373f2edfc45b90b99c674b0d3ad74ee1be9e284bf517842695c'

describe('firma de los webhooks de Mercado Pago', () => {
  it('arma el manifest como el SDK', () => {
    expect(buildSignatureManifest({ dataId: DATA_ID, requestId: REQUEST_ID, ts: TS })).toBe(
      `id:${DATA_ID};request-id:${REQUEST_ID};ts:${TS};`,
    )
  })

  it('omite los pares que no vienen (no los deja vacíos)', () => {
    expect(buildSignatureManifest({ dataId: DATA_ID, requestId: null, ts: TS })).toBe(
      `id:${DATA_ID};ts:${TS};`,
    )
    expect(buildSignatureManifest({ dataId: '', requestId: '  ', ts: TS })).toBe(`ts:${TS};`)
  })

  it('lee ts y v1 del header en cualquier orden y con espacios', () => {
    expect(parseSignatureHeader(`v1=${V1}, ts=${TS}`)).toEqual({ ts: TS, v1: V1 })
  })

  it('acepta una firma buena', () => {
    expect(
      verifyWebhookSignature({
        signatureHeader: `ts=${TS},v1=${V1}`,
        requestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
      }),
    ).toEqual({ ok: true })
  })

  it('acepta una firma buena sin x-request-id', () => {
    expect(
      verifyWebhookSignature({
        signatureHeader: `ts=${TS},v1=${V1_WITHOUT_REQUEST_ID}`,
        requestId: null,
        dataId: DATA_ID,
        secret: SECRET,
      }),
    ).toEqual({ ok: true })
  })

  it('rechaza si cambia el pago, el request o la clave', () => {
    const base = { signatureHeader: `ts=${TS},v1=${V1}`, requestId: REQUEST_ID, secret: SECRET }
    expect(verifyWebhookSignature({ ...base, dataId: '999' })).toEqual({
      ok: false,
      reason: 'mismatch',
    })
    expect(verifyWebhookSignature({ ...base, dataId: DATA_ID, requestId: 'otro' })).toEqual({
      ok: false,
      reason: 'mismatch',
    })
    expect(verifyWebhookSignature({ ...base, dataId: DATA_ID, secret: 'otra-clave' })).toEqual({
      ok: false,
      reason: 'mismatch',
    })
  })

  it('distingue header ausente de header roto', () => {
    const base = { requestId: REQUEST_ID, dataId: DATA_ID, secret: SECRET }
    expect(verifyWebhookSignature({ ...base, signatureHeader: null })).toEqual({
      ok: false,
      reason: 'missing_header',
    })
    expect(verifyWebhookSignature({ ...base, signatureHeader: 'v1=abc' })).toEqual({
      ok: false,
      reason: 'malformed_header',
    })
    expect(verifyWebhookSignature({ ...base, signatureHeader: `ts=ayer,v1=${V1}` })).toEqual({
      ok: false,
      reason: 'malformed_header',
    })
  })
})
