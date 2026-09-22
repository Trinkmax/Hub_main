/**
 * Todo el texto es-AR que muestran las pantallas del cupo por servicio.
 *
 * Una sola fuente a propósito: el mes, la vista del día, el form, la vista
 * rápida, el operativo y el salón dicen lo mismo con las mismas palabras, y
 * los tests fijan los strings. Acá solo se FORMATEA lo que ya calculó
 * `segments.ts`; si hace falta un número nuevo, va allá, no acá.
 */

import { UNPLACED_LABEL } from './event-floor'
import {
  type DaySegments,
  type EventSegmentMismatch,
  type IsoDow,
  SEGMENT_KEYS,
  type SegmentEventLoad,
  type SegmentKey,
  type SegmentLoad,
  type SegmentProjection,
  type ZoneCaps,
  type ZoneFilter,
  type ZoneLoad,
  zoneCapacity,
  zoneLoad,
  zoneOfFilter,
} from './segments'
import { type SalonZone, ZONE_LABELS } from './types'

export const SEGMENT_LABELS: Record<SegmentKey, string> = {
  lunch: 'Almuerzo',
  tea_time: 'Merienda',
  dinner: 'Cena',
}

export const SEGMENT_SHORT_LABELS: Record<SegmentKey, string> = {
  lunch: 'Alm',
  tea_time: 'Mer',
  dinner: 'Cena',
}

export const SEGMENT_LETTERS: Record<SegmentKey, string> = {
  lunch: 'A',
  tea_time: 'M',
  dinner: 'C',
}

export const SEGMENT_WITH_ARTICLE: Record<SegmentKey, string> = {
  lunch: 'el almuerzo',
  tea_time: 'la merienda',
  dinner: 'la cena',
}

/** "Cupo de los jueves". */
const DOW_PLURAL: Record<IsoDow, string> = {
  1: 'lunes',
  2: 'martes',
  3: 'miércoles',
  4: 'jueves',
  5: 'viernes',
  6: 'sábados',
  7: 'domingos',
}

function places(n: number): string {
  return n === 1 ? '1 lugar' : `${n} lugares`
}

function reservedPlaces(n: number): string {
  return n === 1 ? 'apartado 1 lugar' : `apartados ${n} lugares`
}

function persons(n: number): string {
  return n === 1 ? '1 persona' : `${n} personas`
}

function birthdaysText(n: number): string {
  return n === 1 ? '1 cumple' : `${n} cumples`
}

function cakesText(n: number): string {
  return n === 1 ? '1 torta' : `${n} tortas`
}

/** "el evento" si el servicio tiene uno solo; si no, "los eventos". */
function inEventsPhrase(s: SegmentLoad): string {
  return s.events.length === 1 ? 'el evento' : 'los eventos'
}

/** "todo el almuerzo" / "toda la cena": el cuantificador concuerda con el artículo. */
function wholeSegment(key: SegmentKey): string {
  return `${key === 'lunch' ? 'todo' : 'toda'} ${SEGMENT_WITH_ARTICLE[key]}`
}

/** "Pizza libre tiene" / "Los eventos tienen", con la mayúscula donde va. */
function eventsHave(s: SegmentLoad, capitalized: boolean): string {
  const [only] = s.events
  if (s.events.length === 1 && only) return `${only.name} tiene`
  return capitalized ? 'Los eventos tienen' : 'los eventos tienen'
}

export type SegmentTone = 'none' | 'ok' | 'warn' | 'over'

/** 'none' si el servicio no tiene nada o no tiene tope (no se pinta semáforo). */
export function segmentTone(s: SegmentLoad): SegmentTone {
  if (!s.hasActivity || s.capacity === null) return 'none'
  return s.status
}

/** '119/120', o solo las personas si el servicio no tiene tope. */
export function segmentRatio(s: SegmentLoad): string {
  return s.capacity === null ? `${s.people}` : `${s.people}/${s.capacity}`
}

/**
 * El número principal: PERSONAS contra el cupo, nunca lo ocupado.
 * letter 'C 119/120' · short 'Cena 119/120' · long 'Cena · 119 de 120'.
 */
