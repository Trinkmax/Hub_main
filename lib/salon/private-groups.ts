/**
 * «Grupo privado»: una fecha del calendario que NO es un evento para «Cómo nos
 * fue» (comentario C1 de los socios, 02/10/2026: «usamos los templates para ver
 * en el calendario cuando hay una "merienda libre" o "pizza libre", y el
 * reporte lo toma como un evento que se pautó […] deberían salir del reporte
 * porque estamos viendo EVENTOS»).
 *
 * Reglas (las cuida la DB y las queries; acá viven las palabras):
 *
 * G1. **El tilde es por FECHA** (`scheduled_events.private_group`). Pizza libre
 *     es mixto: hay noches abiertas con pauta y grupos que piden el formato.
 *     El formato solo trae el default de las fechas nuevas
 *     (`default_private_group`, «Se usa para grupos privados»).
 * G2. **Ocupa lugar igual**: cupo, calendario, comisiones y puntos por
 *     asistencia no cambian. Sus cumples siguen contando en «Cumpleaños» (pero
 *     no «dentro de un evento»: no lo es).
 * G3. **Sale del reporte de EVENTOS**: no es una edición en «Por evento» ni en
 *     «Pauta», y no se le pide pauta. Se nombra al pie para que nadie lo busque.
 * G4. **Su gente no desaparece de la noche**: en «Por día» va en su propia
 *     franja, después de los eventos y antes de «Sin evento», y los totales de
 *     la noche la cuentan.
 * G5. **No lleva pauta ni la plata de la noche** (triggers de la migración
 *     20261002120000): marcar privada una fecha con plata, o cargar plata en
 *     una privada, rebota con un código que acá se traduce.
 *
 * Puro: sin DB, sin React y sin `Intl` (se dibuja en el server y en el cliente).
 */

import { formatCount, formatDayMonth } from './event-marketing'

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Una fecha privada que se nombra (al pie de la pestaña «Pauta»). */
export type PrivateGroupRef = { eventId: string; date: string; title: string }

/** Un reporte del mes con sus grupos privados, que NO están en sus ediciones. */
export type WithPrivateGroups<T> = T & { privateGroups: PrivateGroupRef[] }

// ─── Palabras ────────────────────────────────────────────────────────────────

/** Cómo se rotula en la planilla del día: `Pizza libre (grupo privado)`. */
export const PRIVATE_GROUP_LABEL = 'grupo privado'

/** El chip de la franja en «Por día», del calendario y el botón de los pendientes. */
export const PRIVATE_GROUP_CHIP = 'Grupo privado'

/** Debajo del título de la franja de un grupo privado en «Por día». */
export const PRIVATE_BLOCK_NOTE =
  'No sale en los reportes de eventos: ocupa lugar en el salón, pero no es un evento.'

/** El `title` del candado en los chips del calendario. */
export const PRIVATE_GROUP_CALENDAR_TITLE =
  'Grupo privado: ocupa cupo, pero no sale en Cómo nos fue'

/** El link de la franja: el tilde se cambia en la fecha del calendario. */
export const PRIVATE_BLOCK_LINK = 'Ver en el calendario'

/** El tilde de la FECHA (editor de la fecha y diálogo de programar). */
export const PRIVATE_GROUP_SWITCH = {
  label: 'Grupo privado — no sale en Cómo nos fue',
  hint: 'Un festejo o un grupo que pidió el formato, no un evento abierto. Ocupa cupo y suma comisiones como siempre: solo sale de los reportes de eventos.',
} as const

/** El tilde del FORMATO (Formatos). Solo decide cómo nacen las fechas nuevas. */
export const TEMPLATE_PRIVATE_SWITCH = {
  label: 'Se usa para grupos privados',
  /** Rótulo apilado de la columna en desktop (como «Consume cupo / en cumples»). */
  stacked: ['Grupos', 'privados'] as const,
  hint: 'Las fechas nuevas de este formato nacen marcadas «Grupo privado». Se puede cambiar en cada fecha, y no toca las que ya están en el calendario.',
} as const

/**
 * El botón «Grupo privado» de una fecha pendiente de la pestaña «Pauta». El
 * nombre accesible CONTIENE el texto visible (WCAG 2.5.3), con la misma forma
 * que «No tuvo pauta» (`Pizza libre 18/09: no tuvo pauta`).
 */
