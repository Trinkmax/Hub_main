'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { TICKET_DOOR_ROLES } from '@/lib/tenant/roles'
import { type DoorTicket, doorTicketSchema, parseDoorToken } from './door'
import { orderIdFromEntryCode } from './entry-code'
import { orderIdSchema } from './schemas'

/**
 * Las acciones de la puerta. Corren con la sesión de quien recibe: las reglas y
 * el rol los vuelve a controlar la base (`ticket_door_*`), que es la única que
 * puede leer los pedidos para alguien que no sea dueño. El rastro también lo deja
 * la base, en la misma transacción.
 */

// biome-ignore lint/suspicious/noExplicitAny: funciones nuevas, sin tipos generados todavía
type SBAny = any

export type DoorLookupResult =
  | { ok: true; ticket: DoorTicket }
  /** No es una entrada de este bar (o el código no existe). */
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'error'; message: string }

const NO_ACCESS: DoorLookupResult = {
  ok: false,
  reason: 'error',
  message: 'No tenés permiso para validar entradas.',
}

const SESSION_EXPIRED: DoorLookupResult = {
  ok: false,
  reason: 'error',
  message: 'Tu sesión venció. Volvé a entrar para seguir validando.',
}

const TRY_AGAIN: DoorLookupResult = {
  ok: false,
  reason: 'error',
  message: 'No pudimos consultar la entrada. Revisá la señal y probá de nuevo.',
}

const slugSchema = z.string().min(1).max(80)
const tokenSchema = z.string().min(1).max(200)
const guestsSchema = z.number().int().min(1).max(99)
const insideSchema = z.number().int().min(0).max(99)

type Access = Awaited<ReturnType<typeof requireTenantAccess>>

/** El acceso, o por qué no: «sin permiso» solo si de verdad no lo tiene. */
async function authorize(
  slug: string,
): Promise<{ access: Access } | { refusal: DoorLookupResult }> {
  if (!slugSchema.safeParse(slug).success) return { refusal: NO_ACCESS }
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, TICKET_DOOR_ROLES)
    return { access }
  } catch (error) {
    if (error instanceof RoleRequiredError || error instanceof TenantNotFoundError) {
      return { refusal: NO_ACCESS }
    }
    if (error instanceof UnauthenticatedError) return { refusal: SESSION_EXPIRED }
    console.error('[ticketing.door.authorize]', {
      slug,
      error: error instanceof Error ? error.name : 'unknown',
    })
    return { refusal: TRY_AGAIN }
  }
}

function parseTicket(data: unknown): DoorLookupResult {
  if (data === null || data === undefined) return { ok: false, reason: 'not_found' }
  const parsed = doorTicketSchema.safeParse(data)
  if (!parsed.success) {
    console.error('[ticketing.door] la base devolvió algo inesperado', {
      path: parsed.error.issues[0]?.path.join('.'),
    })
    return TRY_AGAIN
  }
  return { ok: true, ticket: parsed.data }
}

/** Escanear: mira la entrada y no toca nada. */
export async function lookupDoorTicket(slug: string, token: string): Promise<DoorLookupResult> {
  const auth = await authorize(slug)
  if ('refusal' in auth) return auth.refusal

  const cleanToken = tokenSchema.safeParse(token)
  if (!cleanToken.success) return { ok: false, reason: 'not_found' }
  const parsedToken = parseDoorToken(cleanToken.data)
  if (!parsedToken) return { ok: false, reason: 'not_found' }

  let orderId: string | null = null
  if ('entryCode' in parsedToken) {
    orderId = orderIdFromEntryCode(parsedToken.entryCode)
    if (!orderId) return { ok: false, reason: 'not_found' }
  }

  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase.rpc('ticket_door_lookup', {
    p_tenant_id: auth.access.tenant.id,
    p_order_id: orderId,
    p_short_code: 'shortCode' in parsedToken ? parsedToken.shortCode : null,
  })
  if (error) {
    console.error('[ticketing.door.lookup]', { tenantId: auth.access.tenant.id, code: error.code })
    return error.message?.includes('forbidden') ? NO_ACCESS : TRY_AGAIN
  }
  return parseTicket(data)
}

