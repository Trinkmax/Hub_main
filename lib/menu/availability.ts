/**
 * Cuándo se muestra un rubro de la carta — PURO y testeado (`tests/lib/menu-availability.test.ts`).
 *
 * Pedido de los socios (22/11/2026): «agregar en carta menús al mediodía, debe aparecer en determinados
 * horarios» y «fines de semana debe aparecer únicamente el menú del fin de semana».
 *
 * Un rubro puede tener una o más franjas: qué días y entre qué horas se muestra. Sin franjas se
 * muestra siempre (es lo de siempre, y lo que pasa con todos los rubros que nadie tocó). El horario lo
 * heredan sus subrubros y sus productos: si «Menú del mediodía» no está, tampoco lo de adentro.
 *
 * Las horas son las del bar (su zona horaria), no las del teléfono de quien mira. Una franja que
 * termina antes de lo que empieza cruza la medianoche («de 20 a 2»): la madrugada cuenta como parte
 * del día en que empezó, igual que el día de servicio del salón.
 *
 * Lo usan la carta pública (el servidor filtra y le dice al teléfono cuándo volver a mirar), el pedido
 * del mozo (filtra con el reloj) y el editor de la carta (lo dice en palabras).
 */
import { z } from 'zod'

/** 0 = domingo … 6 = sábado (como `Date#getDay` y `extract(dow)` de Postgres). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type AvailabilityWindow = {
  /** Los días en que vale. Vacío = todos. */
  days: Weekday[]
  /** «HH:MM», hora del bar. `null` = desde que empieza el día. */
  from: string | null
  /** «HH:MM». `null` = hasta que termina. Menor que `from` = cruza la medianoche. */
  to: string | null
}

/** `null` = siempre. */
export type Availability = { windows: AvailabilityWindow[] } | null

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/
const DAY_MINUTES = 24 * 60

const windowSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  from: z.string().regex(TIME).nullable().default(null),
  to: z.string().regex(TIME).nullable().default(null),
})

/** Lo que se guarda en `menu_categories.availability`. Hasta seis franjas por rubro. */
export const availabilitySchema = z
  .object({ windows: z.array(windowSchema).max(6) })
  .nullable()
  .transform((value): Availability => normalizeAvailability(value))

function minutesOf(time: string | null): number | null {
  if (time === null) return null
  const match = TIME.exec(time)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function cleanWindow(window: {
  days: readonly number[]
  from: string | null
  to: string | null
}): AvailabilityWindow {
  const days = [...new Set(window.days)]
    .filter((day): day is Weekday => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b)
  const from = minutesOf(window.from) === null ? null : window.from
  const to = minutesOf(window.to) === null ? null : window.to
  // «De 00:00 a 00:00» y «de X a X» son el día entero.
  const wholeDay =
    from === to || (minutesOf(from) ?? 0) === (minutesOf(to) ?? DAY_MINUTES) % DAY_MINUTES
  return {
    // Los siete días es lo mismo que no elegir ninguno.
    days: days.length === 7 ? [] : days,
    from: wholeDay ? null : from,
    to: wholeDay ? null : to,
  }
}

/** Deja el horario en su forma más simple. Una franja de todos los días y todo el día es «siempre». */
export function normalizeAvailability(
  value: {
    windows: readonly { days: readonly number[]; from: string | null; to: string | null }[]
  } | null,
): Availability {
  if (!value) return null
  const windows = value.windows.map(cleanWindow)
  if (windows.length === 0) return null
  if (windows.some((w) => w.days.length === 0 && w.from === null && w.to === null)) return null
  return { windows }
}

/** Lo que viene de la base, sin confiar en su forma. Algo ilegible se lee como «siempre»: mejor mostrar de más. */
export function parseAvailability(raw: unknown): Availability {
  if (raw === null || raw === undefined) return null
  const parsed = availabilitySchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>()
const WEEKDAY_INDEX: Readonly<Record<string, Weekday>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

/** El día de la semana y los minutos del día de un instante, en la zona del bar. */
export function localClock(at: Date | number, timeZone: string): { day: Weekday; minutes: number } {
  let formatter = zoneFormatters.get(timeZone)
  if (!formatter) {
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }
    try {
      formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone })
    } catch {
      formatter = new Intl.DateTimeFormat('en-US', {
        ...options,
        timeZone: 'America/Argentina/Cordoba',
      })
    }
    zoneFormatters.set(timeZone, formatter)
  }
  const parts = formatter.formatToParts(typeof at === 'number' ? new Date(at) : at)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  const hour = Number(read('hour')) % 24
  const minute = Number(read('minute'))
  return {
    day: WEEKDAY_INDEX[read('weekday')] ?? 0,
    minutes: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0),
  }
}

