import { z } from 'zod'

/**
 * Lo que se dicen el navegador y el servidor cuando alguien charla con Tex. Puro: lo usan la ruta,
 * el ciclo, el panel y los tests.
 *
 * El servidor manda eventos por SSE (`data: {json}\n\n`), uno por renglón de lo que va pasando, para
 * que Tex se mueva con lo que está haciendo de verdad, no con una animación de relleno.
 */

// ─── Lo que pide el navegador ────────────────────────────────────────────────

export const TEX_MESSAGE_MAX = 4000
export const TEX_SCREEN_TEXT_MAX = 6000

export const texScreenSchema = z.object({
  /** La ruta con su `?`, sin el dominio. */
  path: z.string().trim().min(1).max(600),
  title: z.string().trim().max(200).default(''),
  /** Lo que se lee en pantalla: Tex ve lo mismo que la persona. */
  text: z.string().max(TEX_SCREEN_TEXT_MAX).default(''),
})
export type TexScreen = z.infer<typeof texScreenSchema>

/** Una foto o un PDF para que Tex lo lea. Con 3,3 MB entra en un pedido de Vercel (4,5 MB en base64). */
export const TEX_ATTACHMENT_MAX_BASE64 = 4_400_000

export const texAttachmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  data: z.string().min(1).max(TEX_ATTACHMENT_MAX_BASE64),
})
export type TexAttachment = z.infer<typeof texAttachmentSchema>

export const texDecisionSchema = z.object({
  actionId: z.uuid(),
  approve: z.boolean(),
})
export type TexDecision = z.infer<typeof texDecisionSchema>

export const texRequestSchema = z
  .object({
    threadId: z.uuid().nullable().default(null),
    /** Lo que escribió la persona. */
    message: z.string().trim().min(1).max(TEX_MESSAGE_MAX).nullable().default(null),
    /** Lo que decidió sobre los tiques que tiene adelante. */
    decisions: z.array(texDecisionSchema).max(12).default([]),
    /** Seguir un turno que se cortó (o que el servidor pidió seguir por tiempo). */
    resume: z.boolean().default(false),
    /** «Charla nueva»: no sigue la anterior aunque esté reciente. */
    fresh: z.boolean().default(false),
    screen: texScreenSchema.nullable().default(null),
    attachment: texAttachmentSchema.nullable().default(null),
  })
  .refine((v) => v.message !== null || v.decisions.length > 0 || v.resume, {
    message: 'No hay nada para hacer.',
  })
export type TexRequest = z.infer<typeof texRequestSchema>

// ─── El tique: lo que Tex quiere hacer, antes y después de hacerlo ───────────

export const TEX_ACTION_STATUSES = [
  'pending',
  'done',
  'failed',
  'declined',
  'superseded',
  'undone',
] as const
export type TexActionStatus = (typeof TEX_ACTION_STATUSES)[number]

export type TexTicketRow = { label: string; value: string }

export type TexEntryLine = { account: string; debit: string | null; credit: string | null }

export type TexTicketWarning = { key: string; title: string; body: string | null }

export type TexTicketResult = {
  message: string
  /** Dónde quedó: a dónde lleva Tex para mostrarlo. */
  href: string | null
  /** Con qué se señala en esa pantalla. */
  point: string | null
  /** Hasta cuándo se puede deshacer con un toque (ISO). `null`: no se puede. */
  undoUntil: string | null
  /** El comprobante que quedó, para sumarle la foto. */
  documentId?: string | null
}

/**
 * Lo que el botón del tique abre en el mismo toque: el chat de WhatsApp del proveedor con el mensaje
 * escrito. Si se abriera al volver del servidor, el celular bloquearía la ventana. Sin número (`href`
 * null), el botón copia el mensaje. Solo mientras el tique espera: decidido, se borra.
 */
export type TexTicketSend = { href: string | null; text: string }

