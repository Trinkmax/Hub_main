/**
 * El muro de mesas, en palabras y en sillas: todo lo que el componente dibuja
 * sale de acá, así que se testea sin navegador.
 *
 * El dueño pidió que el muro fuera "más lindo o visual". La respuesta no es
 * decorarlo: es que cada puntito sea UNA persona. Una mesa es un tablero con una
 * silla por persona, alternando arriba y abajo, y el largo del tablero sigue
 * siendo exactamente la gente reservada — la misma unidad en todas las fichas
 * de la pantalla, sin piso de ancho, así que una mesa de 2 y una de 3 no miden
 * igual justo en el tamaño más frecuente del bar.
 *
 * Reglas que fija este archivo:
 *
 * - **Las sillas cuentan lo que se sabe, en este orden: sentadas, vacías, de
 *   más.** Una mesa de 7 cerrada con 6 dibuja 6 sillas llenas y 1 hueca; una de
 *   4 que se cerró con 6 dibuja 4 llenas y 2 "se sumó" colgando al final.
 * - **Una mesa sin cerrar no inventa asistencia.** Todas sus sillas son
 *   "no sabemos": ni llenas ni vacías. Es la misma regla del reporte — el
 *   numerador nunca se completa con el estimado.
 * - **Una caída no tiene sillas.** Es una rayita fina en su propia fila: esa
 *   gente no se sentó y no puede competir con la que sí.
 * - **El color nunca es la única pista.** Lleno / hueco / tenue, tablero liso /
 *   rayado / rayita, y siempre el texto de `tableReadout`.
 *
 * Puro: sin DB ni React.
 */

import type { TableChip } from './events-report'

export type SeatState = 'sat' | 'empty' | 'unknown' | 'extra' | 'none'

/** Una silla ya ubicada: en qué riel va y si abre o cierra el tablero. */
export type WallSeat = {
  /** Estable dentro de la mesa: sirve de `key` sin usar el índice del map. */
  key: string
  state: SeatState
  /** Pares arriba, impares abajo: las sillas se enfrentan como en una mesa. */
  pos: 'top' | 'bottom'
  /** Primer tramo del tablero: lleva el borde y las esquinas de inicio. */
  start: boolean
  /** Último tramo del tablero (sin contar los "se sumó"): borde y esquinas de cierre. */
  end: boolean
}

export type WallLegendFlags = {
  counted: boolean
  empty: boolean
  extra: boolean
  open: boolean
  fallen: boolean
}

/** Lo que dice el muro cuando no hay ninguna mesa activa. */
export const WALL_IDLE_READOUT = 'Cada puntito es una persona. Pasá el mouse o tocá una mesa.'

function repeat(state: SeatState, n: number): SeatState[] {
  return Array.from({ length: Math.max(0, n) }, () => state)
}

/**
 * Una entrada por persona dibujada.
 *
 * - caída → `none` × reservadas
 * - sin cerrar → `unknown` × reservadas
 * - contada → `sat` × min(vinieron, reservadas), `empty` × lo que faltó,
 *   `extra` × lo que sobró
 */
export function seatStates(t: TableChip): SeatState[] {
  if (t.state === 'fallen') return repeat('none', t.guests)
  if (t.state === 'open' || t.attended === null) return repeat('unknown', t.guests)
  const a = t.attended
  const g = t.guests
  return [...repeat('sat', Math.min(a, g)), ...repeat('empty', g - a), ...repeat('extra', a - g)]
}

/**
 * Las sillas con su riel y sus bordes. El cierre del tablero va en la última
 * silla RESERVADA: los "se sumó" cuelgan afuera, sobre una línea punteada, así
 * que el tablero termina donde terminaba la reserva.
 */
