import 'server-only'

import { cookies } from 'next/headers'
import { getCustomerById } from '@/lib/customers/queries'
import { searchCustomers } from '@/lib/customers/search'
import { addDays } from '@/lib/dates'
import { getFlow, listFlows } from '@/lib/flows/queries'
import { tryNormalizePhone } from '@/lib/phone'
import type { ServiceAlert } from '@/lib/salon/alerts'
import { parseServiceAlerts } from '@/lib/salon/alerts'
import { lastManagerCookieName, pickDefaultManagerId } from '@/lib/salon/managers'
import { normalizeText, serviceDayInCordoba } from '@/lib/salon/operativo'
import {
  getManagerForUser,
  getSalonReservation,
  getScheduledEvent,
  listCakeOptions,
  listManagers,
  listSalonReservations,
  listScheduledEventsForDateRange,
  listScheduledTemplates,
  type ScheduledEventWithTemplate,
} from '@/lib/salon/queries'
import { getDaySegmentsSnapshot, searchReservationsByGuest } from '@/lib/salon/segment-queries'
import type { ReservationSearchResult } from '@/lib/salon/segment-rows'
import { type DaySegmentsSnapshot, eventDisplayName, segmentOfMealType } from '@/lib/salon/segments'
import type {
  CakeOptionRow,
  ReservationManagerRow,
  ReservationWithJoins,
  ScheduledEventTemplateRow,
} from '@/lib/salon/types'
import { matchByName, type NameMatch, noMatchText } from '../actions/_gastos-values'
import { dayText, type TexToolContext } from '../types'
import type { CustomerChoice, ManagerChoice } from './_drafts'
import { maskPhone, redactContacts } from './_words'

/**
 * De lo que dice la gente («la de García del viernes», «el sushi») a un id. Si no hay uno solo, vuelve
 * con las opciones para que Tex pregunte: nunca elige a ojo. Como `lib/tex/resolve.ts`, para reservas.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type Found<T> = { ok: true; value: T } | { ok: false; message: string }

const notFound = (message: string): { ok: false; message: string } => ({ ok: false, message })

/** Los eventos que se miran por nombre, para adelante. */
const EVENT_LOOKAHEAD_DAYS = 180
/** Si la búsqueda por nombre no da nada (por una tilde), los días de reservas que se miran a mano. */
const RESERVATION_FALLBACK_DAYS = 45

// ─── Reservas ────────────────────────────────────────────────────────────────

export type PickedReservation = { ok: true; id: string } | { ok: false; message: string }

/** Una opción para que Tex pregunte: sin datos de contacto. */
export function reservationOption(row: ReservationSearchResult): string {
  return `${redactContacts(row.guest_name)} (${dayText(row.reservation_date)} ${row.reservation_time_local}, ${row.guests} personas, id ${row.id})`
}

/**
 * Cuál reserva es. Las canceladas no, porque no se les puede hacer nada, salvo para mirarlas si no hay
 * otra. Sin fecha, las que vienen desde el día de servicio (a la 1:30 la cena de anoche todavía
 * cuenta); si no hay ninguna, cualquiera. Un nombre exacto le gana a uno parecido.
 */
export function pickReservation(
  rows: readonly ReservationSearchResult[],
  opts: { wanted: string; onDate?: string; from: string; orCancelled?: boolean },
): PickedReservation | null {
  const alive = rows.filter((row) => row.status !== 'cancelled')
  const standing = alive.length > 0 || !opts.orCancelled ? alive : [...rows]
  const onDay = opts.onDate
    ? standing.filter((row) => row.reservation_date === opts.onDate)
    : standing.filter((row) => row.reservation_date >= opts.from)
  const pool = opts.onDate || onDay.length > 0 ? onDay : standing
  if (pool.length === 0) return null
  const key = normalizeText(opts.wanted)
  const exact = pool.filter((row) => normalizeText(row.guest_name) === key)
  const picks = exact.length > 0 ? exact : pool
  const [only] = picks
  if (only && picks.length === 1) return { ok: true, id: only.id }
  const list = picks.slice(0, 6).map(reservationOption).join('; ')
  return {
    ok: false,
    message: `«${opts.wanted}» puede ser: ${list}. Preguntale cuál, o mandá el id.`,
  }
}

