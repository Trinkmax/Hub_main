import { z } from 'zod'
import { lastSeatsThreshold } from './availability'
import { monthTitle } from './dates'

/**
 * El cupo de cada función, desde Ventas online › Funciones. Pedido de los socios del
 * 11/11/2026: «normalmente va a ser 54, el del cine, pero necesitamos poder manipularlo
 * nosotros», y lo tiene que poder cambiar Luz. Puro: lo usan la pantalla, la action y los tests.
 */

/** El mismo techo que el cupo de un evento del calendario (lib/salon/schemas.ts). */
export const FUNCTION_CAPACITY_MAX = 999

export const functionCapacitySchema = z.object({
  event_id: z.string().uuid('Esa función no existe.'),
  capacity: z
    .number({ error: 'Poné cuántas personas entran.' })
    .int('Tiene que ser un número entero.')
    .min(1, 'Tiene que entrar al menos una persona.')
    .max(FUNCTION_CAPACITY_MAX, `Como mucho entran ${FUNCTION_CAPACITY_MAX}.`),
})

export type FunctionCapacityInput = z.infer<typeof functionCapacitySchema>

/** Lo que se escribió en el cupo: un número entero que sirva, o por qué no. */
export function parseCapacityDraft(
  raw: string,
): { ok: true; capacity: number } | { ok: false; message: string } {
  const text = raw.trim()
  // Number('') es 0: un cupo vacío tiene que fallar, no cerrar la función.
  if (!text) return { ok: false, message: 'Poné cuántas personas entran.' }
  if (!/^\d+$/.test(text)) return { ok: false, message: 'Tiene que ser un número entero.' }
  const capacity = Number(text)
  if (capacity < 1) return { ok: false, message: 'Tiene que entrar al menos una persona.' }
  if (capacity > FUNCTION_CAPACITY_MAX) {
    return { ok: false, message: `Como mucho entran ${FUNCTION_CAPACITY_MAX}.` }
  }
  return { ok: true, capacity }
}

/**
 * El cupo no puede quedar por debajo de lo que ya está reservado: la gente con reserva entra
 * igual. Para cortar la venta alcanza con dejarlo justo en lo reservado.
 */
export function capacityBelowReserved(capacity: number, reserved: number): string | null {
  if (capacity >= reserved) return null
  return reserved === 1
    ? 'Ya hay 1 persona reservada: el cupo no puede ser menos.'
    : `Ya hay ${reserved} personas reservadas: el cupo no puede ser menos.`
}

export type CapacityTone = 'open' | 'last' | 'full' | 'over'

type CapacityNumbers = { capacity: number; reserved: number; paying: number; left: number }

/**
 * Cómo viene la función, para la línea debajo de la barrita: «Quedan 6», «Agotado»,
 * «Se pasó por 2», más los que están pagando ahora (su lugar está guardado).
 */
export function capacityView(fn: CapacityNumbers): { tone: CapacityTone; label: string } {
  const paying = fn.paying > 0 ? ` · ${fn.paying} pagando ahora` : ''
  if (fn.reserved > fn.capacity) {
    return { tone: 'over', label: `Se pasó por ${fn.reserved - fn.capacity}` }
  }
  if (fn.left <= 0) return { tone: 'full', label: `Agotado${paying}` }
  const left = fn.left === 1 ? 'Queda 1 lugar' : `Quedan ${fn.left}`
  const tone = fn.left <= lastSeatsThreshold(fn.capacity) ? 'last' : 'open'
  return { tone, label: `${left}${paying}` }
}

/** Qué parte del cupo está reservada o pagándose, de 0 a 100, para la barrita. */
export function capacityPercent(fn: CapacityNumbers): number {
  if (fn.capacity <= 0) return 100
  const used = Math.min(fn.capacity, fn.reserved + fn.paying)
  return Math.round((used / fn.capacity) * 100)
}

/**
 * Las películas que tienen funciones por delante, sin repetir y en el orden en que viene su
 * próxima función: los chips para filtrar la lista.
 */
export function filmsOf<T extends { slug: string; title: string }>(
  functions: ReadonlyArray<T>,
): Array<{ slug: string; title: string; count: number }> {
  const films = new Map<string, { slug: string; title: string; count: number }>()
  for (const fn of functions) {
    const film = films.get(fn.slug)
    if (film) film.count += 1
    else films.set(fn.slug, { slug: fn.slug, title: fn.title, count: 1 })
  }
  return [...films.values()]
}

/** Las funciones agrupadas por mes («Noviembre 2026»), en el orden en que vienen. */
export function groupByMonth<T extends { date: string }>(
  functions: ReadonlyArray<T>,
): Array<{ key: string; title: string; functions: T[] }> {
  const groups: Array<{ key: string; title: string; functions: T[] }> = []
  for (const fn of functions) {
    const key = fn.date.slice(0, 7)
    const last = groups.at(-1)
    if (last && last.key === key) last.functions.push(fn)
    else groups.push({ key, title: monthTitle(fn.date), functions: [fn] })
  }
  return groups
}
