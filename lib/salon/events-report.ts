/**
 * "Cómo nos fue": cuánta gente entró una noche, en cuántas reservas y de a cuántos.
 *
 * Lo pidió el dueño así: "poder seleccionar por evento o día y ver cómo nos
 * fue. Que solo nos tire: personas totales, reservas totales, promedio de
 * personas por reserva". Y el corte que dio de ejemplo es el que manda: la
 * noche se parte en el evento (Ramen) y las reservas normales (sin evento).
 *
 * Reglas que fija este archivo:
 *
 * - **Las canceladas y las no-show NO entran en los tres números.** Decisión
 *   del dueño. Quedan contadas aparte, como nota al costado — al revés que en
 *   `lib/salon/deposits.ts`, donde la seña de una reserva caída sí es plata que
 *   entró. Acá hablamos de gente que se sentó: la que no vino no se sentó.
 * - **El corte de bloque es `scheduled_event_id`, nunca la zona.** Hay reservas
 *   de evento sentadas en Planta Alta; filtrar por zona pierde gente. Es el
 *   mismo bug que ya se corrigió en `covers.ts` y en `month-capacity.ts`.
 * - **"Asistieron" es la suma de `actual_guests` NO NULO de reservas en pie.**
 *   Nunca se completa con el estimado: si el numerador cayera al estimado, el
 *   número dejaría de significar "gente que contamos" y no habría manera de
 *   notarlo. Un `actual_guests` en NULL no es un olvido: es una mesa que quedó
 *   sin cerrar, y el reporte lo dice con esas palabras.
 * - **Para la plata hay un cuarto número: `billableGuests`.** Ahí sí se
 *   completa con lo reservado, mesa por mesa (`attended ?? guests`), porque la
 *   cuenta del ingreso y el costo por persona necesita un total de gente y no
 *   puede quedarse corta por las mesas que el salón no cerró. Va aparte y con
 *   su nombre justamente para que "asistieron" no cambie de significado.
 * - **Nunca un porcentaje de asistencia.** Miente por los dos lados: el
 *   numerador está casi siempre incompleto (en el HUB, 20 de 24 mesas del Ramen
 *   del 7/9 quedaron sin cerrar) y el ratio real pasa de 100 (el 3/9 Pizza
 *   libre reservó 62 y se sentaron 65).
 *
 * Puro: sin DB ni React. Las queries de `lib/salon/queries.ts` le pasan filas
 * crudas y acá se hacen todas las cuentas, así que se testea con fixtures.
 */

import { rowsToCsv } from '@/lib/stats/csv'
import {
  csvFormulaGuard,
  type EventMarketingRow,
  MARKETING_EXPORT_HEADERS,
  MARKETING_LIVE_BLANK_HEADERS,
  marketingCsvCells,
} from './event-marketing'
import type { SalonReservationStatus } from './types'

/** Estados que NO cuentan: la reserva se cayó, esa gente no se sentó. */
export const FALLEN_STATUSES = ['cancelled', 'no_show'] as const

function isFallen(status: SalonReservationStatus): boolean {
  return (FALLEN_STATUSES as ReadonlyArray<string>).includes(status)
}

/**
 * El nombre que se muestra de un evento programado.
 *
 * El ternario `name_override ?? template.name ?? 'Evento'` está copiado a mano
 * en 14 lugares del repo; este helper es el primero que además normaliza los
 * espacios de más, que existen en los datos reales ("Tapeo  y Malbec").
 */
export function eventTitle(event: {
  name_override?: string | null
  template?: { name?: string | null } | null
}): string {
  const raw = event.name_override ?? event.template?.name ?? 'Evento'
  return raw.replace(/\s+/g, ' ').trim() || 'Evento'
}