function toSearchResult(r: ReservationWithJoins): ReservationSearchResult {
  return {
    id: r.id,
    guest_name: r.guest_name,
    reservation_date: r.reservation_date,
    reservation_time_local: r.reservation_time_local.slice(0, 5),
    guests: r.actual_guests ?? r.estimated_guests,
    status: r.status,
    segment: segmentOfMealType(r.meal_type),
    eventName: r.scheduled_event?.template?.name ?? null,
  }
}

/** Todas las palabras en el nombre de la reserva o de su ficha, sin tildes ni mayúsculas. */
export function guestMatches(r: ReservationWithJoins, wanted: string): boolean {
  const haystack = normalizeText(
    [r.guest_name, r.customer?.first_name, r.customer?.last_name].filter(Boolean).join(' '),
  )
  return normalizeText(wanted)
    .split(/\s+/)
    .every((word) => haystack.includes(word))
}

/**
 * La búsqueda por nombre es `ilike`: «garcia» no encuentra «García». Si no dio nada, se miran a mano
 * las reservas de los próximos días, para no decirle a alguien que no existe una reserva que está ahí.
 */
export async function searchReservations(
  ctx: TexToolContext,
  wanted: string,
  onDate?: string,
): Promise<ReservationSearchResult[]> {
  const found = await searchReservationsByGuest({ tenantId: ctx.tenantId, q: wanted, limit: 40 })
  if (found.length > 0) return found
  const from = onDate ?? serviceDayInCordoba()
  const { rows } = await listSalonReservations({
    tenantId: ctx.tenantId,
    dateFrom: from,
    dateTo: onDate ?? addDays(from, RESERVATION_FALLBACK_DAYS),
    excludeStatus: ['cancelled'],
    page: 1,
    pageSize: 200,
    sort: 'asc',
  })
  return rows.filter((r) => guestMatches(r, wanted)).map(toSearchResult)
}

export async function findReservation(
  ctx: TexToolContext,
  wanted: string,
  onDate?: string,
  opts: {
    /** Para mirar: si no hay otra, también una cancelada. */
    orCancelled?: boolean
    /** Sin fecha, primero este día: «llegó García» es la de esta noche, aunque tenga otra el mes que viene. */
    preferDate?: string
  } = {},
): Promise<Found<ReservationWithJoins>> {
  const id = wanted.trim()
  if (UUID_RE.test(id)) {
    const reservation = await getSalonReservation({ tenantId: ctx.tenantId, id })
    return reservation
      ? { ok: true, value: reservation }
      : notFound('Esa reserva no está. Buscala con buscar_reserva.')
  }
  const rows = await searchReservations(ctx, id, onDate)
  const from = serviceDayInCordoba()
  const picked =
    (opts.preferDate && !onDate
      ? pickReservation(rows, { wanted: id, onDate: opts.preferDate, from })
      : null) ?? pickReservation(rows, { wanted: id, onDate, from, orCancelled: opts.orCancelled })
  if (!picked) {
    return notFound(
      `No encontré una reserva de «${id}»${onDate ? ` el ${dayText(onDate)}` : ''}. Preguntale cómo figura, o si es de otra fecha.`,
    )
  }
  if (!picked.ok) return picked
  const reservation = await getSalonReservation({ tenantId: ctx.tenantId, id: picked.id })
  return reservation
    ? { ok: true, value: reservation }
    : notFound('Esa reserva no está. Buscala con buscar_reserva.')
}

// ─── Eventos y formatos ──────────────────────────────────────────────────────

/** Uno solo o las opciones, con la fecha para poder preguntar. */
export function pickEvent(
  events: readonly ScheduledEventWithTemplate[],
  wanted: string,
): Found<ScheduledEventWithTemplate> {
  const key = normalizeText(wanted)
  const named = events.map((event) => ({ event, name: normalizeText(eventDisplayName(event)) }))
  const exact = named.filter((e) => e.name === key)
  const near = exact.length > 0 ? exact : named.filter((e) => e.name.includes(key))
  const [only] = near
  if (only && near.length === 1) return { ok: true, value: only.event }
  if (near.length > 1) {
    const list = near
      .slice(0, 8)
      .map(
        ({ event }) =>
          `${eventDisplayName(event)} ${dayText(event.event_date)} ${event.starts_at_local.slice(0, 5)} (id ${event.id})`,
      )
      .join('; ')
    return notFound(`«${wanted}» puede ser: ${list}. Preguntale cuál.`)
  }
  const options = [...new Set(events.map(eventDisplayName))].slice(0, 8).join(', ')
  return notFound(
    options
      ? `No encontré el evento «${wanted}». Los que hay: ${options}.`
      : `No encontré el evento «${wanted}»: no hay eventos en esas fechas.`,
  )
}

