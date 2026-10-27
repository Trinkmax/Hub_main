import 'server-only'
import { z } from 'zod'

/**
 * Cliente mínimo de la API de Mercado Pago (Checkout Pro).
 *
 * `fetch` directo, igual que la integración con Meta (lib/meta/http.ts): son
 * cuatro llamadas y el SDK oficial arrastra mucho más de lo que se usa. Cada
 * respuesta pasa por zod: lo que Mercado Pago devuelve es un borde más
 * (CLAUDE.md §6) y un cambio de forma tiene que fallar fuerte, no a medias.
 *
 * Cada bar cobra en SU cuenta: todas las funciones reciben el access token del
 * bar (descifrado en lib/ticketing/credentials.ts). Nunca se loguea.
 */

const API = 'https://api.mercadopago.com'
const TIMEOUT_MS = 12_000

export class MercadoPagoError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.name = 'MercadoPagoError'
    this.status = status
    this.code = code
  }

  /** El token no sirve (vencido, revocado o mal copiado). */
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403
  }
}

const errorBodySchema = z
  .object({
    message: z.string().optional(),
    error: z.string().optional(),
    status: z.union([z.number(), z.string()]).optional(),
  })
  .partial()

async function mpFetch(
  path: string,
  init: { token: string; method?: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string },
): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${init.token}`,
  }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (init.idempotencyKey) headers['X-Idempotency-Key'] = init.idempotencyKey

  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    const timeout = error instanceof Error && error.name === 'TimeoutError'
    throw new MercadoPagoError(0, timeout ? 'timeout' : 'network', 'Mercado Pago no respondió.')
  }

  const text = await res.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!res.ok) {
    const parsed = errorBodySchema.safeParse(payload)
    const code = parsed.success ? (parsed.data.error ?? null) : null
    const message = parsed.success
      ? (parsed.data.message ?? `HTTP ${res.status}`)
      : `HTTP ${res.status}`
    throw new MercadoPagoError(res.status, code, message)
  }
  return payload
}

// ──────────────────────────────────────────────
// Cuenta
// ──────────────────────────────────────────────

const accountSchema = z.object({
  id: z.coerce.number().int(),
  nickname: z.string().nullish(),
  site_id: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
})

export type MercadoPagoAccount = {
  id: number
  nickname: string | null
  siteId: string | null
  /** false = credenciales de prueba o usuario de prueba (sandbox). */
  live: boolean
}

/** Para validar un token al conectarlo: devuelve de quién es la cuenta. */
export async function getAccount(token: string): Promise<MercadoPagoAccount> {
  const data = accountSchema.parse(await mpFetch('/users/me', { token }))
  const tags = data.tags ?? []
  return {
    id: data.id,
    nickname: data.nickname ?? null,
    siteId: data.site_id ?? null,
    live: !token.startsWith('TEST-') && !tags.includes('test_user'),
  }
}

// ──────────────────────────────────────────────
// Preferencias (Checkout Pro)
// ──────────────────────────────────────────────

export type PreferenceInput = {
  items: Array<{
    id: string
    title: string
    description?: string
    picture_url?: string
    category_id?: string
    quantity: number
    currency_id: 'ARS'
    unit_price: number
  }>
  payer?: { name?: string; surname?: string }
  back_urls: { success: string; pending: string; failure: string }
  auto_return?: 'approved'
  notification_url?: string
  external_reference: string
  expires: boolean
  expiration_date_from?: string
  expiration_date_to?: string
  binary_mode?: boolean
  statement_descriptor?: string
  payment_methods?: {
    excluded_payment_types?: Array<{ id: string }>
    installments?: number
  }
  metadata?: Record<string, string>
}

const preferenceSchema = z.object({
  id: z.string(),
  init_point: z.string().url(),
  sandbox_init_point: z.string().url().nullish(),
})

export type Preference = z.infer<typeof preferenceSchema>

export async function createPreference(
  token: string,
  input: PreferenceInput,
  idempotencyKey: string,
): Promise<Preference> {
  const data = await mpFetch('/checkout/preferences', {
    token,
    method: 'POST',
    body: input,
    idempotencyKey,
  })
  return preferenceSchema.parse(data)
}

// ──────────────────────────────────────────────
// Pagos
// ──────────────────────────────────────────────

const paymentSchema = z.object({
  id: z.union([z.number(), z.string()]).transform((v) => String(v)),
  status: z.string(),
  status_detail: z.string().nullish(),
  external_reference: z.string().nullish(),
  transaction_amount: z.number().nullish(),
  currency_id: z.string().nullish(),
  date_approved: z.string().nullish(),
  date_created: z.string().nullish(),
  payment_type_id: z.string().nullish(),
  live_mode: z.boolean().nullish(),
})

export type MercadoPagoPayment = z.infer<typeof paymentSchema>

export async function getPayment(token: string, paymentId: string): Promise<MercadoPagoPayment> {
  if (!/^\d{1,24}$/.test(paymentId)) {
    throw new MercadoPagoError(400, 'invalid_payment_id', 'Id de pago inválido.')
  }
  return paymentSchema.parse(await mpFetch(`/v1/payments/${paymentId}`, { token }))
}

// ──────────────────────────────────────────────
// Devoluciones
// ──────────────────────────────────────────────

const refundSchema = z.object({
  id: z.union([z.number(), z.string()]).transform((v) => String(v)),
  payment_id: z
    .union([z.number(), z.string()])
    .transform((v) => String(v))
    .nullish(),
  amount: z.number().nullish(),
  status: z.string().nullish(),
})

export type MercadoPagoRefund = z.infer<typeof refundSchema>

/**
 * Devuelve el pago ENTERO (sin `amount`, Mercado Pago devuelve el total).
 *
 * La clave de idempotencia es nueva en cada intento: Mercado Pago la exige y
 * guarda la respuesta del primer pedido, así que con una clave fija por pedido
 * un rechazo (sin saldo disponible, por ejemplo) quedaría pegado para siempre.
 * Devolver dos veces no puede pasar: un pago ya devuelto entero no admite otra
 * devolución total.
 */
export async function refundPayment(
  token: string,
  paymentId: string,
  idempotencyKey: string,
): Promise<MercadoPagoRefund> {
  if (!/^\d{1,24}$/.test(paymentId)) {
    throw new MercadoPagoError(400, 'invalid_payment_id', 'Id de pago inválido.')
  }
  const data = await mpFetch(`/v1/payments/${paymentId}/refunds`, {
    token,
    method: 'POST',
    body: {},
    idempotencyKey,
  })
  return refundSchema.parse(data)
}

const searchSchema = z.object({
  results: z.array(paymentSchema).default([]),
})

/**
 * Los pagos de un pedido, del más nuevo al más viejo. Es la red de seguridad
 * cuando el webhook no llega (o tarda): la entrada del cliente pregunta por
 * su pedido en vez de esperar sentada.
 */
export async function searchPaymentsByReference(
  token: string,
  externalReference: string,
): Promise<MercadoPagoPayment[]> {
  const qs = new URLSearchParams({
    external_reference: externalReference,
    sort: 'date_created',
    criteria: 'desc',
    limit: '10',
  })
  const data = searchSchema.parse(await mpFetch(`/v1/payments/search?${qs.toString()}`, { token }))
  return data.results
}