const previousDay = (day: Weekday): Weekday => ((day + 6) % 7) as Weekday

function windowMatches(window: AvailabilityWindow, day: Weekday, minutes: number): boolean {
  const from = minutesOf(window.from) ?? 0
  const to = minutesOf(window.to) ?? DAY_MINUTES
  const onDay = (candidate: Weekday) => window.days.length === 0 || window.days.includes(candidate)
  if (to > from) return onDay(day) && minutes >= from && minutes < to
  // Cruza la medianoche: la madrugada es del día en que empezó.
  return (onDay(day) && minutes >= from) || (onDay(previousDay(day)) && minutes < to)
}

/** ¿Se muestra ahora? */
export function isAvailableAt(
  availability: Availability,
  at: Date | number,
  timeZone: string,
): boolean {
  if (!availability || availability.windows.length === 0) return true
  const { day, minutes } = localClock(at, timeZone)
  return availability.windows.some((window) => windowMatches(window, day, minutes))
}

/**
 * En cuántos minutos puede cambiar lo que se muestra: el próximo comienzo o final de una franja, o la
 * medianoche (cambia el día). `null` si nada tiene horario. Es «cuándo volver a mirar», no «cuándo
 * cambia seguro»: con eso alcanza para refrescar la carta abierta en un teléfono.
 */
export function minutesToNextChange(
  availabilities: ReadonlyArray<Availability>,
  at: Date | number,
  timeZone: string,
): number | null {
  const edges = new Set<number>()
  for (const availability of availabilities) {
    for (const window of availability?.windows ?? []) {
      edges.add(minutesOf(window.from) ?? 0)
      edges.add((minutesOf(window.to) ?? DAY_MINUTES) % DAY_MINUTES)
    }
  }
  if (edges.size === 0) return null
  edges.add(0)
  const { minutes } = localClock(at, timeZone)
  let best = DAY_MINUTES
  for (const edge of edges) {
    const wait = (edge - minutes + DAY_MINUTES) % DAY_MINUTES || DAY_MINUTES
    if (wait < best) best = wait
  }
  return best
}

/**
 * Lo mismo que `minutesToNextChange`, al milisegundo: descuenta lo que ya pasó del minuto en curso.
 * (Los husos van de a minutos enteros: los segundos son los mismos acá y en el bar.)
 */
export function msToNextChange(
  availabilities: ReadonlyArray<Availability>,
  at: Date | number,
  timeZone: string,
): number | null {
  const minutes = minutesToNextChange(availabilities, at, timeZone)
  if (minutes === null) return null
  const ms = typeof at === 'number' ? at : at.getTime()
  const intoMinute = ((ms % 60_000) + 60_000) % 60_000
  return minutes * 60_000 - intoMinute
}

// ─── Aplicarlo a un árbol de rubros ──────────────────────────────────────────

type Node = { id: string; parent_id: string | null; availability?: unknown }

/**
 * Los rubros que NO se muestran ahora: los que están fuera de su horario y todo lo que cuelga de ellos.
 * (Sacar solo al padre dejaría a sus subrubros sueltos en la raíz de la carta.)
 */
export function hiddenCategoryIds(
  categories: ReadonlyArray<Node>,
  at: Date | number,
  timeZone: string,
): Set<string> {
  const byId = new Map(categories.map((category) => [category.id, category]))
  const verdict = new Map<string, boolean>()
  const hiddenNow = (id: string, depth: number): boolean => {
    const known = verdict.get(id)
    if (known !== undefined) return known
    const category = byId.get(id)
    if (!category) return false
    // Un círculo (A cuelga de B y B de A) no puede colgar la pantalla.
    verdict.set(id, false)
    const own = !isAvailableAt(parseAvailability(category.availability), at, timeZone)
    const inherited =
      !own && depth < 12 && category.parent_id ? hiddenNow(category.parent_id, depth + 1) : false
    verdict.set(id, own || inherited)
    return own || inherited
  }
  const hidden = new Set<string>()
  for (const category of categories) if (hiddenNow(category.id, 0)) hidden.add(category.id)
  return hidden
}