/** Un evento de una fecha, o de los que vienen. Con el id, directo. */
export async function findEvent(
  ctx: TexToolContext,
  wanted: string,
  onDate?: string,
): Promise<Found<ScheduledEventWithTemplate>> {
  const id = wanted.trim()
  if (UUID_RE.test(id)) {
    const event = await getScheduledEvent({ tenantId: ctx.tenantId, id })
    return event
      ? { ok: true, value: event }
      : notFound('Ese evento no está. Miralo con ver_eventos.')
  }
  const events = await listScheduledEventsForDateRange({
    tenantId: ctx.tenantId,
    from: onDate ?? ctx.today,
    to: onDate ?? addDays(ctx.today, EVENT_LOOKAHEAD_DAYS),
  })
  return pickEvent(events, id)
}

function foundOf<T extends { id: string; name: string }>(
  match: NameMatch<T>,
  wanted: string,
): Found<T> {
  return match.ok ? match : notFound(noMatchText(match, wanted))
}

export async function findTemplate(
  ctx: TexToolContext,
  wanted: string,
  opts: { onlyActive?: boolean } = {},
): Promise<Found<ScheduledEventTemplateRow>> {
  const templates = await listScheduledTemplates({
    tenantId: ctx.tenantId,
    onlyActive: opts.onlyActive ?? false,
  })
  return foundOf(matchByName(templates, wanted), wanted)
}

export async function findCake(ctx: TexToolContext, wanted: string): Promise<Found<CakeOptionRow>> {
  const cakes = await listCakeOptions({ tenantId: ctx.tenantId, onlyActive: true })
  return foundOf(matchByName(cakes, wanted), wanted)
}

// ─── Gestores ────────────────────────────────────────────────────────────────

export function managerChoice(m: ReservationManagerRow, assumed = false): ManagerChoice {
  return { id: m.id, name: m.display_name, eligible: m.commission_eligible, assumed }
}

export function findManagerIn(
  managers: readonly ReservationManagerRow[],
  wanted: string,
): Found<ReservationManagerRow> {
  const named = managers.map((m) => ({ ...m, name: m.display_name }))
  return foundOf(matchByName(named, wanted), wanted)
}

/** El último gestor que se usó en este dispositivo: lo recuerda el alta de reservas. */
async function lastUsedManager(slug: string): Promise<string | null> {
  try {
    return (await cookies()).get(lastManagerCookieName(slug))?.value ?? null
  } catch {
    return null
  }
}

/**
 * El gestor de una reserva nueva, con la misma regla que el combo del formulario: el que digan; si no,
 * el último usado acá, el vinculado a la cuenta o el primero. `assumed` hace que el tique lo aclare,
 * salvo que sea quien está cargando: de esto sale la comisión.
 */
export async function reservationManager(
  ctx: TexToolContext,
  wanted: string | undefined,
): Promise<Found<ManagerChoice>> {
  const managers = await listManagers({ tenantId: ctx.tenantId, onlyActive: true })
  if (managers.length === 0) {
    return notFound(
      'No hay gestores activos para ponerle a la reserva. Los carga un dueño en Configuración › Comisiones › Gestores.',
    )
  }
  if (wanted) {
    const found = findManagerIn(managers, wanted)
    return found.ok ? { ok: true, value: managerChoice(found.value) } : found
  }
  const [self, lastUsed] = await Promise.all([
    getManagerForUser({ tenantId: ctx.tenantId, userId: ctx.userId }),
    lastUsedManager(ctx.slug),
  ])
  const id = pickDefaultManagerId({
    managers,
    mode: 'create',
    lastUsedManagerId: lastUsed,
    selfManagerId: self?.id ?? null,
  })
  const manager = managers.find((m) => m.id === id) ?? managers[0]
  if (!manager) return notFound('No hay gestores activos para ponerle a la reserva.')
  return { ok: true, value: managerChoice(manager, manager.id !== self?.id) }
}

