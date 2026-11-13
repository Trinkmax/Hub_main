/**
 * Lo que todavía no llegó al servidor — PURO.
 *
 * Un pedido no se puede perder. Lo que el mozo está armando (el borrador) y lo que ya mandó pero el
 * servidor no confirmó (la bandeja de salida) se guardan en el celular, por mesa. Cada tanda viaja
 * con su clave: reintentar nunca duplica, porque el servidor reconoce la clave y devuelve la misma
 * tanda.
 *
 * Este archivo decide: cómo se guarda y se lee, cuándo toca reintentar y qué respuesta del servidor
 * es «todavía no» (se reintenta sola) y cuál es «así no» (vuelve al borrador para corregir).
 * No toca `localStorage` ni el reloj: recibe y devuelve datos.
 */
import { z } from 'zod'
import type { OrderLineInput } from '@/lib/pos/types'
import { type Draft, type DraftLine, EMPTY_DRAFT, type PricedLine } from './cart'

export const STORAGE_PREFIX = 'hub:pos:order:'
export const STORAGE_VERSION = 1

/** Un borrador abandonado deja de ofrecerse pasada una noche larga. */
export const DRAFT_TTL_MS = 18 * 60 * 60 * 1000
/** Lo guardado de mesas viejas se limpia a los dos días (solo si no quedó nada sin enviar). */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000

