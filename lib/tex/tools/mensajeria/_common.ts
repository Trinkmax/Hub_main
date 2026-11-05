import { formatInTimeZone } from 'date-fns-tz'
import type { AccSimpleState } from '@/lib/accounting/action-state'
import type { TenantRole } from '@/lib/tenant/types'
import { texScreenHref } from '../../screens'
import type { TexExecution, TexToolContext, TexToolResult } from '../types'

/**
 * Lo que comparte el área de Mensajería y Marketing. Puro: lo prueba `tex-mensajeria.test.ts`.
 *
 * Esto viaja a la API de un tercero y lo que le llega a un cliente no se deshace: acá vive lo que cuida
 * los datos personales y cómo se dice cada cantidad.
 */

// `lib/tenant/roles.ts` no tiene un set para Mensajería: las páginas y las acciones escriben estos
// mismos arrays a mano. El área la ve solo el dueño (`visible`); estos dicen lo que deja cada pantalla.
/** Difusiones, audiencias, plantillas, flows, canales y tareas. */
export const OWNER_ROLES: readonly TenantRole[] = ['owner']
/** La bandeja, y etiquetar una conversación. */
export const INBOX_ROLES: readonly TenantRole[] = ['owner', 'cashier', 'waiter']
/** Las etiquetas y los mensajes rápidos, como catálogo. */
export const CATALOG_ROLES: readonly TenantRole[] = ['owner', 'cashier']

export const TICKET_BROKEN = 'El tique está roto: armalo de nuevo.'

/** Va en todo tique de algo que sale hacia un cliente. */
export const NO_UNDO_WARNING = {
  key: 'no_undo',
  title: 'Lo que le llega a un cliente no se puede deshacer.',
  body: null,
} as const

const TZ = 'America/Argentina/Cordoba'
const WHOLE = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

export const fail = (message: string): TexToolResult => ({ kind: 'error', message })
export const failed = (message: string): TexExecution => ({ ok: false, kind: 'failed', message })

// ─── Datos personales ────────────────────────────────────────────────────────

const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu
/** Un teléfono, un documento, una tarjeta: 7 dígitos o más, con o sin separadores. */
const LONG_NUMBER_RE = /\+?\(?\d(?:[\s().-]{0,2}\d){6,}/g
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** `…1234`, para distinguir a dos personas sin mostrar el número. */
export function lastDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 4 ? `…${digits.slice(-4)}` : null
}

/**
 * Lo que escribió una persona puede traer un teléfono o un mail (el suyo o el de otro): se tapa antes
 * de que salga hacia la API. Una fecha o un importe no son datos de contacto.
 */
export function redactContact(text: string): string {
  return text
    .replace(EMAIL_RE, '[mail]')
    .replace(LONG_NUMBER_RE, (match, offset: number, whole: string) => {
      if (ISO_DAY_RE.test(match)) return match
      if (/\$\s*$/.test(whole.slice(Math.max(0, offset - 2), offset))) return match
      return lastDigits(match) ?? match
    })
}

const MASKED_RE = /…\d{4}(?!\d)|\[mail\]/

/**
 * Tex lee los teléfonos y los mails tapados. Si los copia en algo que se guarda o que le llega a un
 * cliente, quedaría un `…1234` en lugar del dato: eso vuelve con su error.
 */
export function maskedContactProblem(text: string | null | undefined): string | null {
  return text && MASKED_RE.test(text)
    ? 'El texto tiene un dato tapado (…1234 o [mail]): vos no ves teléfonos ni mails. Pedile que te lo pase o armalo sin ese dato.'
    : null
}

/** Un texto ajeno, sin datos de contacto y cortado: se paga por token. */
export function safeText(text: string | null | undefined, max: number): string | undefined {
  const value = text?.trim()
  if (!value) return undefined
  const clean = redactContact(value)
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

// ─── Cómo se dice ────────────────────────────────────────────────────────────

export function countText(count: number): string {
  return WHOLE.format(count)
}

/** `1 persona` · `1.234 personas`. */
export function peopleText(count: number): string {
  return `${countText(count)} ${count === 1 ? 'persona' : 'personas'}`
}

/** Una fila sin los números en cero: solo gastan tokens. */
export function noZeros<T extends Record<string, number>>(numbers: T): Partial<T> {
  const out: Partial<T> = {}
  for (const key of Object.keys(numbers) as Array<keyof T>) {
    const value = numbers[key]
    if (value !== 0) out[key] = value
  }
  return out
}

/** `dd/MM/yyyy HH:mm` en el reloj del bar, sin depender de dónde corre el servidor. */
export function dateTimeText(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : formatInTimeZone(date, TZ, 'dd/MM/yyyy HH:mm')
}

// ─── Puente con las acciones ─────────────────────────────────────────────────

type PlainActionState = { ok: true; message?: string } | { ok: false; message: string }

/** Las acciones de esta área devuelven su propio `{ ok }`; `simpleExecutor` espera esta forma. */
export function actionState<D>(
  state: PlainActionState,
  okMessage: string,
  data: D,
): AccSimpleState<D> {
  return state.ok
    ? { ok: true, data, message: state.message ?? okMessage }
    : { ok: false, code: 'error', message: state.message }
}

/** Lo que recibe una acción de formulario. Lo que no vino, no se manda (`get` da `null`). */
export function formDataOf(values: Readonly<Record<string, string | null | undefined>>): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) form.set(key, value)
  }
  return form
}

type ScreenParams = Parameters<typeof texScreenHref>[2]

/** A dónde llevar a la persona para mostrarle lo que quedó. Nunca una URL armada a mano. */
export function placeOf(
  ctx: Pick<TexToolContext, 'slug'>,
  screen: string,
  params?: ScreenParams,
  point?: string | null,
): { href: string | null; point: string | null } {
  const link = texScreenHref(ctx.slug, screen, params)
  return { href: link.ok ? link.href : null, point: point ?? null }
}
