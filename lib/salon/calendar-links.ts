/**
 * URLs del calendario como puerta única de las reservas.
 *
 * Todas las pantallas arman estos links con las mismas funciones: el orden de
 * los params es fijo (month, day, seg, res, buscar) para que el mismo día dé
 * siempre la misma URL y el Atrás del navegador no acumule variantes.
 */

import { z } from 'zod'
import { firstParams, isoDaySchema } from './segment-schemas'
import type { SegmentKey } from './segments'

const ISO_DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/

function withQuery(path: string, params: ReadonlyArray<readonly [string, string | undefined]>) {
  const query = params
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
  return query ? `${path}?${query}` : path
}

export type CalendarHrefOptions = {
  month?: string
  day?: string
  segment?: SegmentKey
  focusId?: string
  search?: string
}

/**
 * '/{slug}/eventos/programados' con el día abierto. Si no viene `month`, sale
 * del día (así el mes de fondo es el del día y no el de hoy). `day: 'hoy'`
 * viaja tal cual: lo resuelve la página con la fecha de Córdoba.
 */
export function calendarHref(slug: string, opts: CalendarHrefOptions = {}): string {
  const month =
    opts.month ?? (opts.day && ISO_DAY_SHAPE.test(opts.day) ? opts.day.slice(0, 7) : undefined)
  return withQuery(`/${encodeURIComponent(slug)}/eventos/programados`, [
    ['month', month],
    ['day', opts.day],
    ['seg', opts.segment],
    ['res', opts.focusId],
    ['buscar', opts.search],
  ])
}

export type NewReservationHrefOptions = {
  date?: string
  segment?: SegmentKey
  eventId?: string
  time?: string
}

/**
 * Alta de reserva. Dentro de un evento manda solo ?event: el evento ya define
 * servicio y hora. Si no, ?meal y, solo si se tocó un horario puntual, ?time
 * (la hora sugerida la resuelve el server desde la config del bar).
 */
export function newReservationHref(slug: string, opts: NewReservationHrefOptions = {}): string {
  const path = `/${encodeURIComponent(slug)}/reservas/nuevo`
  if (opts.eventId) {
    return withQuery(path, [
      ['date', opts.date],
      ['event', opts.eventId],
    ])
  }
  return withQuery(path, [
    ['date', opts.date],
    ['meal', opts.segment],
    ['time', opts.time],
  ])
}

export function editEventHref(slug: string, eventId: string): string {
  return `/${encodeURIComponent(slug)}/eventos/programados/${encodeURIComponent(eventId)}`
}

/** Mismo criterio que `?res` del calendario: un id que no pasaría ahí no se arrastra. */
const reservationIdSchema = z.uuid()

/**
 * La vieja lista /reservas redirige al calendario conservando lo que se pueda
 * traducir, así los links guardados y el historial siguen andando:
 *
 * - ?day=D(&nueva=ID) → el día abierto, con la reserva recién creada resaltada.
 * - ?from=F(&to=T)    → el mes de F.
 * - ?q=texto          → el buscador del calendario abierto con ese texto.
 * - Filtros de estado, zona, gestor, servicio, página o basura → el calendario
 *   pelado (esos filtros no existen en el calendario).
 */
export function legacyReservasRedirect(
  slug: string,
  sp: Record<string, string | string[] | undefined>,
): string {
  const p = firstParams(sp)
  const day = isoDaySchema.safeParse(p.day).success ? p.day : undefined
  const from = isoDaySchema.safeParse(p.from).success ? p.from : undefined
  const nueva = reservationIdSchema.safeParse(p.nueva).success ? p.nueva : undefined
  const q = p.q?.trim().slice(0, 60) || undefined

  if (day) return calendarHref(slug, { day, focusId: nueva, search: q })
  return calendarHref(slug, { month: from?.slice(0, 7), search: q })
}
