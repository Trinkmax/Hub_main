import { NextResponse } from 'next/server'
import { getRequestIp } from '@/lib/ip'
import { MercadoPagoError } from '@/lib/mercadopago/client'
import { verifyWebhookSignature } from '@/lib/mercadopago/signature'
import { isPaymentId, parseNotification } from '@/lib/mercadopago/webhook'
import { RateLimitedError, rateLimit } from '@/lib/rate-limit'
import { getMercadoPagoCredentials } from '@/lib/ticketing/credentials'
import { reconcilePaymentById } from '@/lib/ticketing/settle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Avisos de pago de Mercado Pago para las entradas online.
 *
 * Cada preferencia manda su `notification_url` con el bar adentro
 * (`?t=<tenant_id>`): así sabemos con qué cuenta preguntar, porque cada bar
 * cobra en la suya. Lo que se hace con el aviso se decide SIEMPRE con el pago
 * que devuelve la API con el token del bar (lib/ticketing/settle.ts): un aviso
 * falso no puede crear una reserva, como mucho hace que preguntemos.
 *
 * La firma (`x-signature`) se valida cuando el bar cargó la clave secreta de
 * los webhooks: si viene firmado y no coincide, 401. Sin clave cargada se
 * acepta igual (la API es la que manda).
 *
 * Respuestas: 200 a todo lo que no hay que reintentar (incluido lo que no es
 * un pago); 500 si falló algo nuestro o de Mercado Pago, así lo reintenta
 * (cada 15 minutos, según su documentación).
 */
export async function POST(request: Request) {
  const ip = await getRequestIp()
  try {
    rateLimit({ key: `mp-webhook:${ip}`, limit: 240, windowMs: 60_000 })
  } catch (e) {
    if (e instanceof RateLimitedError) return new NextResponse('slow down', { status: 429 })
    throw e
  }

  const url = new URL(request.url)
  const tenantId = url.searchParams.get('t')
  if (!tenantId || !UUID_RE.test(tenantId)) {
    return NextResponse.json({ ok: false, error: 'missing_tenant' }, { status: 400 })
  }

  let body: unknown = null
  try {
    const text = await request.text()
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }

  const notification = parseNotification(url, body)
  if (notification.topic !== 'payment' || !isPaymentId(notification.dataId)) {
    // merchant_order y compañía: no hace falta (el pago trae todo).
    return NextResponse.json({ ok: true, ignored: true })
  }

  let creds: Awaited<ReturnType<typeof getMercadoPagoCredentials>>
  try {
    creds = await getMercadoPagoCredentials(tenantId)
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
  // Bar sin cuenta conectada (la desconectaron): nada que hacer, sin reintentos.
  if (!creds) return NextResponse.json({ ok: true, ignored: true })

  if (creds.webhookSecret) {
    const signature = request.headers.get('x-signature')
    if (signature) {
      const check = verifyWebhookSignature({
        signatureHeader: signature,
        requestId: request.headers.get('x-request-id'),
        dataId: notification.dataId,
        secret: creds.webhookSecret,
      })
      if (!check.ok) {
        console.error('[webhook.mercadopago] firma inválida', { tenantId, reason: check.reason })
        return new NextResponse('invalid signature', { status: 401 })
      }
    }
  }

  try {
    const outcome = await reconcilePaymentById({
      tenantId,
      paymentId: notification.dataId,
      source: 'webhook',
    })
    return NextResponse.json({ ok: true, outcome: outcome.kind })
  } catch (error) {
    // 404 de Mercado Pago = ese pago no es de esta cuenta: no reintentar.
    if (error instanceof MercadoPagoError && error.status === 404) {
      return NextResponse.json({ ok: true, ignored: true })
    }
    console.error('[webhook.mercadopago] no pudimos aplicar el pago', {
      tenantId,
      error: error instanceof Error ? error.message : 'unknown',
    })
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
