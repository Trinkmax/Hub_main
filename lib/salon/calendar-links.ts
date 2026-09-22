/**
 * URLs de las reservas: el calendario, la lista /reservas, el alta y la ficha.
 *
 * Todas las pantallas arman estos links con las mismas funciones: el orden de
 * los params es fijo (month, planta, day, seg, res, buscar) para que el mismo
 * día dé siempre la misma URL y el Atrás del navegador no acumule variantes.
 *
 * Se reserva desde los dos lados (la lista y el calendario) y al guardar se
 * vuelve a la pantalla desde la que se entró (decisión del dueño, 22/09/2026).
 * El origen viaja en la URL del alta y de la ficha como `?volver=calendario`;
 * sin él, el destino es la lista, que es lo que hacían antes el operativo, el
 * resumen, el onboarding y el salón.
 */

import type { SegmentKey, ZoneFilter } from './segments'

function withQuery(path: string, params: ReadonlyArray<readonly [string, string | undefined]>) {
  const query = params
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
  return query ? `${path}?${query}` : path
}

const ISO_DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/

/**
 * A dónde vuelve el alta o la ficha de una reserva. 'reservas' es el default
 * (sin param); 'calendario' viaja como `?volver=calendario`.
 */
export type ReservationReturnTo = 'calendario' | 'reservas'

/** Lo que se pasa como `from` en los links que salen del calendario. */
export type ReservationLinkFrom = Extract<ReservationReturnTo, 'calendario'>

export type CalendarHrefOptions = {
  month?: string
  /**
   * Filtro de planta (?planta=alta|baja|sin). Es de la vista, como el mes:
   * abrir un día, recorrer días o cambiar de mes lo conserva; quien lo quiera
   * sacar (el «Ver todo» del día) simplemente no lo pasa.
   */
  zone?: ZoneFilter
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
    ['planta', opts.zone],
    ['day', opts.day],
    ['seg', opts.segment],
    ['res', opts.focusId],
    ['buscar', opts.search],
  ])
}

/**
 * La misma URL sin el filtro de planta (path + query + hash, para un
 * `replaceState`), o null si no tenía `planta`. La usa el calendario para
 * limpiar el mes filtrado que quedó debajo del día después de «Ver todo».
 * El resto de los params queda en su orden.
 */
export function hrefWithoutZone(href: string): string | null {
  const url = new URL(href, 'http://localhost')
  if (!url.searchParams.has('planta')) return null
  url.searchParams.delete('planta')
  const query = url.searchParams.toString()
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`
}

export type ReservasListHrefOptions = {
  /** El día que abre la lista; sin él, hoy. */
  day?: string
  /** La reserva recién creada: la lista la resalta y muestra el aviso de creada. */
  nueva?: string
}

/** La lista /reservas parada en un día (y con la reserva nueva resaltada). */
export function reservasListHref(slug: string, opts: ReservasListHrefOptions = {}): string {
  return withQuery(`/${encodeURIComponent(slug)}/reservas`, [
    ['day', opts.day],
    ['nueva', opts.nueva],
  ])
}

export type ReservasExportHrefOptions = {
  /** Modo día: el día que muestra la lista. */
  day?: string
  /** Modo rango: si viene alguno, manda sobre `day` (igual que en la ruta). */
  from?: string
  to?: string
  q?: string
  status?: string
  zone?: string
  /** El servicio (`?servicio=` en la lista). */
  mealType?: string
  managerId?: string
}

/**
 * El «Exportar» de la lista: lo que se está viendo (día o rango + filtros),
 * entero. Recibe los valores que la página YA validó, nunca los crudos de la
 * URL: con `?day=2026-09-10&from=hoy` la lista muestra el 10/09 (descarta el
 * `from` roto), pero el link copiaba `from=hoy`, la ruta entraba en modo rango
 * y devolvía un 400; con `?from=2026-02-30` era un 500 de Postgres.
 */
export function reservasExportHref(slug: string, opts: ReservasExportHrefOptions): string {
  const rangeMode = Boolean(opts.from || opts.to)
  return withQuery('/api/reservas/export', [
    ['slug', slug],
    ['day', rangeMode ? undefined : opts.day],
    ['from', opts.from],
    ['to', opts.to],
    ['q', opts.q],
    ['status', opts.status],
    ['zone', opts.zone],
    ['servicio', opts.mealType],
    ['manager', opts.managerId],
  ])
}

export type NewReservationHrefOptions = {
  date?: string
  segment?: SegmentKey
  eventId?: string
  time?: string
  /** Se entra desde el calendario: al guardar se vuelve ahí (`?volver=calendario`). */
  from?: ReservationLinkFrom
}

/**
 * Alta de reserva. Dentro de un evento manda solo ?event: el evento ya define
 * servicio y hora. Si no, ?meal y, solo si se tocó un horario puntual, ?time
 * (la hora sugerida la resuelve el server desde la config del bar). `?volver`
 * va siempre al final.
 */
export function newReservationHref(slug: string, opts: NewReservationHrefOptions = {}): string {
  const path = `/${encodeURIComponent(slug)}/reservas/nuevo`
  if (opts.eventId) {
    return withQuery(path, [
      ['date', opts.date],
      ['event', opts.eventId],
      ['volver', opts.from],
    ])
  }
  return withQuery(path, [
    ['date', opts.date],
    ['meal', opts.segment],
    ['time', opts.time],
    ['volver', opts.from],
  ])
}

/** La ficha (edición completa) de una reserva. */
export function editReservationHref(
  slug: string,
  id: string,
  opts: { from?: ReservationLinkFrom } = {},
): string {
  return withQuery(`/${encodeURIComponent(slug)}/reservas/${encodeURIComponent(id)}`, [
    ['volver', opts.from],
  ])
}

export function editEventHref(slug: string, eventId: string): string {
  return `/${encodeURIComponent(slug)}/eventos/programados/${encodeURIComponent(eventId)}`
}

/**
 * A dónde lleva el form después de guardar. En los dos casos se para en el DÍA
 * de la reserva y la resalta: al cargar una para el 31/07 el dueño volvía a hoy
 * y no la veía ("las reservas no salen una vez registradas").
 *
 * - calendario → el día abierto con la fila de la reserva resaltada.
 * - reservas   → la lista en ese día; en el alta, además, `?nueva` para el
 *   aviso de creada (la edición no lo lleva: la reserva ya existía).
 */
export function reservationSavedHref(
  slug: string,
  opts: { returnTo: ReservationReturnTo; mode: 'create' | 'edit'; date: string; id?: string },
): string {
  if (opts.returnTo === 'calendario') {
    return calendarHref(slug, { day: opts.date, focusId: opts.id })
  }
  return reservasListHref(slug, {
    day: opts.date,
    nueva: opts.mode === 'create' ? opts.id : undefined,
  })
}

/**
 * El «Volver» del encabezado del alta y de la ficha: a la pantalla de origen,
 * abierta en el día de la reserva (y, en el calendario, en su servicio o con
 * la fila resaltada).
 */
export function reservationBackLink(
  slug: string,
  opts: { returnTo: ReservationReturnTo; date: string; segment?: SegmentKey; focusId?: string },
): { href: string; label: string } {
  if (opts.returnTo === 'calendario') {
    return {
      href: calendarHref(slug, { day: opts.date, segment: opts.segment, focusId: opts.focusId }),
      label: 'Volver al calendario',
    }
  }
  return { href: reservasListHref(slug, { day: opts.date }), label: 'Volver a reservas' }
}