export function segmentHeadline(s: SegmentLoad, density: 'letter' | 'short' | 'long'): string {
  if (density === 'letter') return `${SEGMENT_LETTERS[s.key]} ${segmentRatio(s)}`
  if (density === 'short') return `${SEGMENT_SHORT_LABELS[s.key]} ${segmentRatio(s)}`
  const label = SEGMENT_LABELS[s.key]
  return s.capacity === null ? `${label} · ${s.people}` : `${label} · ${s.people} de ${s.capacity}`
}

/**
 * El «!» que va pegado al número cuando el número solo no explica el rojo: las
 * normales pisaron lo que apartó un evento y «Cena 58/120» parece tener 62
 * lugares. El mismo en la celda del mes, la agenda, el salón y el operativo;
 * la causa entera la da `segmentStatusLine`. null si no corresponde.
 */
export function segmentAlertMark(s: SegmentLoad): string | null {
  return s.cause === 'normals_over' ? '!' : null
}

/**
 * La decisión en una línea: cuántos lugares quedan o por qué está en rojo o
 * en ámbar. Aplica la PRIMERA regla que corresponda.
 */
export function segmentStatusLine(s: SegmentLoad): string {
  if (s.capacity === 0 && s.people === 0) return 'Cerrado'
  if (s.capacity === null) return s.people === 0 ? 'Sin tope' : `${persons(s.people)} · sin tope`
  if (!s.hasActivity) return `Libre · ${places(s.capacity)}`
  if (s.cause === 'people_over') return `Te pasaste por ${s.people - s.capacity}`
  if (s.cause === 'normals_over') {
    return `Te pasaste por ${s.occupied - s.capacity}: ${eventsHave(s, false)} ${reservedPlaces(s.reservedForEvents)}`
  }
  if (s.cause === 'warn_threshold') return s.warnNote ?? `Llegaste al aviso de ${s.warnAt}`
  const free = s.freeForNormal ?? 0
  const left = free === 1 ? 'Queda 1 lugar' : `Quedan ${free} lugares`
  return s.events.length > 0 ? `${left} para reservas normales` : left
}

/**
 * Desglose del servicio: "Sushi libre 73/70 · normales 46 de 50 · 3 cumples
 * (1 en el evento) · 1 torta (en el evento)". Sin eventos (`includeEvents:
 * false`) sirve para la agenda del celu, donde el chip del evento ya muestra su
 * carga (la celda de escritorio usa `segmentCellBreakdown`, más corta). null si
 * no hay nada que desglosar.
 */
