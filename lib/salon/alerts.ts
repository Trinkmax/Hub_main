/**
 * Avisos de servicio: lo que el encargado y el mozo NO se pueden pasar por alto.
 *
 * El pedido del dueño fue "que se resalte, por ejemplo si hay una persona
 * celíaca". Antes eso vivía dentro del comentario libre, detrás de un ícono de
 * 18px: estaba cargado, pero nadie lo veía.
 *
 * Este archivo es el catálogo único. Agregar un aviso nuevo se hace acá (más el
 * valor en el enum `service_alert` de la DB) y aparece solo en el form, en la
 * agenda, en el panel de mozos y en la ficha del cliente.
 *
 * Puro: sin React, sin servidor. Testeable sin DB.
 */

export const SERVICE_ALERTS = [
  'celiac',
  'allergy',
  'vegetarian',
  'vegan',
  'reduced_mobility',
  'baby_seat',
] as const

export type ServiceAlert = (typeof SERVICE_ALERTS)[number]

/**
 * `critical` = si se pasa por alto, alguien la pasa mal de verdad (riesgo
 * médico). Se pinta con `destructive`. `info` es logística: se pinta con
 * `warning`. La distinción es de presentación, por eso vive acá y no en la DB.
 */
export type AlertSeverity = 'critical' | 'info'

/**
 * `person` = es de la persona y no cambia entre visitas: se guarda en la ficha
 * del CRM y reaparece sola en cada reserva futura.
 * `visit` = es de esa noche: se guarda solo en la reserva.
 */
export type AlertScope = 'person' | 'visit'

export type ServiceAlertMeta = {
  /** Etiqueta completa, para el form y la ficha. */
  label: string
  /** Versión corta para el chip de la agenda y del panel de mozos. */
  short: string
  severity: AlertSeverity
  scope: AlertScope
  /** Qué tiene que hacer el staff con esto. Va en el title/tooltip del chip. */
  hint: string
}

export const SERVICE_ALERT_META: Record<ServiceAlert, ServiceAlertMeta> = {
  celiac: {
    label: 'Celíaco/a',
    short: 'SIN TACC',
    severity: 'critical',
    scope: 'person',
    hint: 'Celíaco/a: sin TACC, cuidar contaminación cruzada en cocina y barra.',
  },
  allergy: {
    label: 'Alergia',
    short: 'ALERGIA',
    severity: 'critical',
    scope: 'person',
    hint: 'Tiene una alergia. El detalle (a qué) va en el comentario de la reserva.',
  },
  vegetarian: {
    label: 'Vegetariano/a',
    short: 'VEGGIE',
    severity: 'info',
    scope: 'person',
    hint: 'Vegetariano/a: ofrecer las opciones sin carne.',
  },
  vegan: {
    label: 'Vegano/a',
    short: 'VEGANO',
    severity: 'info',
    scope: 'person',
    hint: 'Vegano/a: sin ningún producto de origen animal.',
  },
  reduced_mobility: {
    label: 'Movilidad reducida',
    short: 'ACCESO',
    severity: 'info',
    scope: 'person',
    hint: 'Movilidad reducida: sentarla en planta baja y dejar el paso libre.',
  },
  baby_seat: {
    label: 'Bebé / silla alta',
    short: 'SILLA BEBÉ',
    severity: 'info',
    scope: 'visit',
    hint: 'Viene con bebé: preparar silla alta.',
  },
}

/** Orden de presentación: primero lo que puede hacer daño. */
const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, info: 1 }

export function isServiceAlert(value: unknown): value is ServiceAlert {
  return typeof value === 'string' && (SERVICE_ALERTS as readonly string[]).includes(value)
}

/** Descarta lo que no conozca (una fila vieja, un enum nuevo sin deploy del front). */
export function parseServiceAlerts(value: unknown): ServiceAlert[] {
  if (!Array.isArray(value)) return []
  return value.filter(isServiceAlert)
}

export function sortAlerts(alerts: ServiceAlert[]): ServiceAlert[] {
  return [...alerts].sort((a, b) => {
    const bySeverity =
      SEVERITY_RANK[SERVICE_ALERT_META[a].severity] - SEVERITY_RANK[SERVICE_ALERT_META[b].severity]
    if (bySeverity !== 0) return bySeverity
    return SERVICE_ALERTS.indexOf(a) - SERVICE_ALERTS.indexOf(b)
  })
}

export type ResolvedAlert = {
  alert: ServiceAlert
  /** `true` si viene de la ficha del cliente y no de esta reserva. */
  fromProfile: boolean
}

/**
 * Los avisos que hay que mostrar en una reserva: los suyos más los de la ficha
 * del cliente linkeado, sin repetir.
 *
 * Marca cuáles vienen de la ficha porque sacar uno de ahí no es lo mismo que
 * sacarlo de esta reserva: si Melina dejó de ser celíaca (no pasa) hay que
 * tocar su ficha, no la reserva del viernes.
 */
export function resolveReservationAlerts(
  reservationAlerts: unknown,
  customerAlerts?: unknown,
): ResolvedAlert[] {
  const own = parseServiceAlerts(reservationAlerts)
  const profile = parseServiceAlerts(customerAlerts)
  const ownSet = new Set(own)
  const merged = sortAlerts([...new Set([...own, ...profile])])
  return merged.map((alert) => ({ alert, fromProfile: !ownSet.has(alert) }))
}

/**
 * La severidad de la fila entera: manda el peor. `null` si no hay avisos —
 * y ese es el caso normal, así que la fila tiene que verse idéntica a hoy.
 */
export function highestSeverity(
  alerts: ReadonlyArray<{ alert: ServiceAlert }>,
): AlertSeverity | null {
  if (alerts.length === 0) return null
  return alerts.some((a) => SERVICE_ALERT_META[a.alert].severity === 'critical')
    ? 'critical'
    : 'info'
}

/**
 * De los avisos marcados en una reserva, cuáles corresponden guardarse en la
 * ficha del cliente. Es lo que evita que alguien tenga que acordarse de
 * recargar "celíaca" en cada reserva: el que carga la reserva se entera una vez
 * y el CRM lo recuerda para siempre.
 */
export function personScopedAlerts(alerts: unknown): ServiceAlert[] {
  return parseServiceAlerts(alerts).filter((a) => SERVICE_ALERT_META[a].scope === 'person')
}

/** Une lo que ya sabía la ficha con lo que se acaba de marcar, sin repetir. */
export function mergeProfileAlerts(current: unknown, incoming: unknown): ServiceAlert[] {
  return sortAlerts([...new Set([...parseServiceAlerts(current), ...personScopedAlerts(incoming)])])
}