// ─── Clientes ────────────────────────────────────────────────────────────────

function customerAlerts(value: unknown): readonly ServiceAlert[] {
  return parseServiceAlerts(value)
}

/** Con el teléfono exacto: lo mismo que hace el alta para vincular. */
export async function customerByPhone(
  ctx: TexToolContext,
  phone: string,
): Promise<CustomerChoice | null> {
  // Como la guarda el alta: «351 123 4567» y «+5493511234567» son la misma persona.
  const normalized = tryNormalizePhone(phone)
  if (!normalized) return null
  const found = await searchCustomers(ctx.slug, normalized.replace(/\D/g, ''))
  const match = found.find((c) => c.phone === normalized)
  return match
    ? {
        id: match.id,
        name: `${match.first_name} ${match.last_name}`.trim(),
        phone: match.phone,
        alerts: customerAlerts(match.service_alerts),
      }
    : null
}

/**
 * Por el id, o por el nombre y apellido exactos: una ficha trae puntos, avisos y un teléfono, y no se
 * vincula por un parecido.
 */
export async function findCustomer(
  ctx: TexToolContext,
  wanted: string,
): Promise<Found<CustomerChoice>> {
  const id = wanted.trim()
  if (UUID_RE.test(id)) {
    const customer = await getCustomerById({ tenantId: ctx.tenantId, id })
    if (!customer) return notFound('Esa ficha no está.')
    const row = customer as unknown as {
      id: string
      first_name: string
      last_name: string
      phone: string | null
      service_alerts: unknown
    }
    return {
      ok: true,
      value: {
        id: row.id,
        name: `${row.first_name} ${row.last_name}`.trim(),
        phone: row.phone,
        alerts: customerAlerts(row.service_alerts),
      },
    }
  }
  const key = normalizeText(id)
  // La búsqueda es por nombre o por apellido, no por los dos: se busca por la última palabra.
  const lastWord = id.split(/\s+/).at(-1) ?? id
  const found = await searchCustomers(ctx.slug, lastWord)
  const exact = found.filter((c) => normalizeText(`${c.first_name} ${c.last_name}`) === key)
  const [only] = exact
  if (only && exact.length === 1) {
    return {
      ok: true,
      value: {
        id: only.id,
        name: `${only.first_name} ${only.last_name}`.trim(),
        phone: only.phone,
        alerts: customerAlerts(only.service_alerts),
      },
    }
  }
  if (exact.length > 1) {
    const list = exact
      .slice(0, 6)
      .map((c) => `${c.first_name} ${c.last_name} (${maskPhone(c.phone)}, id ${c.id})`)
      .join('; ')
    return notFound(`Hay más de un cliente que se llama así: ${list}. Preguntale cuál.`)
  }
  return notFound(
    `No encontré un cliente que se llame exactamente «${id}». Preguntale el teléfono, o cargá la reserva sin ficha.`,
  )
}

// ─── Lo que hace falta para el tique ─────────────────────────────────────────

/** El cupo del día: si no se puede leer, el tique lo dice y se puede guardar igual (como el formulario). */
export async function snapshotOrNull(
  ctx: TexToolContext,
  date: string,
): Promise<DaySegmentsSnapshot | null> {
  try {
    return await getDaySegmentsSnapshot({ tenantId: ctx.tenantId, date })
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    console.error('[tex.agenda.snapshot]', {
      tenantId: ctx.tenantId,
      code: typeof code === 'string' ? code : undefined,
    })
    return null
  }
}

/**
 * El flow «Se acerca un evento», si está prendido: es lo único por lo que una reserva termina en un
 * WhatsApp al cliente (`customersForEventStarting`).
 */
export async function activeEventFlow(
  ctx: TexToolContext,
): Promise<{ name: string; hoursBefore: number } | null> {
  const flows = await listFlows(ctx.tenantId)
  const flow = flows.find((f) => f.trigger_type === 'event_starting' && f.active)
  if (!flow) return null
  const detail = await getFlow(ctx.tenantId, flow.id)
  const config = (detail?.trigger_config ?? {}) as { hours_before?: unknown }
  const hours = Number(config.hours_before ?? 24)
  return { name: flow.name, hoursBefore: Number.isFinite(hours) && hours > 0 ? hours : 24 }
}