export function segmentBreakdown(
  s: SegmentLoad,
  opts?: { includeEvents?: boolean },
): string | null {
  const parts: string[] = []
  if (opts?.includeEvents ?? true) {
    for (const e of s.events) parts.push(`${e.name} ${e.used}/${e.capacity}`)
  }
  if (s.events.length > 0 && s.normalUsed > 0) {
    parts.push(
      s.normalCap === null
        ? `${s.normalUsed} normales`
        : `normales ${s.normalUsed} de ${s.normalCap}`,
    )
  }
  if (s.birthdays.total > 0) {
    const k = s.birthdays.inEvents
    parts.push(
      `${birthdaysText(s.birthdays.total)}${k > 0 ? ` (${k} en ${inEventsPhrase(s)})` : ''}`,
    )
  }
  if (s.cakes.total > 0) {
    const n = s.cakes.total
    const k = s.cakes.inEvents
    const suffix =
      k === n ? ` (en ${inEventsPhrase(s)})` : k > 0 ? ` (${k} en ${inEventsPhrase(s)})` : ''
    parts.push(`${cakesText(n)}${suffix}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * El desglose en versión celda del mes: «46/50 normales · 3 cumples · 1 torta».
 * El dueño lo pidió visible SIN abrir el día («70 de sushi + 50 normales, de
 * las cuales 3 son cumpleaños con torta»), y la versión larga («… (1 en el
 * evento) · 1 torta (en el evento)») no entra en una celda de ~110 px: se
 * cortaba justo antes de los cumples. Acá no va el evento (su chip está debajo
 * con su carga) ni el «en el evento»: ese detalle vive en el día.
 */
export function segmentCellBreakdown(s: SegmentLoad): string | null {
  const parts: string[] = []
  if (s.events.length > 0 && s.normalUsed > 0) {
    parts.push(
      s.normalCap === null ? `${s.normalUsed} normales` : `${s.normalUsed}/${s.normalCap} normales`,
    )
  }
  if (s.birthdays.total > 0) parts.push(birthdaysText(s.birthdays.total))
  if (s.cakes.total > 0) parts.push(cakesText(s.cakes.total))
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * Nota informativa (no roja) cuando el cupo de los eventos pasa el del
 * servicio: explica por qué la cena está llena con poca gente.
 */
export function segmentEventNote(s: SegmentLoad): string | null {
  if (!s.eventExceedsSegment || s.capacity === null) return null
  const [only] = s.events
  if (s.events.length === 1 && only) {
    return `${only.name} (cupo ${s.eventCapSum}) se lleva ${wholeSegment(s.key)} de ${s.capacity}`
  }
  return `Los eventos (cupo ${s.eventCapSum}) se llevan ${wholeSegment(s.key)} de ${s.capacity}`
}

/** De dónde sale el cupo del servicio ese día. */
export function capSourceLabel(s: SegmentLoad, isoDow: IsoDow): string {
  switch (s.capSource) {
    case 'override':
      return s.capReason ? `Cupo especial: ${s.capReason}` : 'Cupo especial para este día'
    case 'weekly':
      return `Cupo de los ${DOW_PLURAL[isoDow]}`
    case 'fallback':
      return 'Cupo general del salón'
    case 'none':
      return 'Sin tope'
  }
}

/**
 * Etiqueta completa para lectores de pantalla y para el `title` de la celda:
 * "Cena, jue 10/09: 119 de 120 personas. Queda 1 lugar para reservas
 * normales. Sushi libre 73/70, normales 46 de 50, …". El color nunca es la
 * única señal.
 */
export function segmentAriaLabel(s: SegmentLoad, dayLabel: string): string {
  const label = SEGMENT_LABELS[s.key]
  const head = dayLabel ? `${label}, ${dayLabel}` : label
  const count =
    s.capacity === null ? `${persons(s.people)}, sin tope` : `${s.people} de ${s.capacity} personas`
  const parts = [`${head}: ${count}`]
  if (s.capacity !== null) parts.push(segmentStatusLine(s))
  const breakdown = segmentBreakdown(s)
  if (breakdown) parts.push(breakdown.replaceAll(' · ', ', '))
  const note = segmentEventNote(s)
  if (note) parts.push(note)
  return `${parts.join('. ')}.`
}

/**
 * Segunda línea de la agenda mobile, una por servicio con actividad y solo si
 * hay algo que decir: el estado cuando está en ámbar o rojo, el desglose sin
 * eventos y la nota de eventos que se llevan todo.
 */
export function agendaDetailLines(day: DaySegments): string[] {
  const lines: string[] = []
  for (const key of SEGMENT_KEYS) {
    const s = day.segments[key]
    if (!s.hasActivity) continue
    const tone = segmentTone(s)
    const items = [
      tone === 'warn' || tone === 'over' ? segmentStatusLine(s) : null,
      segmentBreakdown(s, { includeEvents: false }),
      segmentEventNote(s),
    ].filter((item): item is string => item !== null)
    if (items.length > 0) lines.push(`${SEGMENT_LABELS[key]}: ${items.join(' · ')}`)
  }
  return lines
}

/** Aviso de hora mal cargada, con lo que hay que hacer para arreglarlo. */
export function mismatchCopy(m: EventSegmentMismatch): string {
  const who = m.reservations === 1 ? 'su reserva es' : `sus ${m.reservations} reservas son`
  return `${m.eventName} figura a las ${m.startsAt} (${SEGMENT_LABELS[m.eventSegment].toLowerCase()}), pero ${who} de ${SEGMENT_WITH_ARTICLE[m.reservationsSegment]}. Corregí la hora del evento para que cuente en el servicio correcto.`
}

/**
 * Confirmación antes de guardar una reserva que pasa el cupo (D3). Usa los
 * mismos números que el medidor en vivo del form, así no sorprende.
 */
export function overCapacityConfirmCopy(p: SegmentProjection): {
  title: string
  body: string
  eventLine: string | null
} {
  const a = p.after
  const title = `Te pasás del cupo de ${SEGMENT_WITH_ARTICLE[p.segment]}`

  let body: string
  if (a.capacity === null) {
    body = `Quedarían ${persons(a.people)}.`
  } else if (a.cause === 'normals_over') {
    // Lo que esta reserva suma a lo OCUPADO, no las personas: sacar una
    // reserva de un evento para ponerla en Planta Alta no agrega gente (56 →
    // 56) pero pasa sus 2 al cupo de las normales, que ya no tenía lugar. Con
    // las personas decía «esta suma 0» en un aviso de sobrecupo.
    // Si no empeora lo ocupado, la confirmación ni se abre (needsConfirm),
    // pero la vista rápida igual avisa: alcanza con la causa.
    const addedSeats = a.occupied - p.before.occupied
    body =
      addedSeats > 0
        ? `${eventsHave(a, true)} ${reservedPlaces(a.reservedForEvents)}. Quedaban ${p.before.freeForNormal ?? 0} para reservas normales y esta suma ${addedSeats}.`
        : `${segmentStatusLine(a)}.`
  } else {
    const extra = a.people - a.capacity
    body =
      extra > 0
        ? `Quedarían ${a.people} de ${a.capacity} (${extra} de más).`
        : `Quedarían ${a.people} de ${a.capacity}.`
  }

  const eventLine = p.event ? `${p.event.name} quedaría ${p.event.used}/${p.event.capacity}.` : null
  return { title, body, eventLine }
}

/** Toast después de guardar: en el alta dice cómo quedó el servicio. */
export function savedToastCopy(mode: 'create' | 'edit', p: SegmentProjection | null): string {
  if (mode === 'edit') return 'Reserva actualizada'
  return p ? `Reserva cargada · ${segmentHeadline(p.after, 'long')}` : 'Reserva cargada'
}

// ──────────────────────────────────────────────────────────
// Filtro de planta del calendario (decisión del dueño, 22/09/2026)
// ──────────────────────────────────────────────────────────

/**
 * Cómo se nombra cada zona adentro de una frase. Las plantas con mayúscula,
 * como en el resto del salón ("Planta Alta"); la flotante es «Sin ubicar»:
 * reservas de evento que todavía no tienen planta.
 */
export const ZONE_PLACE_LABELS: Record<SalonZone, string> = {
  ...ZONE_LABELS,
  event_floating: UNPLACED_LABEL,
}

/** Las opciones del filtro, como las dijo el dueño: Todo · Planta alta · Planta baja · Sin ubicar. */
export const ZONE_FILTER_LABELS: Record<ZoneFilter, string> = {
  alta: 'Planta alta',
  baja: 'Planta baja',
  sin: UNPLACED_LABEL,
}

/** El rótulo de una opción del filtro; null = sin filtro («Todo»). */
export function zoneFilterLabel(filter: ZoneFilter | null): string {
  return filter === null ? 'Todo' : ZONE_FILTER_LABELS[filter]
}

/** Nombre accesible del grupo de opciones del filtro. */
export const ZONE_FILTER_GROUP_LABEL = 'Ver por planta'

/**
 * La leyenda de arriba del mes: dice QUÉ número se está viendo. Sin filtro es
 * la de siempre; con una planta, que el número es gente de esa planta contra
 * el cupo de la planta (y cuál es), no contra el del servicio.
 */
export function calendarLegend(filter: ZoneFilter | null, caps: Readonly<ZoneCaps>): string {
  if (filter === null) {
    return 'Alm · Mer · Cena = personas / cupo de cada servicio · tocá un evento para reservar adentro'
  }
  const label = ZONE_FILTER_LABELS[filter]
  if (filter === 'sin') return `${label} · personas de eventos que todavía no tienen planta`
  const cap = zoneCapacity(zoneOfFilter(filter), caps)
  return cap === null
    ? `${label} · personas (la planta no tiene cupo cargado)`
    : `${label} · personas / cupo de la planta (${cap})`
}

/** El chip del día filtrado: «Viendo Planta alta» (al lado va «Ver todo»). */
export function zoneViewingLabel(filter: ZoneFilter): string {
  return `Viendo ${ZONE_FILTER_LABELS[filter]}`
}

/** Nombre accesible del «Ver todo» que saca el filtro. */
export const ZONE_CLEAR_LABEL = 'Ver todo'
export const ZONE_CLEAR_ARIA = 'Ver todo el día, sin filtro de planta'

/** 'none' si la zona no tiene gente o no tiene tope (no se pinta semáforo). */
export function zoneTone(z: ZoneLoad): SegmentTone {
  if (!z.hasActivity || z.capacity === null) return 'none'
  return z.status
}

/** '46/60', o solo las personas si la zona no tiene tope. */
export function zoneRatio(z: ZoneLoad): string {
  return z.capacity === null ? `${z.people}` : `${z.people}/${z.capacity}`
}

/**
 * El número de la zona en un servicio, por densidad:
 * letter 'C 46/60' · short 'Cena 46/60' · long 'Cena · Planta Alta · 46 de 60'.
 * Sin tope: 'C 22' · 'Cena 22' · 'Cena · Sin ubicar · 22'.
 */
export function zoneHeadline(z: ZoneLoad, density: 'letter' | 'short' | 'long'): string {
  if (density === 'letter') return `${SEGMENT_LETTERS[z.segment]} ${zoneRatio(z)}`
  if (density === 'short') return `${SEGMENT_SHORT_LABELS[z.segment]} ${zoneRatio(z)}`
  const head = `${SEGMENT_LABELS[z.segment]} · ${ZONE_PLACE_LABELS[z.zone]}`
  return z.capacity === null ? `${head} · ${z.people}` : `${head} · ${z.people} de ${z.capacity}`
}

/**
 * La decisión en una línea, para esa planta: cuántos lugares quedan, si se
 * llenó o por cuánto se pasó. La zona flotante no tiene cupo: dice cuánta
 * gente falta ubicar.
 */
export function zoneStatusLine(z: ZoneLoad): string {
  const place = ZONE_PLACE_LABELS[z.zone]
  if (z.zone === 'event_floating') {
    return z.people === 0 ? 'Nadie sin planta' : `${persons(z.people)} sin planta`
  }
  if (z.capacity === null) {
    return z.people === 0
      ? `Nadie en ${place} · sin tope`
      : `${persons(z.people)} en ${place} · sin tope`
  }
  if (z.people > z.capacity) return `Te pasaste por ${z.people - z.capacity} en ${place}`
  if (z.people === z.capacity) return `${place} llena`
  const free = z.capacity - z.people
  return free === 1 ? `Queda 1 lugar en ${place}` : `Quedan ${free} lugares en ${place}`
}

/** El desglose de la zona en la celda del mes: '3 cumples · 1 torta'. null si no hay nada. */
export function zoneCellBreakdown(z: ZoneLoad): string | null {
  const parts: string[] = []
  if (z.birthdays > 0) parts.push(birthdaysText(z.birthdays))
  if (z.cakes > 0) parts.push(cakesText(z.cakes))
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * Etiqueta completa de la zona para lectores de pantalla y el `title`:
 * "Cena, jueves 10 de septiembre, Planta Alta: 46 de 60 personas. Quedan 14
 * lugares en Planta Alta. 3 cumples, 1 torta." El color nunca es la única señal.
 */
export function zoneAriaLabel(z: ZoneLoad, dayLabel: string): string {
  const label = SEGMENT_LABELS[z.segment]
  const head = `${dayLabel ? `${label}, ${dayLabel}` : label}, ${ZONE_PLACE_LABELS[z.zone]}`
  const count =
    z.capacity !== null
      ? `${z.people} de ${z.capacity} personas`
      : z.zone === 'event_floating'
        ? `${persons(z.people)} sin planta`
        : `${persons(z.people)}, sin tope`
  const parts = [`${head}: ${count}`]
  if (z.capacity !== null) parts.push(zoneStatusLine(z))
  const breakdown = zoneCellBreakdown(z)
  if (breakdown) parts.push(breakdown.replaceAll(' · ', ', '))
  return `${parts.join('. ')}.`
}

/**
 * La segunda línea de la agenda mobile con el filtro puesto: por servicio con
 * gente en la zona, el estado si está en ámbar o rojo y los festejos.
 */
export function zoneAgendaDetailLines(
  day: DaySegments,
  zone: SalonZone,
  caps: Readonly<ZoneCaps>,
): string[] {
  const lines: string[] = []
  for (const key of SEGMENT_KEYS) {
    const z = zoneLoad(day.segments[key], zone, caps)
    if (!z.hasActivity) continue
    const tone = zoneTone(z)
    const items = [
      tone === 'warn' || tone === 'over' ? zoneStatusLine(z) : null,
      zoneCellBreakdown(z),
    ].filter((item): item is string => item !== null)
    if (items.length > 0) lines.push(`${SEGMENT_LABELS[key]}: ${items.join(' · ')}`)
  }
  return lines
}

/**
 * En la tarjeta del evento, con el día filtrado: cuántos DE ESE EVENTO van en
 * la planta ("29 personas en Planta Alta"), o cuántos no tienen planta.
 */
export function eventZoneLine(e: Pick<SegmentEventLoad, 'byZone'>, zone: SalonZone): string {
  const n = e.byZone[zone] ?? 0
  if (zone === 'event_floating') return n === 0 ? 'Nadie sin planta' : `${persons(n)} sin planta`
  const place = ZONE_PLACE_LABELS[zone]
  return n === 0 ? `Nadie en ${place}` : `${persons(n)} en ${place}`
}

/**
 * El servicio entero, como contexto chico debajo de la planta: «Toda la cena:
 * 119/120». Sin esto, «Quedan 14 lugares en Planta Alta» con la cena ya llena
 * invitaba a vender lugares que el servicio no tiene.
 */
export function segmentWholeLine(s: SegmentLoad): string {
  const whole = wholeSegment(s.key)
  return `${whole.charAt(0).toUpperCase()}${whole.slice(1)}: ${segmentRatio(s)}`
}

/** Lo que dice un servicio en la vista del día con el filtro de planta puesto. */
export type ZoneSectionCopy = {
  /** La línea de estado: la de la planta, salvo con el servicio cerrado. */
  status: string
  /** El tono de `status` (el de la planta o, si la línea es del servicio, el suyo). */
  tone: SegmentTone
  /** «Todo el almuerzo: 0/20», o null si no hace falta. */
  whole: string | null
  /**
   * El cupo del servicio recorta el de la planta (cerrado, o más chico que
   * la planta): ahí vuelve de dónde sale el cupo («Cupo especial: …»).
   */
  serviceLimits: boolean
}

/**
 * La planta se mide contra su cupo, pero el servicio manda. Un almuerzo con
 * cupo especial 0 («evento privado») y sin reservas decía «Quedan 60 lugares
 * en Planta Alta» y escondía el «Cerrado» y el motivo: la línea del servicio
 * entero dependía de que hubiera actividad, y un servicio cerrado y vacío no
 * la tiene. Lo mismo un almuerzo de 20 contra una planta de 60.
 *
 * - Servicio cerrado → la línea es la del servicio («Cerrado», o «Te pasaste
 *   por N» si igual quedó gente), con su tono: ninguna planta tiene lugar.
 * - La línea chica del servicio entero va si tiene actividad (como antes) o si
 *   su cupo recorta el de la planta, aunque esté vacío. Cerrado y sin gente no
 *   la lleva: «Todo el almuerzo: 0/0» repetiría el «Cerrado».
 * - Sin cupo por planta (o «Sin ubicar») no hay nada que recortar: la planta
 *   ya dice «sin tope» y no ofrece un número de lugares.
 */
export function zoneSectionCopy(s: SegmentLoad, z: ZoneLoad): ZoneSectionCopy {
  const closed = s.capacity === 0
  const serviceLimits =
    s.capacity !== null && (closed || (z.capacity !== null && s.capacity < z.capacity))
  const showWhole = (s.hasActivity || serviceLimits) && !(closed && s.people === 0)
  return {
    status: closed ? segmentStatusLine(s) : zoneStatusLine(z),
    tone: closed ? segmentTone(s) : zoneTone(z),
    whole: showWhole ? segmentWholeLine(s) : null,
    serviceLimits,
  }
}