/** Fila mínima del reporte: exactamente lo que trae el `.select()` de la query. */
export type ReportReservationRow = {
  id: string
  reservation_date: string
  scheduled_event_id: string | null
  estimated_guests: number | string
  actual_guests: number | string | null
  status: SalonReservationStatus
  guest_name?: string | null
  /** El nombre de mesa que cargó el salón ("2"). Libre: puede venir con espacios o vacío. */
  table_label?: string | null
}

/** Un evento programado, tal como lo devuelve `listScheduledEventsForDateRange`. */
export type ReportEventRow = {
  id: string
  template_id: string
  name_override: string | null
  event_date: string
  starts_at_local: string
  capacity: number | string
  template?: { id?: string; name?: string | null; color_hex?: string | null } | null
}

/**
 * Una mesa del muro. `guests` es lo reservado; `attended` es lo que se contó al
 * cerrarla (null = la mesa nunca se cerró).
 */
export type TableChip = {
  id: string
  guests: number
  attended: number | null
  state: 'counted' | 'open' | 'fallen'
  /** Nombre de mesa, recortado. Un nombre en blanco es `null`, no "Mesa ". */
  label: string | null
  /**
   * Por qué se cayó: el muro dice "la cancelaron" o "no vino", que no son lo
   * mismo para el dueño. `null` en toda mesa en pie.
   */
  fallenReason: 'cancelled' | 'no_show' | null
}

/** Los números de un bloque: un evento de la noche, o las reservas normales. */
export type ReportBlock = {
  /** `sin-evento` o el id del evento programado. */
  key: string
  kind: 'event' | 'plain'
  title: string
  /** Color del template, para el borde de la ficha. `null` en "Sin evento". */
  colorHex: string | null
  startsAtLocal: string | null
  /** Cupo de ESA edición. Cambia entre ediciones, así que no se compara. */
  capacity: number | null
  eventId: string | null
  templateId: string | null
  /** Los tres números que pidió el dueño. */
  guests: number
  reservations: number
  /** `null` cuando no quedó ninguna reserva en pie: un promedio de cero no existe. */
  avg: number | null
  /** Mesa más chica y más grande, para explicar el promedio sin opinar. */
  minParty: number | null
  maxParty: number | null
  /** Gente contada al cerrar mesas, solo de reservas en pie. */
  attendedGuests: number
  /**
   * La gente con la que se hace plata: por cada mesa EN PIE, lo contado al
   * cerrarla y, si quedó sin cerrar, lo reservado (`attended ?? guests`).
   *
   * Convive con los otros dos a propósito, no reemplaza a ninguno:
   * - `guests` es lo RESERVADO. Es uno de los tres números grandes que pidió el
   *   dueño y no se toca.
   * - `attendedGuests` es lo que se CONTÓ, y queda corto cuando el salón no
   *   cerró las mesas (20 de 24 del Ramen del 7/9 quedaron sin cerrar).
   * - Este es el mejor estimador de cuánta gente realmente consumió, que es la
   *   que multiplica el ingreso y el costo por persona de la pauta. Mismo
   *   criterio que el motor de comisiones: `coalesce(actual_guests,
   *   estimated_guests)`.
   */
  billableGuests: number
  /** Cuántas de las mesas en pie se cerraron con conteo. */
  countedTables: number
  cancelled: number
  noShow: number
  /** Personas que había en las reservas que se cayeron. */
  fallenGuests: number
  tables: TableChip[]
}

export type DayReport = {
  day: string
  /** Eventos por hora de inicio, y al final SIEMPRE el bloque "Sin evento". */
  blocks: ReportBlock[]
  totals: { guests: number; reservations: number }
  truncated: boolean
}

/**
 * Una edición es un bloque más la fecha en la que pasó. Comparte forma con el
 * bloque de la vista por día a propósito: los tres números se dibujan con el
 * mismo componente en las dos vistas o dejan de ser el mismo objeto.
 */