export type TexTicket = {
  actionId: string
  kind: string
  /** «Compra», «Pago», «Asiento»: lo que se ve grande. */
  title: string
  /** «Hielo Cristal · Factura A 0003-00012345». */
  subtitle: string | null
  rows: TexTicketRow[]
  total: TexTicketRow | null
  /** El asiento que va a quedar, para quien quiera mirarlo. */
  entry: TexEntryLine[]
  warnings: TexTicketWarning[]
  /** El botón: «Cargar la compra». */
  confirmLabel: string
  /** El botón abre WhatsApp (o copia el mensaje) además de confirmar. */
  send?: TexTicketSend | null
  status: TexActionStatus
  result: TexTicketResult | null
  error: string | null
}

/**
 * Se confirma solo con el botón: abre WhatsApp en el mismo toque. Un «sí» escrito o «Hacer los N» lo
 * marcarían enviado sin abrir el chat.
 */
export function texTicketNeedsTap(ticket: Pick<TexTicket, 'send'>): boolean {
  return Boolean(ticket.send)
}

/** Ya decidido: lo que iba a abrir el botón no hace falta, y trae el teléfono del proveedor. */
export function settledTicket(ticket: TexTicket): TexTicket {
  return ticket.send ? { ...ticket, send: null } : ticket
}

// ─── Lo que manda el servidor ────────────────────────────────────────────────

export type TexMood = 'listening' | 'thinking' | 'reading' | 'working' | 'happy' | 'sad'

export type TexGuideStep = {
  /** A dónde ir antes de señalar (`null`: se queda en la pantalla). */
  href: string | null
  /** El texto de lo que se señala: un botón, una columna, un título. */
  point: string | null
  note: string
}

export type TexEvent =
  | { type: 'thread'; threadId: string; fresh: boolean }
  | { type: 'mood'; mood: TexMood }
  | { type: 'text'; delta: string }
  /** Una cosa que está haciendo: «Miré la caja». */
  | { type: 'step'; id: string; label: string; state: 'running' | 'done' | 'error' }
  | { type: 'ticket'; ticket: TexTicket }
  | { type: 'navigate'; href: string; label: string }
  | { type: 'point'; text: string; note: string | null }
  | { type: 'guide'; title: string; steps: TexGuideStep[] }
  /** Se escribió algo en la base: el navegador tiene que volver a leer la pantalla. */
  | { type: 'refresh' }
  /** Faltó tiempo en este pedido: el navegador lo sigue solo. */
  | { type: 'continue' }
  | { type: 'error'; message: string; retry: boolean; restart?: boolean }
  | { type: 'done'; waiting: boolean }

export function encodeTexEvent(event: TexEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/**
 * Lee los eventos de lo que llegó hasta ahora y devuelve lo que sobró para el próximo pedazo. Tolera
 * un evento cortado a la mitad: es lo normal en un stream.
 */
export function parseTexEvents(buffer: string): { events: TexEvent[]; rest: string } {
  const events: TexEvent[] = []
  let rest = buffer
  let cut = rest.indexOf('\n\n')
  while (cut !== -1) {
    const chunk = rest.slice(0, cut)
    rest = rest.slice(cut + 2)
    cut = rest.indexOf('\n\n')
    if (!chunk.startsWith('data: ')) continue
    try {
      events.push(JSON.parse(chunk.slice(6)) as TexEvent)
    } catch {
      // Un evento roto no puede tirar la charla.
    }
  }
  return { events, rest }
}

// ─── Lo que se dibuja de una charla ──────────────────────────────────────────

export type TexDisplayStep = { id: string; label: string; state: 'running' | 'done' | 'error' }

export type TexDisplayItem =
  | { kind: 'user'; id: string; text: string; attachment?: string | null }
  | { kind: 'tex'; id: string; text: string; steps: TexDisplayStep[] }
  | { kind: 'ticket'; id: string; ticket: TexTicket }

export type TexHistory = {
  threadId: string | null
  items: TexDisplayItem[]
}
