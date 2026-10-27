import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Firma de los webhooks de Mercado Pago (`x-signature: ts=…,v1=…`).
 *
 * Es el mismo algoritmo que `WebhookSignatureValidator` del SDK oficial
 * (mercadopago@3.6.1, `dist/utils/webhook`), copiado acá para no sumar la
 * dependencia entera por una función:
 *
 *   manifest = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
 *   v1       = HMAC-SHA256(clave secreta de la aplicación, manifest) en hex
 *
 * Los pares que no vienen (sin `data.id`, sin `x-request-id`) se OMITEN del
 * manifest, no se dejan vacíos. La clave sale de «Tus integraciones →
 * Webhooks» de la aplicación del bar en Mercado Pago.
 *
 * Ojo: la firma solo prueba que el aviso salió de Mercado Pago. Lo que se hace
 * con el aviso se decide SIEMPRE con el pago que devuelve la API con el token
 * del bar (lib/ticketing/settle.ts), nunca con el cuerpo del webhook.
 */

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: 'missing_header' | 'malformed_header' | 'mismatch' }

export function parseSignatureHeader(header: string): { ts?: string; v1?: string } {
  let ts: string | undefined
  let v1: string | undefined
  for (const part of header.split(',')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim().toLowerCase()
    const value = part.slice(eq + 1).trim()
    if (!value) continue
    if (key === 'ts') ts = value
    else if (key === 'v1') v1 = value
  }
  return { ts, v1 }
}

export function buildSignatureManifest(input: {
  dataId?: string | null
  requestId?: string | null
  ts: string
}): string {
  const parts: string[] = []
  const dataId = input.dataId?.trim()
  const requestId = input.requestId?.trim()
  if (dataId) parts.push(`id:${dataId}`)
  if (requestId) parts.push(`request-id:${requestId}`)
  parts.push(`ts:${input.ts}`)
  return `${parts.join(';')};`
}

export function verifyWebhookSignature(input: {
  signatureHeader: string | null
  requestId: string | null
  dataId: string | null
  secret: string
}): SignatureCheck {
  const header = input.signatureHeader?.trim()
  if (!header) return { ok: false, reason: 'missing_header' }

  const { ts, v1 } = parseSignatureHeader(header)
  if (!ts || !v1 || !/^\d+$/.test(ts) || !/^[0-9a-f]+$/i.test(v1)) {
    return { ok: false, reason: 'malformed_header' }
  }

  const manifest = buildSignatureManifest({ dataId: input.dataId, requestId: input.requestId, ts })
  const expected = createHmac('sha256', input.secret).update(manifest).digest('hex')
  const received = v1.toLowerCase()

  // Comparación en tiempo constante; largos distintos ya es «no coincide».
  if (expected.length !== received.length) return { ok: false, reason: 'mismatch' }
  const same = timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  return same ? { ok: true } : { ok: false, reason: 'mismatch' }
}