export function wallSeats(t: TableChip): WallSeat[] {
  const states = seatStates(t)
  let lastReserved = -1
  states.forEach((s, i) => {
    if (s !== 'extra') lastReserved = i
  })
  return states.map((state, i) => ({
    key: `s${i}`,
    state,
    pos: i % 2 === 0 ? 'top' : 'bottom',
    start: i === 0,
    end: i === lastReserved,
  }))
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

function tableDetail(t: TableChip): string {
  if (t.state === 'fallen') {
    if (t.fallenReason === 'cancelled') return 'la cancelaron'
    if (t.fallenReason === 'no_show') return plural(t.guests, 'no vino', 'no vinieron')
    return 'se cayó'
  }
  if (t.state === 'open' || t.attended === null) {
    return 'quedó sin cerrar: no sabemos cuántos vinieron'
  }
  const a = t.attended
  const g = t.guests
  if (a === 0) return 'se cerró sin nadie'
  if (a === g) return g === 1 ? 'vino' : `vinieron los ${g}`
  const vinieron = a === 1 ? 'vino 1' : `vinieron ${a}`
  if (a < g) {
    const n = g - a
    return `${vinieron}, ${n === 1 ? 'quedó 1 silla vacía' : `quedaron ${n} sillas vacías`}`
  }
  const n = a - g
  return `${vinieron}, ${n === 1 ? 'se sumó 1' : `se sumaron ${n}`}`
}

/**
 * Lo que se lee arriba del muro al pasar el mouse, tocar o tabular una mesa.
 *
 * En la base el nombre de mesa es un número pelado ("2"), pero nada impide que
 * alguien escriba "Mesa 2": se saca el prefijo para no decir "Mesa Mesa 2".
 */
export function tableReadout(t: TableChip): { title: string; detail: string } {
  const label = t.label ? t.label.replace(/^mesa\s+/i, '').trim() : ''
  const title = label ? `Mesa ${label} (de ${t.guests})` : `Mesa de ${t.guests}`
  return { title, detail: tableDetail(t) }
}

/** Mesas en pie primero (en el orden del reporte), caídas después. */
export function splitWall(tables: ReadonlyArray<TableChip>): {
  standing: TableChip[]
  fallen: TableChip[]
} {
  return {
    standing: tables.filter((t) => t.state !== 'fallen'),
    fallen: tables.filter((t) => t.state === 'fallen'),
  }
}

/** `Mesas de Noche Astral: 11 en pie y 2 caídas. Cada puntito es una persona.` */
export function wallAriaLabel(title: string, tables: ReadonlyArray<TableChip>): string {
  const { standing, fallen } = splitWall(tables)
  const enPie = standing.length === 0 ? 'ninguna en pie' : `${standing.length} en pie`
  const caidas =
    fallen.length === 0 ? '' : ` y ${fallen.length} ${plural(fallen.length, 'caída', 'caídas')}`
  return `Mesas de ${title}: ${enPie}${caidas}. Cada puntito es una persona.`
}

/** El rótulo de la fila de caídas: `se cayeron · 2 (4 personas)`. */
export function fallenGroupLabel(fallen: ReadonlyArray<TableChip>): string {
  const people = fallen.reduce((n, t) => n + t.guests, 0)
  return `${plural(fallen.length, 'se cayó', 'se cayeron')} · ${fallen.length} (${people} ${plural(people, 'persona', 'personas')})`
}

/**
 * Qué referencias van en la leyenda: solo las que están dibujadas en pantalla.
 * Una referencia de algo que no aparece obliga a buscarlo.
 */
export function legendFlags(tables: ReadonlyArray<TableChip>): WallLegendFlags {
  const flags: WallLegendFlags = {
    counted: false,
    empty: false,
    extra: false,
    open: false,
    fallen: false,
  }
  for (const t of tables) {
    if (t.state === 'fallen') flags.fallen = true
    else if (t.state === 'open' || t.attended === null) flags.open = true
    else {
      flags.counted = true
      if (t.attended < t.guests) flags.empty = true
      if (t.attended > t.guests) flags.extra = true
    }
  }
  return flags
}

/**
 * Tabindex itinerante: el muro es UNA parada de Tab y las flechas se mueven de
 * mesa en mesa en el orden en que se leen (arriba y abajo avanzan igual que los
 * costados: con filas que se parten solas, "la de abajo" no es estable). Frena en
 * los extremos; Inicio y Fin saltan. `null` si la tecla no es de navegación.
 */
export function nextWallIndex(current: number, key: string, length: number): number | null {
  if (length <= 0) return null
  const last = length - 1
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.min(current + 1, last)
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.max(current - 1, 0)
    case 'Home':
      return 0
    case 'End':
      return last
    default:
      return null
  }
}
