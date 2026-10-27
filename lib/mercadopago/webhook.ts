import { z } from 'zod'

/**
 * De qué habla un aviso de Mercado Pago.
 *
 * Llegan con dos formas según el origen: la de Webhooks (`?type=payment&
 * data.id=123` + cuerpo `{ type, action, data: { id } }`) y la vieja de IPN
 * (`?topic=payment&id=123`, a veces con `resource` en el cuerpo). Se aceptan
 * las dos; lo único que importa es el tipo y el id del pago, porque después se
 * le pregunta el pago a la API (el cuerpo no se usa para decidir nada).
 */

export type MercadoPagoNotification = {
  topic: string | null
  /** El `data.id` tal cual: es lo que entra en el manifest de la firma. */
  dataId: string | null
}

const bodySchema = z
  .object({
    type: z.string().optional(),
    topic: z.string().optional(),
    action: z.string().optional(),
    data: z
      .object({ id: z.union([z.string(), z.number()]).optional() })
      .partial()
      .optional(),
    resource: z.string().optional(),
  })
  .partial()

function lastPathSegment(resource: string): string | null {
  const match = /(\d{1,24})\/?$/.exec(resource.trim())
  return match?.[1] ?? null
}

export function parseNotification(url: URL, body: unknown): MercadoPagoNotification {
  const parsed = bodySchema.safeParse(body)
  const b = parsed.success ? parsed.data : {}

  const topic =
    url.searchParams.get('type') ??
    url.searchParams.get('topic') ??
    b.type ??
    b.topic ??
    (b.action?.startsWith('payment.') ? 'payment' : null)

  // El `id` de arriba del cuerpo es el del AVISO, no el del pago: no sirve.
  const fromQuery = url.searchParams.get('data.id') ?? url.searchParams.get('id')
  const fromBody =
    b.data?.id !== undefined ? String(b.data.id) : b.resource ? lastPathSegment(b.resource) : null

  return { topic, dataId: fromQuery ?? fromBody }
}

/** Ids de pago de Mercado Pago: solo dígitos. */
export function isPaymentId(id: string | null): id is string {
  return id !== null && /^\d{1,24}$/.test(id)
}
