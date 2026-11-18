'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getBranchScope } from '@/lib/branches/scope'
import type { BranchRef } from '@/lib/branches/types'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { TICKET_DOOR_ROLES } from '@/lib/tenant/roles'
import {
  type DoorElsewhere,
  type DoorTicket,
  doorTicketSchema,
  isOtherBranch,
  parseDoorToken,
} from './door'
import { orderIdFromEntryCode } from './entry-code'
import { orderIdSchema } from './schemas'

/**
 * Las acciones de la puerta. Corren con la sesión de quien recibe: las reglas y
 * el rol los vuelve a controlar la base (`ticket_door_*`), que es la única que
 * puede leer los pedidos para alguien que no sea dueño. El rastro también lo deja
 * la base, en la misma transacción.
 *
 * La sucursal (docs/features/sucursales.md): la puerta es un lugar, la sucursal de
 * este equipo. Las funciones de la base no la miran (son de antes de las
 * sucursales), así que acá se compara la sucursal de la reserva de la entrada con
 * la de la puerta: si es de otra, se avisa dónde es y no se deja pasar.
 */

// biome-ignore lint/suspicious/noExplicitAny: funciones nuevas, sin tipos generados todavía
type SBAny = any

export type DoorLookupResult =
  /** `elsewhere`: la entrada es de otra sucursal (dónde es). `null` = de esta, o no se sabe. */
  | { ok: true; ticket: DoorTicket; elsewhere: DoorElsewhere | null }
  /** No es una entrada de este bar (o el código no existe). */
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'error'; message: string }

type Failure = Exclude<DoorLookupResult, { ok: true }>
type Parsed = { ok: true; ticket: DoorTicket } | Failure

const NO_ACCESS: Failure = {
  ok: false,
  reason: 'error',
  message: 'No tenés permiso para validar entradas.',
}

const SESSION_EXPIRED: Failure = {
  ok: false,
  reason: 'error',
  message: 'Tu sesión venció. Volvé a entrar para seguir validando.',
}

const TRY_AGAIN: Failure = {
  ok: false,
  reason: 'error',
  message: 'No pudimos consultar la entrada. Revisá la señal y probá de nuevo.',
}

const slugSchema = z.string().min(1).max(80)
const tokenSchema = z.string().min(1).max(200)
const guestsSchema = z.number().int().min(1).max(99)
const insideSchema = z.number().int().min(0).max(99)
const branchIdSchema = z.uuid().nullish()

type Access = Awaited<ReturnType<typeof requireTenantAccess>>

