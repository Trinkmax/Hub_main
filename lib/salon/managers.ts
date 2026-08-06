import type { ReservationManagerRow } from './types'

/**
 * Helpers puros del select "Gestor principal".
 *
 * Contexto: desde que los miembros del equipo se auto-provisionan como
 * gestores (trigger `memberships_provision_manager`), la lista pasó de tener
 * 1-2 nombres cargados a mano a tener a todo el bar. Eso cambia dos cosas:
 * hay que agrupar para que se lea, y hay que elegir bien el default porque
 * el gestor es quien cobra la comisión.
 */

/**
 * Memoria del último gestor elegido en este dispositivo.
 *
 * Va en cookie httpOnly (la escribe `createSalonReservation`, la lee
 * `/reservas/nuevo`) y no en localStorage porque el default tiene que
 * resolverse en el server: si el HTML llega con un gestor y el cliente lo
 * cambia al hidratar, hay mismatch de hidratación y el nombre parpadea justo
 * en el campo que define a quién se le paga.
 */
export function lastManagerCookieName(tenantSlug: string): string {
  return `hub_last_manager_${tenantSlug}`
}

export const LAST_MANAGER_COOKIE_MAX_AGE = 60 * 60 * 24 * 180 // 180 días

export type ManagerGroup = {
  key: 'team' | 'external'
  /** `null` = no hace falta encabezado (hay un solo grupo). */
  label: string | null
  items: ReservationManagerRow[]
}

/**
 * Agrupa en "Equipo" (gestores con cuenta en la app) y "Otros gestores"
 * (cargados a mano, sin cuenta: una recepcionista, un turno genérico).
 *
 * Si `selfId` cae en el equipo, va primero: en el 90% de los casos el gestor
 * es quien está cargando. Los grupos vacíos no se devuelven, y si queda uno
 * solo va sin encabezado — un título sobre una lista única es ruido.
 */
export function groupManagersForSelect(
  managers: ReservationManagerRow[],
  selfId?: string | null,
): ManagerGroup[] {
  const team = managers.filter((m) => m.user_id !== null)
  const external = managers.filter((m) => m.user_id === null)

  if (selfId) {
    const i = team.findIndex((m) => m.id === selfId)
    if (i > 0) {
      const [self] = team.splice(i, 1)
      if (self) team.unshift(self)
    }
  }

  const groups: ManagerGroup[] = []
  if (team.length > 0) groups.push({ key: 'team', label: 'Equipo', items: team })
  if (external.length > 0) {
    groups.push({ key: 'external', label: 'Otros gestores', items: external })
  }
  if (groups.length === 1 && groups[0]) groups[0].label = null
  return groups
}

/**
 * Default de "Gestor principal".
 *
 * Prioridad: gestor ya guardado en la reserva (edit) > último usado en este
 * dispositivo > gestor vinculado a mi cuenta > primero de la lista.
 *
 * El último usado le gana a "sos vos" a propósito: en la práctica el que
 * carga la reserva no siempre es el que la tomó (los socios cargan las que
 * entran por el WhatsApp del local), y ese default silencioso movería la
 * comisión de persona. La memoria del dispositivo respeta lo que el bar
 * viene haciendo; "sos vos" queda como semilla del primer uso.
 */
export function pickDefaultManagerId(opts: {
  managers: ReservationManagerRow[]
  mode: 'create' | 'edit'
  /** `initialValues.primary_manager_id` de la reserva que se está editando. */
  currentManagerId?: string | null
  /** Lo último que eligió este dispositivo (localStorage). */
  lastUsedManagerId?: string | null
  /** Gestor vinculado a la cuenta logueada. */
  selfManagerId?: string | null
}): string {
  const { managers, mode, currentManagerId, lastUsedManagerId, selfManagerId } = opts
  const exists = (id?: string | null) => !!id && managers.some((m) => m.id === id)

  if (currentManagerId) return currentManagerId
  if (mode === 'create') {
    if (exists(lastUsedManagerId)) return lastUsedManagerId as string
    if (exists(selfManagerId)) return selfManagerId as string
  }
  return managers[0]?.id ?? ''
}