export type EditionSummary = ReportBlock & {
  date: string
  /** La fecha todavía no pasó: los números se siguen moviendo. */
  isFuture: boolean
  /**
   * Es HOY. Va aparte de `isFuture` porque una noche que arranca a las 21:00
   * todavía está vendiendo: no puede ser "la última fecha", ni "la mejor", ni
   * entrar en el promedio de referencia, ni tener flecha de comparación. Pero
   * tampoco es futura, y la pantalla la nombra distinto.
   */
  isTonight: boolean
}

export type TemplateReport = {
  templateId: string
  templateName: string
  colorHex: string | null
  /** De la más nueva a la más vieja. */
  editions: EditionSummary[]
  /** La edición CONCLUIDA más reciente con reservas: el hero de la vista. */
  latest: EditionSummary | null
  /** La mejor edición concluida. `null` con menos de 2 para comparar. */
  best: { date: string; guests: number } | null
  /**
   * Promedio de referencia sobre ediciones CONCLUIDAS y con reservas (ni hoy ni
   * futuras). `null` con menos de 2: un "promedio" de una sola fecha es esa
   * fecha con otro nombre.
   */
  reference: { avgGuests: number; editions: number } | null
  /** Hay al menos una fecha que ya terminó, haya vendido o no. */
  hasPastEditions: boolean
  truncated: boolean
}

const EMPTY_BLOCK = {
  guests: 0,
  reservations: 0,
  attendedGuests: 0,
  billableGuests: 0,
  countedTables: 0,
  cancelled: 0,
  noShow: 0,
  fallenGuests: 0,
}