/** El acceso, o por qué no: «sin permiso» solo si de verdad no lo tiene. */
async function authorize(slug: string): Promise<{ access: Access } | { refusal: Failure }> {
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

function parseTicket(data: unknown): Parsed {
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

type DoorPlace = {
  /** La sucursal de esta puerta. `null` = no se sabe: no se frena a nadie por la sucursal. */
  door: BranchRef | null
  /** Las sucursales que ve quien recibe: de ahí sale el nombre de la otra, si la tiene. */
  branches: BranchRef[]
}

/**
 * La sucursal de esta puerta: la que mandó la pantalla (con la que se dibujó, si la persona la
 * tiene) o, si no mandó ninguna (el escáner del salón), la de este equipo.
 */
async function doorPlace(slug: string, requested: string | null | undefined): Promise<DoorPlace> {
  try {
    const scope = await getBranchScope(slug, 'device')
    const asked = requested ? scope.branches.find((branch) => branch.id === requested) : undefined
    return { door: asked ?? scope.current, branches: scope.branches }
  } catch (error) {
    // Sin saber dónde está la puerta, se valida como siempre: lo importante es poder escanear.
    console.error('[ticketing.door.place]', {
      error: error instanceof Error ? error.name : 'unknown',
    })
    return { door: null, branches: [] }
  }
}

/** El nombre de una sucursal que quien recibe quizás no tiene (la policy de branches deja leerla). */
async function branchName(
  supabase: SBAny,
  tenantId: string,
  branchId: string,
  known: ReadonlyArray<BranchRef>,
): Promise<string | null> {
  const mine = known.find((branch) => branch.id === branchId)
  if (mine) return mine.name
  const { data, error } = await supabase
    .from('branches')
    .select('name')
    .eq('tenant_id', tenantId)
    .eq('id', branchId)
    .maybeSingle()
  if (error) {
    console.error('[ticketing.door.branchName]', { tenantId, code: error.code })
    return null
  }
  return (data as { name: string } | null)?.name ?? null
}

/**
 * ¿La entrada es de otra sucursal? Se mira la de su reserva, que sigue al evento (si lo mudaron,
 * vale la de ahora). Sin reserva no hay a quién dejar pasar (la base lo dice) y, si algo no se
 * puede leer, la puerta no frena a nadie por eso.
 */
async function elsewhereOf(
  supabase: SBAny,
  tenantId: string,
  ticket: DoorTicket,
  place: DoorPlace,
): Promise<DoorElsewhere | null> {
  if (!place.door || !ticket.reservation) return null
  const { data, error } = await supabase
    .from('salon_reservations')
    .select('branch_id')
    .eq('tenant_id', tenantId)
    .eq('id', ticket.reservation.id)
    .maybeSingle()
  if (error) {
    console.error('[ticketing.door.branch]', { tenantId, code: error.code })
    return null
  }
  const branchId = (data as { branch_id: string | null } | null)?.branch_id ?? null
  if (!branchId || !isOtherBranch(branchId, place.door.id)) return null
  return {
    branch: await branchName(supabase, tenantId, branchId, place.branches),
    here: place.door.name,
  }
}

async function placed(
  supabase: SBAny,
  tenantId: string,
  parsed: Parsed,
  place: DoorPlace,
): Promise<DoorLookupResult> {
  if (!parsed.ok) return parsed
  return {
    ok: true,
    ticket: parsed.ticket,
    elsewhere: await elsewhereOf(supabase, tenantId, parsed.ticket, place),
  }
}

function lookupFailure(tenantId: string, error: { code?: string; message?: string }): Failure {
  console.error('[ticketing.door.lookup]', { tenantId, code: error.code })
  return error.message?.includes('forbidden') ? NO_ACCESS : TRY_AGAIN
}

/**
 * Escanear: mira la entrada y no toca nada. `branchId` es la sucursal con la que se dibujó la
 * puerta; sin ella, la de este equipo.
 */
export async function lookupDoorTicket(
  slug: string,
  token: string,
  branchId?: string | null,
): Promise<DoorLookupResult> {
  const auth = await authorize(slug)
  if ('refusal' in auth) return auth.refusal

  const cleanToken = tokenSchema.safeParse(token)
  if (!cleanToken.success) return { ok: false, reason: 'not_found' }
  const parsedToken = parseDoorToken(cleanToken.data)
  if (!parsedToken) return { ok: false, reason: 'not_found' }
  const cleanBranch = branchIdSchema.safeParse(branchId)

  let orderId: string | null = null
  if ('entryCode' in parsedToken) {
    orderId = orderIdFromEntryCode(parsedToken.entryCode)
    if (!orderId) return { ok: false, reason: 'not_found' }
  }

  const tenantId = auth.access.tenant.id
  const supabase = (await createClient()) as SBAny
  const [{ data, error }, place] = await Promise.all([
    supabase.rpc('ticket_door_lookup', {
      p_tenant_id: tenantId,
      p_order_id: orderId,
      p_short_code: 'shortCode' in parsedToken ? parsedToken.shortCode : null,
    }),
    doorPlace(slug, cleanBranch.success ? cleanBranch.data : null),
  ])
  if (error) return lookupFailure(tenantId, error)
  return placed(supabase, tenantId, parseTicket(data), place)
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
 *
 * Antes de pedírselo a la base, la sucursal: una entrada de otra sucursal no pasa por esta
 * puerta aunque la pantalla lo pida (vuelve con `elsewhere` y sin `admitted`).
 */
export async function admitDoorTicket(
  slug: string,
  orderId: string,
  guests: number,
  expectedInside: number,
  branchId?: string | null,
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
  const cleanBranch = branchIdSchema.safeParse(branchId)
  const tenantId = auth.access.tenant.id

  const supabase = (await createClient()) as SBAny
  const [{ data: current, error: currentError }, place] = await Promise.all([
    supabase.rpc('ticket_door_lookup', {
      p_tenant_id: tenantId,
      p_order_id: orderId,
      p_short_code: null,
    }),
    doorPlace(slug, cleanBranch.success ? cleanBranch.data : null),
  ])
  if (currentError) return lookupFailure(tenantId, currentError)
  const before = await placed(supabase, tenantId, parseTicket(current), place)
  if (!before.ok) return before
  if (before.elsewhere) return { ...before, admitted: false }

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
      return freshError ? TRY_AGAIN : placed(supabase, tenantId, parseTicket(fresh), place)
    }
    console.error('[ticketing.door.admit]', { tenantId, code: error.code })
    return TRY_AGAIN
  }

  const result = parseTicket(data)
  if (!result.ok) return result
  revalidateDoor(slug)
  // Entró por esta puerta: es de esta sucursal.
  return { ok: true, ticket: result.ticket, elsewhere: null, admitted: true }
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
  if (!result.ok) return result
  revalidateDoor(slug)
  // Se deshace lo que se dejó pasar por esta puerta: es de esta sucursal.
  return { ok: true, ticket: result.ticket, elsewhere: null }
}