/**
 * La carta como se ve ahora: sin los rubros fuera de horario (con todo lo que cuelga de ellos) ni sus
 * productos. `changeInMs` dice en cuánto puede cambiar, para que la carta abierta en un teléfono se
 * vuelva a pedir sola en ese momento; `null` si ningún rubro tiene horario.
 */
export function visibleNow<Category extends Node, Item extends { category_id: string | null }>(
  menu: { categories: ReadonlyArray<Category>; items: ReadonlyArray<Item> },
  at: Date | number,
  timeZone: string,
): { categories: Category[]; items: Item[]; changeInMs: number | null } {
  const changeInMs = msToNextChange(
    menu.categories.map((category) => parseAvailability(category.availability)),
    at,
    timeZone,
  )
  // Sin horarios (casi todos los bares) no hay nada que mirar ni que copiar.
  if (changeInMs === null) {
    return { categories: [...menu.categories], items: [...menu.items], changeInMs }
  }
  const hidden = hiddenCategoryIds(menu.categories, at, timeZone)
  if (hidden.size === 0) {
    return { categories: [...menu.categories], items: [...menu.items], changeInMs }
  }
  return {
    categories: menu.categories.filter((category) => !hidden.has(category.id)),
    items: menu.items.filter((item) => item.category_id === null || !hidden.has(item.category_id)),
    changeInMs,
  }
}

// ─── Decirlo en palabras ─────────────────────────────────────────────────────

const DAY_NAMES = [
  'domingos',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábados',
] as const
const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const
/** La semana como se dice acá: de lunes a domingo. */
export const WEEK_ORDER: ReadonlyArray<Weekday> = [1, 2, 3, 4, 5, 6, 0]

export function dayShort(day: Weekday): string {
  return DAY_SHORT[day]
}

/** «lunes», «sábados»: el día como se nombra en una oración. */
export function dayName(day: Weekday): string {
  return DAY_NAMES[day]
}

function listed(items: ReadonlyArray<string>): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

/** Los días dichos, y de qué manera: todos, un tramo corrido («X a Y») o una lista. */
function daysParts(days: ReadonlyArray<Weekday>): { kind: 'all' | 'range' | 'list'; text: string } {
  const set = new Set(days)
  if (set.size === 0 || set.size === 7) return { kind: 'all', text: 'todos los días' }
  const ordered = WEEK_ORDER.filter((day) => set.has(day))
  // Un tramo corrido de tres o más días se dice «de X a Y».
  const positions = ordered.map((day) => WEEK_ORDER.indexOf(day))
  const first = positions[0] ?? 0
  const consecutive = positions.every((position, index) => position === first + index)
  const head = ordered[0]
  const tail = ordered[ordered.length - 1]
  if (consecutive && ordered.length >= 3 && head !== undefined && tail !== undefined) {
    return { kind: 'range', text: `${DAY_NAMES[head]} a ${DAY_NAMES[tail]}` }
  }
  return { kind: 'list', text: listed(ordered.map((day) => DAY_NAMES[day])) }
}

/** «lunes a viernes», «sábados y domingos», «martes, jueves y sábados», «todos los días». */
export function daysWords(days: ReadonlyArray<Weekday>): string {
  return daysParts(days).text
}

/** «12» o «12:30»: una hora como se dice, sin los minutos si son cero. */
function hourWords(time: string): string {
  const [hour, minute] = time.split(':')
  return minute === '00' ? String(Number(hour)) : `${Number(hour)}:${minute}`
}

export function hoursWords(window: Pick<AvailabilityWindow, 'from' | 'to'>): string {
  if (window.from === null && window.to === null) return 'todo el día'
  if (window.from !== null && window.to !== null) {
    return `de ${hourWords(window.from)} a ${hourWords(window.to)} h`
  }
  return window.from !== null
    ? `desde las ${hourWords(window.from)} h`
    : `hasta las ${hourWords(window.to ?? '00:00')} h`
}

/** «Lunes a viernes de 12 a 16 h». Varias franjas, separadas por « · ». `null` = siempre. */
export function availabilityWords(availability: Availability): string | null {
  if (!availability || availability.windows.length === 0) return null
  return availability.windows
    .map((window) => {
      const text = `${daysWords(window.days)} ${hoursWords(window)}`
      return text.charAt(0).toUpperCase() + text.slice(1)
    })
    .join(' · ')
}

/**
 * La oración del editor: «Se muestra de lunes a viernes de 12 a 16 h.», «Se muestra los sábados y
 * domingos todo el día.», «Se muestra siempre.». Varias franjas se unen con «y».
 */