/** Lo que la base se niega a hacer no es un error de la pantalla: es otro veredicto. */
const REFUSALS = [
  'ticket_not_found',
  'ticket_not_paid',
  'ticket_refunded',
  'ticket_no_reservation',
  'ticket_cancelled',
  'ticket_already_used',
  'ticket_other_day',
  'ticket_invalid_guests',
  'ticket_stale',
]

function revalidateDoor(slug: string) {
  revalidatePath(`/${slug}/salon/puerta`)
  revalidatePath(`/${slug}/salon/reservas-operativo`)
  revalidatePath(`/${slug}/operativo`)
  revalidatePath(`/${slug}/reservas`)
  revalidatePath(`/${slug}/entradas`)
}

/**
 * Dejar pasar. `expectedInside` es cuántos había adentro cuando quien recibe miró
 * la pantalla: si otro celular se adelantó, o es un reintento de algo que ya entró,
 * la base no suma. Si la base no lo permite (también si la devolvieron, etc.), vuelve
 * a mirar la entrada: la pantalla muestra cómo está ahora, no un error.
 */
export async function admitDoorTicket(
  slug: string,
  orderId: string,
  guests: number,
  expectedInside: number,
): Promise<DoorLookupResult & { admitted?: boolean }> {
  const auth = await authorize(slug)
  if ('refusal' in auth) return auth.refusal
  if (
    !orderIdSchema.safeParse(orderId).success ||
    !guestsSchema.safeParse(guests).success ||
    !insideSchema.safeParse(expectedInside).success
  ) {
    return { ok: false, reason: 'not_found' }
  }
  const tenantId = auth.access.tenant.id

  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase.rpc('ticket_door_admit', {
    p_tenant_id: tenantId,
    p_order_id: orderId,
    p_guests: guests,
    p_expected_inside: expectedInside,
  })
  if (error) {
    if (error.message?.includes('forbidden')) return NO_ACCESS
    if (REFUSALS.some((code) => error.message?.includes(code))) {
      const { data: fresh, error: freshError } = await supabase.rpc('ticket_door_lookup', {
        p_tenant_id: tenantId,
        p_order_id: orderId,
        p_short_code: null,
      })
      return freshError ? TRY_AGAIN : parseTicket(fresh)
    }
    console.error('[ticketing.door.admit]', { tenantId, code: error.code })
    return TRY_AGAIN
  }

  const result = parseTicket(data)
  if (result.ok) revalidateDoor(slug)
  return { ...result, admitted: result.ok }
}

/** Por qué no se pudo deshacer, y adónde ir. */
const UNDO_REFUSALS: ReadonlyArray<[string, string]> = [
  ['ticket_undo_expired', 'Pasó el tiempo para deshacer. Corregilo en Reservas.'],
  ['ticket_undo_other_user', 'Solo puede deshacerlo quien dejó pasar. Corregilo en Reservas.'],
  ['ticket_undo_unavailable', 'Esta entrada ya se corrigió una vez. Seguí en Reservas.'],
  ['ticket_stale', 'La reserva cambió recién. Corregila en Reservas.'],
]

/** El toque de más: vuelve la entrada a como estaba. Los candados están en la base. */
export async function undoDoorTicket(slug: string, orderId: string): Promise<DoorLookupResult> {
  const auth = await authorize(slug)
  if ('refusal' in auth) return auth.refusal
  if (!orderIdSchema.safeParse(orderId).success) return { ok: false, reason: 'not_found' }
  const tenantId = auth.access.tenant.id

  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase.rpc('ticket_door_undo', {
    p_tenant_id: tenantId,
    p_order_id: orderId,
  })
  if (error) {
    if (error.message?.includes('forbidden')) return NO_ACCESS
    const refusal = UNDO_REFUSALS.find(([code]) => error.message?.includes(code))
    if (refusal) return { ok: false, reason: 'error', message: refusal[1] }
    console.error('[ticketing.door.undo]', { tenantId, code: error.code })
    return TRY_AGAIN
  }

  const result = parseTicket(data)
  if (result.ok) revalidateDoor(slug)
  return result
}