export function privateGroupPendingCopy(
  eventTitle: string,
  eventDate: string,
): { label: string; ariaLabel: string; toast: string; undoneToast: string } {
  const what = `${eventTitle} ${formatDayMonth(eventDate)}`
  return {
    label: PRIVATE_GROUP_CHIP,
    ariaLabel: `${what}: grupo privado`,
    toast: `${what} quedó como grupo privado: sale de los reportes de eventos.`,
    undoneToast: 'Listo: volvió a contar como evento.',
  }
}

// ─── Notas ───────────────────────────────────────────────────────────────────

/**
 * Al pie de «Rentabilidad» y «Conversión» (y en sus planillas): las fechas del
 * formato que son grupos privados no son fechas del evento. `null` sin ninguna.
 */
export function privateEditionsNote(count: number): string | null {
  if (count <= 0) return null
  return count === 1
    ? 'No cuenta 1 fecha de grupo privado: ocupa lugar en el salón, pero no es un evento. Se ve en «Por día».'
    : `No cuentan ${formatCount(count)} fechas de grupo privado: ocupan lugar en el salón, pero no son eventos. Se ven en «Por día».`
}

/**
 * Al pie de la pestaña «Pauta»: los grupos privados del mes, con nombre y
 * fecha, en orden. `null` sin ninguno.
 */
export function monthPrivateGroupsNote(groups: ReadonlyArray<PrivateGroupRef>): string | null {
  if (groups.length === 0) return null
  const sorted = [...groups].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const list = sorted.map((g) => `${g.title} ${formatDayMonth(g.date)}`).join(' · ')
  return groups.length === 1
    ? `No cuenta 1 fecha de grupo privado: ${list}. Ocupa lugar en el salón, pero no es un evento: se ve en «Por día».`
    : `No cuentan ${formatCount(groups.length)} fechas de grupo privado: ${list}. Ocupan lugar en el salón, pero no son eventos: se ven en «Por día».`
}

/**
 * «Por evento» de un formato que SOLO tiene grupos privados (Merienda Libre por
 * link directo: el selector ya no lo ofrece). Decir «todavía no le pusiste
 * fecha» sería falso.
 */
export function privateOnlyTemplateState(
  templateName: string,
  count: number,
): { title: string; description: string } {
  return {
    title: `Todas las fechas de ${templateName} son de grupos privados`,
    description:
      count === 1
        ? 'Su única fecha está marcada «Grupo privado»: ocupa lugar en el salón, pero no es un evento y no sale en este reporte. Su gente se ve en «Por día».'
        : `Sus ${formatCount(count)} fechas están marcadas «Grupo privado»: ocupan lugar en el salón, pero no son eventos y no salen en este reporte. Su gente se ve en «Por día».`,
  }
}

// ─── Errores de la base (G5) ─────────────────────────────────────────────────

/**
 * Quien marca desde el calendario (anfitrión, cajero, dueño) no ve la pauta:
 * se le dice quién lo destraba.
 */
export const PRIVATE_GROUP_HAS_MONEY =
  'Esta fecha tiene pauta o la plata de la noche cargada en «Cómo nos fue»: no puede ser un grupo privado. Un dueño tiene que borrarla primero.'

/** Un dueño cargando pauta en una fecha que otro marcó privada mientras tanto. */
export const EVENT_IS_PRIVATE_GROUP =
  'Esta fecha es un grupo privado: no lleva pauta ni la plata de la noche. Si fue un evento, destildá «Grupo privado» en el calendario.'

/** La acción no contestó (o falló sin un motivo conocido): mismas palabras en el server y en el cliente. */
export const PRIVATE_GROUP_UNREACHABLE = 'No se pudo cambiar la fecha. Probá de nuevo.'

/** El mensaje de un error de los triggers, o `null` si no es uno de estos. */
export function privateGroupErrorMessage(dbMessage: string | null | undefined): string | null {
  const m = String(dbMessage ?? '')
  if (m.includes('private_group_has_money')) return PRIVATE_GROUP_HAS_MONEY
  if (m.includes('event_is_private_group')) return EVENT_IS_PRIVATE_GROUP
  return null
}