function toInt(value: number | string | null | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

/** Redondeo a un decimal, que es como el dueño lo dice: "2,5 por reserva". */
function average(guests: number, reservations: number): number | null {
  if (reservations <= 0) return null
  return Math.round((guests / reservations) * 10) / 10
}

type Acc = ReportBlock & { _parties: number[] }

function newAcc(base: Pick<ReportBlock, 'key' | 'kind' | 'title'> & Partial<ReportBlock>): Acc {
  return {
    colorHex: null,
    startsAtLocal: null,
    capacity: null,
    eventId: null,
    templateId: null,
    avg: null,
    minParty: null,
    maxParty: null,
    tables: [],
    ...EMPTY_BLOCK,
    ...base,
    _parties: [],
  }
}

/** Mete una reserva en su bloque. Compartido por las dos vistas. */
function absorb(acc: Acc, row: ReportReservationRow): void {
  const guests = toInt(row.estimated_guests)
  const label = row.table_label?.trim() || null
  if (isFallen(row.status)) {
    acc.fallenGuests += guests
    if (row.status === 'cancelled') acc.cancelled += 1
    else acc.noShow += 1
    acc.tables.push({
      id: row.id,
      guests,
      attended: null,
      state: 'fallen',
      label,
      fallenReason: row.status === 'cancelled' ? 'cancelled' : 'no_show',
    })
    return
  }
  const attended = row.actual_guests === null ? null : toInt(row.actual_guests)
  acc.guests += guests
  acc.reservations += 1
  acc._parties.push(guests)
  // Lo contado si la mesa se cerró; lo reservado si no. Mesa por mesa: sumar
  // los dos totales por separado y elegir uno perdería las mesas cerradas de
  // una noche a medio cerrar, que es el caso normal.
  acc.billableGuests += attended ?? guests
  if (attended !== null) {
    acc.attendedGuests += attended
    acc.countedTables += 1
  }
  acc.tables.push({
    id: row.id,
    guests,
    attended,
    state: attended === null ? 'open' : 'counted',
    label,
    fallenReason: null,
  })
}

function seal(acc: Acc): ReportBlock {
  const { _parties, ...block } = acc
  block.avg = average(block.guests, block.reservations)
  block.minParty = _parties.length > 0 ? Math.min(..._parties) : null
  block.maxParty = _parties.length > 0 ? Math.max(..._parties) : null
  // El muro se lee de la mesa más grande a la más chica, y las caídas al final:
  // son marginalia, no parte de la masa de gente que entró.
  block.tables.sort((a, b) => {
    if ((a.state === 'fallen') !== (b.state === 'fallen')) return a.state === 'fallen' ? 1 : -1
    return b.guests - a.guests
  })
  return block
}

/**
 * Una noche, cortada por evento + el bloque de reservas normales.
 *
 * El bloque "Sin evento" se devuelve SIEMPRE, aunque esté en cero: que una
 * noche haya sido íntegramente del evento es información, y esconder el bloque
 * dejaría al dueño sin saber si es cero o si la pantalla se lo comió.
 */
export function aggregateDayReport(input: {
  day: string
  events: ReadonlyArray<ReportEventRow>
  rows: ReadonlyArray<ReportReservationRow>
  truncated?: boolean
}): DayReport {
  const byEvent = new Map<string, Acc>()
  for (const ev of input.events) {
    byEvent.set(
      ev.id,
      newAcc({
        key: ev.id,
        kind: 'event',
        title: eventTitle(ev),
        colorHex: ev.template?.color_hex ?? null,
        startsAtLocal: ev.starts_at_local,
        capacity: toInt(ev.capacity) || null,
        eventId: ev.id,
        templateId: ev.template_id,
      }),
    )
  }
  const plain = newAcc({ key: 'sin-evento', kind: 'plain', title: 'Sin evento' })

  for (const row of input.rows) {
    if (row.reservation_date !== input.day) continue
    const eventId = row.scheduled_event_id
    // Una reserva puede apuntar a un evento de OTRA fecha (nada en el schema lo
    // impide). Si su evento no es de este día, cuenta como reserva normal del
    // día que dice la reserva: la noche se arma con quién se sienta esa noche.
    const acc = eventId ? byEvent.get(eventId) : undefined
    absorb(acc ?? plain, row)
  }

  const eventBlocks = Array.from(byEvent.values())
    .map(seal)
    .sort((a, b) => (a.startsAtLocal ?? '').localeCompare(b.startsAtLocal ?? ''))
  const plainBlock = seal(plain)
  const blocks = [...eventBlocks, plainBlock]

  return {
    day: input.day,
    blocks,
    totals: {
      guests: blocks.reduce((n, b) => n + b.guests, 0),
      reservations: blocks.reduce((n, b) => n + b.reservations, 0),
    },
    truncated: input.truncated ?? false,
  }
}

/**
 * Las ediciones que se le pasen, de la más nueva a la más vieja: una por evento
 * programado, aunque no tenga una sola reserva.
 *
 * Acá el bucket es `scheduled_event_id`, NO `reservation_date`: hoy todas las
 * reservas de evento caen en la fecha de su evento, pero nada en el schema lo
 * garantiza, y el día que alguien mueva una fecha las dos vistas tienen que
 * seguir contando lo suyo sin contradecirse.
 *
 * Vive aparte de `aggregateTemplateReport` porque no le importa de qué template
 * son los eventos: la pestaña de pauta del mes junta ediciones de todos, y tiene
 * que contar la gente con exactamente la misma cuenta que la vista por evento.
 */
export function aggregateEditions(input: {
  events: ReadonlyArray<ReportEventRow>
  rows: ReadonlyArray<ReportReservationRow>
  /** Hoy en el calendario del bar: define qué edición ya pasó. */
  today: string
  /** Color de respaldo cuando el evento no trae el de su template. */
  colorHex?: string | null
}): EditionSummary[] {
  const byEvent = new Map<string, Acc>()
  for (const ev of input.events) {
    byEvent.set(
      ev.id,
      newAcc({
        key: ev.id,
        kind: 'event',
        title: eventTitle(ev),
        colorHex: ev.template?.color_hex ?? input.colorHex ?? null,
        startsAtLocal: ev.starts_at_local,
        capacity: toInt(ev.capacity) || null,
        eventId: ev.id,
        templateId: ev.template_id,
      }),
    )
  }
  for (const row of input.rows) {
    if (!row.scheduled_event_id) continue
    const acc = byEvent.get(row.scheduled_event_id)
    if (!acc) continue
    absorb(acc, row)
  }

  const byId = new Map(input.events.map((e) => [e.id, e]))
  return Array.from(byEvent.values())
    .map(seal)
    .map((b) => {
      const date = byId.get(b.key)?.event_date ?? ''
      // Las fechas son `date` puro: se comparan como strings, jamás con `new Date`.
      return { ...b, date, isFuture: date > input.today, isTonight: date === input.today }
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

/**
 * Todas las ediciones de un evento, de la más nueva a la más vieja, con lo
 * comparativo encima (la última, la mejor, el promedio de referencia). El
 * conteo por edición es `aggregateEditions`.
 */
export function aggregateTemplateReport(input: {
  templateId: string
  templateName: string
  colorHex: string | null
  /** Hoy en el calendario del bar: define qué edición ya pasó. */
  today: string
  events: ReadonlyArray<ReportEventRow>
  rows: ReadonlyArray<ReportReservationRow>
  truncated?: boolean
}): TemplateReport {
  const editions = aggregateEditions({
    events: input.events,
    rows: input.rows,
    today: input.today,
    colorHex: input.colorHex,
  })

  // Concluidas: ni hoy ni futuras. Todo lo comparativo sale de acá.
  const concluidas = editions.filter((e) => !e.isFuture && !e.isTonight)
  const pasadas = concluidas.filter((e) => e.reservations > 0)
  const reference =
    pasadas.length >= 2
      ? {
          avgGuests: Math.round(pasadas.reduce((n, e) => n + e.guests, 0) / pasadas.length),
          editions: pasadas.length,
        }
      : null
  const best =
    pasadas.length >= 2
      ? pasadas.reduce(
          (top, e) => (top && top.guests >= e.guests ? top : { date: e.date, guests: e.guests }),
          null as { date: string; guests: number } | null,
        )
      : null

  return {
    templateId: input.templateId,
    templateName: input.templateName.replace(/\s+/g, ' ').trim(),
    colorHex: input.colorHex,
    editions,
    latest: pasadas[0] ?? null,
    best,
    reference,
    hasPastEditions: concluidas.length > 0,
    truncated: input.truncated ?? false,
  }
}

/**
 * Cuánto cambió una edición contra la anterior CON reservas.
 *
 * Siempre diferencia absoluta y con la base nombrada, nunca porcentaje: de 4 a
 * 53 personas es "+1225%" y la base eran dos reservas. `null` cuando no hay
 * contra qué comparar — que es el caso de la primera fecha de cada evento.
 */
export function editionDelta(
  editions: ReadonlyArray<EditionSummary>,
  index: number,
): { diff: number; againstDate: string } | null {
  const current = editions[index]
  if (!current || current.isFuture || current.isTonight || current.reservations === 0) return null
  for (let i = index + 1; i < editions.length; i += 1) {
    const prev = editions[i]
    if (prev && !prev.isFuture && !prev.isTonight && prev.reservations > 0) {
      return { diff: current.guests - prev.guests, againstDate: prev.date }
    }
  }
  return null
}

/**
 * El promedio en la planilla, con UN decimal y coma: es lo que muestra la
 * pantalla y lo que Excel en es-AR lee como número. Sin el decimal fijo, un
 * promedio redondo saldría "5" en el CSV y "5,0" en pantalla.
 */
function avgCell(avg: number | null): string {
  return avg === null ? '' : avg.toFixed(1).replace('.', ',')
}

export const DAY_EXPORT_HEADERS = [
  'Fecha',
  'Bloque',
  'Personas',
  'Reservas',
  'Personas por reserva',
  'Contadas',
  'Mesas contadas',
  'Canceladas',
  'No vino',
  'Personas caídas',
] as const

/** La pauta cargada de un reporte, por `scheduled_event_id`. Sin fila = «Sin cargar». */
export type ReportMarketingByEvent = Readonly<Record<string, EventMarketingRow>>

/**
 * `;` + BOM: es lo que abre en columnas en Excel en español.
 *
 * Con `marketing`, cada bloque suma las columnas de pauta. "Sin evento" las
 * lleva vacías: la pauta es de una fecha de evento y la ficha de las reservas
 * normales no tiene sección de pauta. Sin `marketing` la planilla queda byte a
 * byte como antes.
 */
export function dayReportToCsv(report: DayReport, marketing?: ReportMarketingByEvent): string {
  const headers: string[] = [...DAY_EXPORT_HEADERS]
  if (marketing) headers.push(...MARKETING_EXPORT_HEADERS)
  return rowsToCsv(
    headers,
    report.blocks.map((b) => {
      const cells = [
        report.day,
        // El nombre lo escribe el staff: con `=` adelante Excel lo correría como
        // fórmula. Misma guarda que la planilla del mes.
        csvFormulaGuard(b.title),
        String(b.guests),
        String(b.reservations),
        avgCell(b.avg),
        String(b.attendedGuests),
        `${b.countedTables} de ${b.reservations}`,
        String(b.cancelled),
        String(b.noShow),
        String(b.fallenGuests),
      ]
      if (!marketing) return cells
      const row = b.kind === 'event' && b.eventId ? (marketing[b.eventId] ?? null) : null
      return [...cells, ...marketingCsvCells(b.kind === 'event' ? b : null, row)]
    }),
    { separator: ';', bom: true },
  )
}

export const TEMPLATE_EXPORT_HEADERS = [
  'Fecha',
  'Evento',
  'Personas',
  'Reservas',
  'Personas por reserva',
  'Contadas',
  'Mesas contadas',
  'Canceladas',
  'No vino',
  'Todavía no pasó',
] as const

/** Lo que dice la columna de estado de la planilla del evento. */
function editionWhen(e: { isFuture: boolean; isTonight: boolean }): string {
  if (e.isFuture) return 'sí'
  if (e.isTonight) return 'es hoy'
  return ''
}

/** Con `marketing`, cada edición suma las columnas de pauta (vacías si no tiene fila). */
export function templateReportToCsv(
  report: TemplateReport,
  marketing?: ReportMarketingByEvent,
): string {
  const headers: string[] = [...TEMPLATE_EXPORT_HEADERS]
  if (marketing) headers.push(...MARKETING_EXPORT_HEADERS)
  return rowsToCsv(
    headers,
    report.editions.map((e) => {
      const cells = [
        e.date,
        csvFormulaGuard(e.title),
        String(e.guests),
        String(e.reservations),
        avgCell(e.avg),
        String(e.attendedGuests),
        `${e.countedTables} de ${e.reservations}`,
        String(e.cancelled),
        String(e.noShow),
        editionWhen(e),
      ]
      if (!marketing) return cells
      const pauta = marketingCsvCells(e, e.eventId ? (marketing[e.eventId] ?? null) : null)
      const live = e.isFuture || e.isTonight
      return [
        ...cells,
        ...(live
          ? pauta.map((c, i) =>
              MARKETING_LIVE_BLANK_HEADERS.has(MARKETING_EXPORT_HEADERS[i] ?? '') ? '' : c,
            )
          : pauta),
      ]
    }),
    { separator: ';', bom: true },
  )
}

/** `como-nos-fue-hub-2026-09-07.csv` / `como-nos-fue-hub-ramen.csv`. */
export function reportExportFilename(slug: string, scope: string): string {
  const safe = scope
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `como-nos-fue-${slug}-${safe || 'reporte'}.csv`
}
