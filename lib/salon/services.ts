/**
 * Los SERVICIOS del día: desayuno, almuerzo, merienda y cena.
 *
 * El dueño lo dijo así: "actualmente está todo junto y se mezcla para poder
 * leerlo". Una lista plana de 33 reservas donde conviven una merienda de 12 a
 * las 17:00 y una cena de 2 a las 22:30 no se lee — se descifra. Armar el salón
 * es una decisión POR SERVICIO ("¿cuántos cubiertos tengo en la cena, y cuántos
 * de esos van arriba?"), así que la agenda tiene que estar cortada por servicio
 * y desglosada por zona.
 *
 * Todo lo de acá es puro cálculo sobre filas ya traídas: sirve igual en un RSC
 * que en un componente cliente (el diálogo del día del calendario).
 */

import { MEAL_TYPE_LABELS, type MealType, type ReservationWithJoins, type SalonZone } from './types'

/**
 * Orden cronológico del día. Coincide con el `enumsortorder` del tipo
 * `meal_type` en Postgres, así que un `order by meal_type` en SQL y este array
 * dan la misma secuencia.
 */
export const MEAL_TYPE_ORDER: ReadonlyArray<MealType> = [
  'breakfast',
  'lunch',
  'tea_time',
  'dinner',
  'hub_event',
]

/**
 * Una reserva cancelada o que no vino sigue en la lista (alguien va a
 * preguntar), pero no ocupa mesa: no suma cubiertos ni entra en los totales del
 * servicio. Mismo criterio que `coversOf` de la tabla y que el RPC de cupos.
 */
export function occupiesTable(r: Pick<ReservationWithJoins, 'status'>): boolean {
  return r.status !== 'cancelled' && r.status !== 'no_show'
}

/** Los cubiertos que hay que sentar: los que vinieron si ya se contaron. */
export function coversOf(
  r: Pick<ReservationWithJoins, 'actual_guests' | 'estimated_guests'>,
): number {
  return r.actual_guests ?? r.estimated_guests ?? 0
}

export type ZoneCovers = Record<SalonZone, number>

/**
 * Lo mínimo que hace falta para armar el corte por servicio. Tipar por lo que
 * se usa (y no por `ReservationWithJoins` entero) deja que la página pida a la
 * DB solo estas siete columnas para contar el día, en vez de traerse todas las
 * reservas con sus joins solo para pintar unos chips.
 */
export type ServiceRow = Pick<
  ReservationWithJoins,
  | 'meal_type'
  | 'zone'
  | 'status'
  | 'kind'
  | 'cake_count'
  | 'estimated_guests'
  | 'actual_guests'
  | 'reservation_time_local'
>

const EMPTY_ZONES = (): ZoneCovers => ({
  planta_alta: 0,
  planta_baja: 0,
  event_floating: 0,
})

export type ServiceBucket<T extends ServiceRow = ReservationWithJoins> = {
  mealType: MealType
  label: string
  /** Todas las reservas del servicio, en el orden en que vinieron del server. */
  rows: T[]
  /** Cubiertos que ocupan mesa (excluye canceladas y no-show). */
  covers: number
  /** Los mismos cubiertos, abiertos por zona. Las tres suman `covers`. */
  byZone: ZoneCovers
  /**
   * Cuántas MESAS hay en cada zona. El dueño lo pidió con esa palabra ("x
   * reservas en salón, x en terraza") y no es lo mismo que los cubiertos: 38
   * personas pueden ser 9 mesas o 19. Para armar el salón hacen falta las dos.
   */
  tablesByZone: ZoneCovers
  /** Reservas que ocupan mesa. */
  activeCount: number
  /** Canceladas + no-show: se listan, pero aparte del total. */
  inactiveCount: number
  /** Cumpleaños del servicio (los que hay que mirar dos veces). */
  birthdays: number
  /** Tortas comprometidas: la cocina las tiene que hacer. */
  cakes: number
  /** Franja real del servicio, tomada de las reservas ('HH:MM'). */
  from: string | null
  to: string | null
}

/**
 * Corta las reservas por servicio. Devuelve SOLO los servicios que tienen algo
 * — un bar que nunca sirve desayuno no tiene por qué ver un "Desayuno: 0"
 * todos los días, y el HUB tiene 144 cenas contra 2 desayunos en su historia.
 */
export function groupByService<T extends ServiceRow>(rows: T[]): Array<ServiceBucket<T>> {
  const buckets = new Map<MealType, ServiceBucket<T>>()

  for (const r of rows) {
    let b = buckets.get(r.meal_type)
    if (!b) {
      b = {
        mealType: r.meal_type,
        label: MEAL_TYPE_LABELS[r.meal_type],
        rows: [],
        covers: 0,
        byZone: EMPTY_ZONES(),
        tablesByZone: EMPTY_ZONES(),
        activeCount: 0,
        inactiveCount: 0,
        birthdays: 0,
        cakes: 0,
        from: null,
        to: null,
      }
      buckets.set(r.meal_type, b)
    }

    b.rows.push(r)

    if (!occupiesTable(r)) {
      b.inactiveCount += 1
      continue
    }

    const guests = coversOf(r)
    b.activeCount += 1
    b.covers += guests
    b.byZone[r.zone] += guests
    b.tablesByZone[r.zone] += 1
    if (r.kind === 'birthday') b.birthdays += 1
    b.cakes += r.cake_count

    // La franja la marcan las reservas que se van a sentar: una cancelada de las
    // 20:00 no puede estirar la cena media hora para atrás.
    const hhmm = r.reservation_time_local.slice(0, 5)
    if (!b.from || hhmm < b.from) b.from = hhmm
    if (!b.to || hhmm > b.to) b.to = hhmm
  }

  return [...buckets.values()].sort(
    (a, z) => MEAL_TYPE_ORDER.indexOf(a.mealType) - MEAL_TYPE_ORDER.indexOf(z.mealType),
  )
}

/** "21:00 a 23:30" · "21:00" si todas caen a la misma hora · null si no hay. */
export function serviceTimeRange(b: { from: string | null; to: string | null }): string | null {
  if (!b.from) return null
  if (!b.to || b.to === b.from) return b.from
  return `${b.from} a ${b.to}`
}

/**
 * Totales del día a partir de los buckets ya armados. Sirve para el encabezado
 * "33 reservas · 214 cubiertos" sin recorrer las filas otra vez.
 */
export function totalsFromServices(buckets: Array<ServiceBucket<ServiceRow>>): {
  covers: number
  activeCount: number
  birthdays: number
  cakes: number
  byZone: ZoneCovers
} {
  const byZone = EMPTY_ZONES()
  let covers = 0
  let activeCount = 0
  let birthdays = 0
  let cakes = 0
  for (const b of buckets) {
    covers += b.covers
    activeCount += b.activeCount
    birthdays += b.birthdays
    cakes += b.cakes
    byZone.planta_alta += b.byZone.planta_alta
    byZone.planta_baja += b.byZone.planta_baja
    byZone.event_floating += b.byZone.event_floating
  }
  return { covers, activeCount, birthdays, cakes, byZone }
}