export function availabilitySentence(availability: Availability): string {
  const normal = normalizeAvailability(availability)
  if (!normal) return 'Se muestra siempre.'
  const parts = normal.windows.map((window) => {
    const days = daysParts(window.days)
    const lead = days.kind === 'range' ? 'de ' : days.kind === 'list' ? 'los ' : ''
    return `${lead}${days.text} ${hoursWords(window)}`
  })
  return `Se muestra ${listed(parts)}.`
}

// ─── El editor ───────────────────────────────────────────────────────────────

/** Hasta cuántas franjas tiene un rubro (lo mismo que acepta `availabilitySchema`). */
export const MAX_WINDOWS = 6

/**
 * Una franja como se edita: los días siempre a la vista (los siete = todos) y «todo el día» aparte
 * de las horas, que quedan escritas aunque se apague. Una hora vacía es «sin límite» de ese lado.
 */
export type WindowDraft = {
  days: Weekday[]
  allDay: boolean
  /** «HH:MM» o vacío. */
  from: string
  to: string
}

const ALL_DAYS: ReadonlyArray<Weekday> = [0, 1, 2, 3, 4, 5, 6]

/** La franja con la que arranca «Agregar otra franja»: todos los días, del mediodía a la tarde. */
export function newWindowDraft(): WindowDraft {
  return { days: [...ALL_DAYS], allDay: false, from: '12:00', to: '16:00' }
}

/** Lo guardado → lo que se edita. `null` (siempre) no tiene franjas. */
export function toDrafts(availability: Availability): WindowDraft[] {
  const normal = normalizeAvailability(availability)
  if (!normal) return []
  return normal.windows.map((window) => ({
    days: window.days.length === 0 ? [...ALL_DAYS] : [...window.days],
    allDay: window.from === null && window.to === null,
    from: window.from ?? (window.to === null ? '12:00' : ''),
    to: window.to ?? (window.from === null ? '16:00' : ''),
  }))
}

/** Lo que se edita → lo que se guarda, ya en su forma más simple (`null` = siempre). */
export function fromDrafts(drafts: ReadonlyArray<WindowDraft>): Availability {
  return normalizeAvailability({
    windows: drafts.map((draft) => ({
      days: draft.days,
      from: draft.allDay || draft.from === '' ? null : draft.from,
      to: draft.allDay || draft.to === '' ? null : draft.to,
    })),
  })
}

/** Prende o apaga un día. El último que queda no se apaga: una franja sin días no existe. */
export function toggleDraftDay(draft: WindowDraft, day: Weekday): WindowDraft {
  const has = draft.days.includes(day)
  if (has && draft.days.length === 1) return draft
  const days = has ? draft.days.filter((each) => each !== day) : [...draft.days, day]
  return { ...draft, days: days.sort((a, b) => a - b) }
}

/** ¿La franja termina al día siguiente? («de 20 a 3») */
export function crossesMidnight(draft: Pick<WindowDraft, 'allDay' | 'from' | 'to'>): boolean {
  if (draft.allDay) return false
  const from = minutesOf(draft.from === '' ? null : draft.from)
  const to = minutesOf(draft.to === '' ? null : draft.to)
  return from !== null && to !== null && to < from
}

// ─── Atajos del editor ───────────────────────────────────────────────────────

export type AvailabilityPreset = { id: string; label: string; value: Availability }

/** Los horarios que un bar arma casi siempre: se eligen con un toque y después se ajustan. */
export const AVAILABILITY_PRESETS: ReadonlyArray<AvailabilityPreset> = [
  { id: 'always', label: 'Siempre', value: null },
  {
    id: 'weekday-lunch',
    label: 'Mediodía de lunes a viernes',
    value: { windows: [{ days: [1, 2, 3, 4, 5], from: '12:00', to: '16:00' }] },
  },
  {
    id: 'weekend',
    label: 'Fin de semana',
    value: { windows: [{ days: [0, 6], from: null, to: null }] },
  },
  {
    id: 'weekdays',
    label: 'De lunes a viernes',
    value: { windows: [{ days: [1, 2, 3, 4, 5], from: null, to: null }] },
  },
  {
    id: 'nights',
    label: 'Solo de noche',
    value: { windows: [{ days: [], from: '20:00', to: '03:00' }] },
  },
]

export function sameAvailability(a: Availability, b: Availability): boolean {
  return JSON.stringify(normalizeAvailability(a)) === JSON.stringify(normalizeAvailability(b))
}