export function storageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`
}

/** Un renglón tal como se vio al mandarlo: para dibujar la tanda mientras no hay respuesta. */
export type OutboxLine = OrderLineInput & {
  name: string
  unit_cents: number
  modifiers: { id: string; label: string; delta_cents: number }[]
}

export type OutboxEntry = {
  /** La clave de idempotencia de la tanda. */
  key: string
  lines: OutboxLine[]
  /** true = sale a cocina · false = queda en espera («después»). */
  fire: boolean
  course: number
  createdAt: number
  /** Intentos fallidos hasta ahora. */
  attempts: number
  /** Por qué falló el último: sin red, o el servidor contestó con un error que puede pasar. */
  lastFailure: 'network' | 'server' | null
  lastError: string | null
  /** No reintentar antes de esto. */
  nextAttemptAt: number
}

export function makeEntry(input: {
  key: string
  lines: readonly PricedLine[]
  fire: boolean
  course: number
  now: number
}): OutboxEntry {
  return {
    key: input.key,
    lines: input.lines.map(({ line, name, unit_cents, modifiers }) => ({
      menu_item_id: line.menu_item_id,
      quantity: line.quantity,
      option_ids: [...line.option_ids],
      notes: line.notes,
      name,
      unit_cents,
      modifiers,
    })),
    fire: input.fire,
    course: input.course,
    createdAt: input.now,
    attempts: 0,
    lastFailure: null,
    lastError: null,
    nextAttemptAt: input.now,
  }
}

export function entryTotalCents(entry: Pick<OutboxEntry, 'lines'>): number {
  return entry.lines.reduce((sum, line) => sum + line.unit_cents * line.quantity, 0)
}

export function entryUnits(entry: Pick<OutboxEntry, 'lines'>): number {
  return entry.lines.reduce((sum, line) => sum + line.quantity, 0)
}

/** Lo que viaja al servidor de una tanda guardada. */
export function entryOrderLines(entry: Pick<OutboxEntry, 'lines'>): OrderLineInput[] {
  return entry.lines.map((line) => ({
    menu_item_id: line.menu_item_id,
    quantity: line.quantity,
    option_ids: [...line.option_ids],
    notes: line.notes,
  }))
}

/** Los renglones de una tanda rebotada, para devolverlos al borrador. */
export function entryDraftLines(entry: Pick<OutboxEntry, 'lines'>): Omit<DraftLine, 'key'>[] {
  return entry.lines.map((line) => ({
    menu_item_id: line.menu_item_id,
    quantity: line.quantity,
    option_ids: [...line.option_ids],
    notes: line.notes,
  }))
}

// ─── Guardar y leer ──────────────────────────────────────────────────────────

const lineSchema = z.object({
  menu_item_id: z.string().min(1),
  quantity: z.number().int().min(1).max(99),
  option_ids: z.array(z.string()).max(12),
  notes: z.string().max(200).nullable(),
})

const storedSchema = z.object({
  v: z.literal(STORAGE_VERSION),
  savedAt: z.number(),
  label: z.string().max(60).nullish(),
  draft: z
    .object({
      key: z.string().min(8),
      lines: z.array(lineSchema.extend({ key: z.string().min(1) })).max(80),
    })
    .nullable(),
  outbox: z
    .array(
      z.object({
        key: z.string().min(8),
        lines: z
          .array(
            lineSchema.extend({
              name: z.string(),
              unit_cents: z.number(),
              modifiers: z.array(
                z.object({ id: z.string(), label: z.string(), delta_cents: z.number() }),
              ),
            }),
          )
          .min(1)
          .max(80),
        fire: z.boolean(),
        course: z.number().int().min(1).max(9),
        createdAt: z.number(),
        attempts: z.number().int().min(0),
        lastFailure: z.enum(['network', 'server']).nullable(),
        lastError: z.string().nullable(),
        nextAttemptAt: z.number(),
      }),
    )
    .max(20),
})

export type StoredOrder = {
  draft: Draft
  outbox: OutboxEntry[]
  /** «Mesa 12»: para poder nombrar la mesa cuando la tanda sale (o rebota) desde otra pantalla. */
  label?: string | null
}

export const NOTHING_STORED: StoredOrder = { draft: EMPTY_DRAFT, outbox: [] }

/** `null` = no hay nada que valga la pena guardar (se borra la entrada). */
export function serializeOrder(order: StoredOrder, now: number): string | null {
  const draft = order.draft.key && order.draft.lines.length > 0 ? order.draft : null
  if (!draft && order.outbox.length === 0) return null
  return JSON.stringify({
    v: STORAGE_VERSION,
    savedAt: now,
    label: order.label ?? null,
    draft,
    outbox: order.outbox,
  })
}

/**
 * Lee lo guardado. Tolera cualquier cosa (otra versión, un JSON roto): en la duda, nada. Lo que
 * estaba por enviarse vuelve listo para intentar ya: quedó a medias cuando se cerró la pantalla.
 * Un borrador viejo no se ofrece; una tanda sin enviar no se descarta nunca sola.
 */
export function restoreOrder(raw: string | null | undefined, now: number): StoredOrder {
  if (!raw) return NOTHING_STORED
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return NOTHING_STORED
  }
  const parsed = storedSchema.safeParse(json)
  if (!parsed.success) return NOTHING_STORED
  const { draft, outbox, savedAt, label } = parsed.data
  const fresh = now - savedAt <= DRAFT_TTL_MS
  return {
    draft: draft && fresh ? draft : EMPTY_DRAFT,
    outbox: outbox.map((entry) => ({ ...entry, nextAttemptAt: now })),
    label: label ?? null,
  }
}

/** ¿Se puede tirar esta entrada de otra mesa? Solo si es vieja y no guarda nada sin enviar. */
export function isDisposable(raw: string | null, now: number): boolean {
  if (!raw) return true
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return true
  }
  const parsed = storedSchema.safeParse(json)
  if (!parsed.success) return true
  return parsed.data.outbox.length === 0 && now - parsed.data.savedAt > STALE_AFTER_MS
}

// ─── Reintentos ──────────────────────────────────────────────────────────────

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000]

/** Cuánto esperar antes del intento que sigue: 1 s, 2 s, 4 s, 8 s, 15 s y después cada 30 s. */
export function backoffDelay(attempts: number): number {
  const at = Math.min(Math.max(1, Math.trunc(attempts)), BACKOFF_MS.length) - 1
  return BACKOFF_MS[at] ?? 30_000
}

/**
 * Errores con los que mandar lo mismo otra vez no sirve: el pedido, así, no va a entrar nunca.
 * Vuelve al borrador con el motivo, para corregirlo. Todo lo demás (sin red, sesión vencida, un
 * error del servidor) se reintenta solo, con la misma clave.
 */
const REJECT_CODES = new Set([
  'invalid',
  'forbidden',
  'disabled',
  'session_not_found',
  'session_not_open',
  'empty_order',
  'order_too_long',
  'item_not_available',
  'item_sold_out',
  'option_not_available',
  'invalid_quantity',
  'too_many_options',
])

export type SendOutcome =
  | { kind: 'sent' }
  /** «Todavía no»: se reintenta sola. */
  | { kind: 'retry'; failure: 'network' | 'server'; message: string | null }
  /** «Así no»: vuelve al borrador. */
  | { kind: 'reject'; code: string; message: string }

/** `null` = la llamada ni siquiera volvió (sin señal, tiempo agotado). */
export function classifySend(
  result: { ok: true } | { ok: false; code?: string; message: string } | null,
): SendOutcome {
  if (result === null) return { kind: 'retry', failure: 'network', message: null }
  if (result.ok) return { kind: 'sent' }
  const code = result.code ?? 'unknown'
  if (REJECT_CODES.has(code)) return { kind: 'reject', code, message: result.message }
  return { kind: 'retry', failure: 'server', message: result.message }
}

/** La tanda después de un intento fallido: cuenta el intento y agenda el que sigue. */
export function afterFailure(
  entry: OutboxEntry,
  outcome: Extract<SendOutcome, { kind: 'retry' }>,
  now: number,
): OutboxEntry {
  const attempts = entry.attempts + 1
  return {
    ...entry,
    attempts,
    lastFailure: outcome.failure,
    lastError: outcome.message,
    nextAttemptAt: now + backoffDelay(attempts),
  }
}

/** Volvió la señal, o el mozo tocó «Reintentar»: la que espera sale ya. */
export function retryNow(outbox: readonly OutboxEntry[], now: number): OutboxEntry[] {
  return outbox.map((entry) =>
    entry.nextAttemptAt > now ? { ...entry, nextAttemptAt: now } : entry,
  )
}

export type NextSend =
  /** Mandar esta ahora. */
  | { kind: 'send'; entry: OutboxEntry }
  /** Esperar esto antes de volver a mirar. */
  | { kind: 'wait'; ms: number }
  /** Nada que hacer (vacía, sin red o ya hay una viajando). */
  | { kind: 'idle' }

/**
 * Qué hace la bandeja ahora. Las tandas salen de a una y en orden: la segunda no pasa a la primera,
 * así cocina las recibe como se cargaron.
 */
export function nextSend(
  outbox: readonly OutboxEntry[],
  state: { now: number; online: boolean; inFlight: boolean },
): NextSend {
  const head = outbox[0]
  if (!head || state.inFlight || !state.online) return { kind: 'idle' }
  if (head.nextAttemptAt > state.now) return { kind: 'wait', ms: head.nextAttemptAt - state.now }
  return { kind: 'send', entry: head }
}

export type EntryStatus =
  /** Viajando por primera vez, o en la fila detrás de otra. */
  | 'sending'
  /** No hay red: sale sola cuando vuelva. */
  | 'offline'
  /** El servidor contestó con un error pasajero: se está reintentando. */
  | 'retrying'

export function entryStatus(entry: OutboxEntry, online: boolean): EntryStatus {
  if (!online || entry.lastFailure === 'network') return 'offline'
  if (entry.lastFailure === 'server') return 'retrying'
  return 'sending'
}

export const ENTRY_WORD: Record<EntryStatus, string> = {
  sending: 'Enviando…',
  offline: 'Sin señal: se envía sola cuando vuelva',
  retrying: 'No se pudo enviar. Reintentando…',
}
