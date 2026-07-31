import { buildWaMeUrl } from '@/lib/phone'

// Brazo "no-Google" del flujo de reseñas (ITEM 4, decisión del dueño): al que
// no puntúa 5★ lo mandamos a un WhatsApp con el detalle ya redactado, así el
// feedback llega a una persona y no se pierde en una tabla que nadie mira.
// PURO → testeable sin DB ni browser.

export type FeedbackWhatsappInput = {
  /** `tenants.feedback_whatsapp_phone` en E.164. Null = el dueño no lo cargó. */
  phone: string | null | undefined
  tenantName: string
  customerName: string
  rating: number
  comment: string | null | undefined
}

/** Texto que el cliente ve pre-cargado en WhatsApp (lo puede editar antes de enviar). */
export function buildFeedbackMessage(input: Omit<FeedbackWhatsappInput, 'phone'>): string {
  const stars = `${input.rating} ${input.rating === 1 ? 'estrella' : 'estrellas'}`
  const name = input.customerName.trim() || 'un cliente'
  const lines = [`Hola ${input.tenantName}! Soy ${name} y les puse ${stars} en la reseña.`]
  const comment = input.comment?.trim()
  lines.push(comment ? `Esto fue lo que puse: “${comment}”` : 'Les cuento qué me pasó:')
  return lines.join('\n\n')
}

/**
 * `https://wa.me/<solo dígitos>?text=<urlencoded>`. Devuelve null si no hay
 * número cargado — preferimos no mostrar el botón antes que mostrar uno roto.
 */
export function buildFeedbackWhatsappUrl(input: FeedbackWhatsappInput): string | null {
  const phone = input.phone?.trim()
  if (!phone) return null
  return buildWaMeUrl(phone, buildFeedbackMessage(input))
}
