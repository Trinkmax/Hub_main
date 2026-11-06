import { carteleraSummary } from '@/app/(manager)/[tenantSlug]/entradas/_lib/overview'
import type { CommissionPeriod } from '@/lib/commissions/period'
import {
  addDays,
  addMonthsToYearMonth,
  endOfMonth,
  isRealIsoDay,
  monthOf,
  startOfMonth,
  timeInCordoba,
  WEEKDAY_NAMES,
  weekdayOf,
} from '@/lib/dates'
import { resolveReservationAlerts, SERVICE_ALERT_META, type ServiceAlert } from '@/lib/salon/alerts'
import type { RangeTotals } from '@/lib/salon/day-counter'
import { activeDaySegments } from '@/lib/salon/day-counter'
import type { DepositBasis, DepositsReport } from '@/lib/salon/deposits'
import { DEPOSIT_BASIS_LABELS } from '@/lib/salon/deposits'
import { zoneBreakdown } from '@/lib/salon/event-floor'
import { hhmm } from '@/lib/salon/format'
import {
  BOARD_FILTER_LABELS,
  type BoardFilter,
  filterForBoard,
  matchesQuery,
  minutesUntil,
  nameDisambiguation,
  nightPulse,
  normalizeText,
  relativeTimeLabel,
  sortForBoard,
  urgencyOf,
} from '@/lib/salon/operativo'
import { joinedEventName, placeLabel } from '@/lib/salon/place-label'
import type {
  CommissionBreakdownEntry,
  CommissionSummaryRow,
  ScheduledEventWithTemplate,
} from '@/lib/salon/queries'
import type { ReservationSearchResult } from '@/lib/salon/segment-rows'
import {
  type DaySegments,
  eventDisplayName,
  type IsoDow,
  SEGMENT_KEYS,
  type SegmentEventLoad,
  type SegmentKey,
  type SegmentLoad,
  segmentOfEventStart,
  segmentOfMealType,
  shownSegmentKeys,
} from '@/lib/salon/segments'
import {
  capSourceLabel,
  mismatchCopy,
  SEGMENT_LABELS,
  segmentEventNote,
  segmentHeadline,
  segmentStatusLine,
  segmentTone,
} from '@/lib/salon/segments-copy'
import { coversOf, occupiesTable } from '@/lib/salon/services'
import {
  type CakeOptionRow,
  type CommissionBonusRuleRow,
  type CommissionRateTierRow,
  describeCake,
  RESERVATION_KIND_LABELS,
  type ReservationManagerRow,
  type ReservationWithJoins,
  type ScheduledEventTemplateRow,
  STATUS_LABELS,
} from '@/lib/salon/types'
import { availabilityLabel, functionState, isOnSale, seatsLeft } from '@/lib/ticketing/availability'
import { formatTime } from '@/lib/ticketing/dates'
import {
  attentionView,
  formatOrderMoment,
  orderAmountCents,
  orderEntryLabel,
  orderFunctionLabel,
  orderStatusView,
  orderUndoLabel,
  paymentOptionLabel,
} from '@/lib/ticketing/order-view'
import type { AdminOrder } from '@/lib/ticketing/queries'
import { cappedBySize, compact, moneyIf, shortText, texPeriod } from '../read/common'
import { capped, dayText, money } from '../types'
import {
  HEALTH_NOTE,
  KIND_OF_WORD,
  type KindWord,
  maskPhone,
  mentionsHealth,
  ORIGIN_TEXT,
  redactContacts,
  SEGMENT_OF_WORD,
  type ServiceWord,
  STATUS_OF_WORD,
  type StatusFilterWord,
  ZONE_OF_FILTER_WORD,
  type ZoneFilterWord,
} from './_words'

/**
 * Lo que devuelven las herramientas de mirar del área. Puro. Lo lee un modelo y se paga por token: filas
 * chicas, en español, con los ids para seguir y los totales ya hechos.
 *
 * Ninguna fila lleva teléfono ni mail: es lo que se fija en `tex-agenda.test.ts`. El nombre sí; para
 * distinguir a dos con el mismo nombre, los últimos 4 dígitos (`nameDisambiguation`).
 */

/** Una respuesta entra en 14.000 caracteres: lo que no es la lista también ocupa. */
const LIST_MAX_CHARS = 9_000
const LIST_MAX = 60

export function weekdayName(iso: string): string {
  return isRealIsoDay(iso) ? (WEEKDAY_NAMES[weekdayOf(iso)] ?? '') : ''
}

// ─── Períodos ────────────────────────────────────────────────────────────────

/** Una agenda se mira para adelante: sin nada, de hoy a 60 días; con una sola punta, hasta fin de mes. */
export const UPCOMING_DAYS = 60

export function agendaRange(
  input: { mes?: string; desde?: string; hasta?: string },
  today: string,
) {
  if (!input.mes && !input.desde && !input.hasta) {
    return texPeriod({ desde: today, hasta: addDays(today, UPCOMING_DAYS) }, today)
  }
  if (input.mes) return texPeriod(input, today)
  const { desde, hasta } = input
  const from =
    desde ?? (hasta && isRealIsoDay(hasta) ? (today <= hasta ? today : startOfMonth(hasta)) : hasta)
  const to = hasta ?? (desde && isRealIsoDay(desde) ? endOfMonth(desde) : desde)
  return texPeriod({ desde: from, hasta: to }, today)
}

/** Los meses que toca un rango: `2026-10-28`–`2026-11-02` → `['2026-10', '2026-11']`. */
export function monthsOfRange(from: string, to: string): string[] {
  const months: string[] = []
  const last = monthOf(to)
  let month = monthOf(from)
  while (month <= last && months.length < 16) {
    months.push(month)
    month = addMonthsToYearMonth(month, 1)
  }
  return months
}

// ─── Una reserva ─────────────────────────────────────────────────────────────

/** El servicio con el que se cuenta: el del evento por su hora; si no, el de la reserva. */
export function segmentOfJoined(
  r: Pick<ReservationWithJoins, 'meal_type' | 'scheduled_event'>,
): SegmentKey {
  return r.scheduled_event
    ? segmentOfEventStart(r.scheduled_event.starts_at_local)
    : segmentOfMealType(r.meal_type)
}

/**
 * Lo de salud (celíaco, alergia, movilidad reducida) es un dato sensible y lo que devuelve una herramienta viaja a
 * la API de un tercero. Tex sabe que hay un aviso y lleva a verlo; lo que dice lo lee la persona en la pantalla.
 */
const HEALTH_ALERTS: ReadonlySet<ServiceAlert> = new Set(['celiac', 'allergy', 'reduced_mobility'])
export const HEALTH_ALERT_NOTE = 'aviso de salud: se ve en la pantalla'

function alertsOf(r: ReservationWithJoins): string[] | null {
  const alerts = resolveReservationAlerts(r.service_alerts, r.customer?.service_alerts)
  if (alerts.length === 0) return null
  const open = alerts
    .filter((a) => !HEALTH_ALERTS.has(a.alert))
    .map((a) => SERVICE_ALERT_META[a.alert].short)
  return alerts.some((a) => HEALTH_ALERTS.has(a.alert)) ? [...open, HEALTH_ALERT_NOTE] : open
}

/** Un comentario puede decir «alérgica al maní»: si habla de salud, no sale entero. */
function noteOf(text: string | null | undefined, max: number): string | null {
  if (!text) return null
  if (mentionsHealth(text)) return HEALTH_NOTE
  return shortText(redactContacts(text), max) ?? null
}

function cakeText(r: ReservationWithJoins): string | null {
  if (r.cake_count <= 0) return null
  const which = r.cake_option ? describeCake(r.cake_option) : 'falta elegir cuál'
  return r.cake_count === 1 ? which : `${r.cake_count} · ${which}`
}

/** Una fila de cualquier lista. Sin teléfono, mail ni Instagram. */
export function reservationRow(
  r: ReservationWithJoins,
  opts: { distinguish?: string; withDate?: boolean } = {},
) {
  return compact({
    id: r.id,
    fecha: opts.withDate ? dayText(r.reservation_date) : null,
    hora: hhmm(r.reservation_time_local),
    nombre: redactContacts(r.guest_name),
    distingue: opts.distinguish ?? null,
    personas: coversOf(r),
    reservadas:
      r.actual_guests !== null && r.actual_guests !== r.estimated_guests
        ? r.estimated_guests
        : null,
    servicio: SEGMENT_LABELS[segmentOfJoined(r)],
    lugar: placeLabel(r, joinedEventName(r)),
    estado: STATUS_LABELS[r.status],
    mesa: r.table_label,
    tipo: r.kind === 'normal' ? null : RESERVATION_KIND_LABELS[r.kind],
    sena: moneyIf(Number(r.deposit_cents)),
    torta: cakeText(r),
    champagne: r.champagne_count > 0 ? r.champagne_count : null,
    avisos: alertsOf(r),
    nota: noteOf(r.comments, 120),
    gestor: r.primary_manager?.display_name ?? null,
  })
}

/** La ficha de una reserva: lo mismo que una fila y lo que se mira de a una. */
export function reservationCard(r: ReservationWithJoins) {
  return compact({
    ...reservationRow(r, { withDate: true }),
    dia_semana: weekdayName(r.reservation_date),
    hasta: r.reservation_end_time_local ? hhmm(r.reservation_end_time_local) : null,
    reservadas: r.estimated_guests,
    contadas: r.actual_guests,
    telefono_termina_en: maskPhone(r.guest_phone ?? r.customer?.phone),
    tiene_mail: r.guest_email ? true : null,
    tiene_instagram: r.guest_instagram ? true : null,
    cliente_id: r.customer_id,
    club: r.customer?.tier?.name ?? null,
    puntos: r.customer ? r.customer.points_balance : null,
    origen: ORIGIN_TEXT[r.origin],
    asistente: r.assistant_manager?.display_name ?? null,
    nota: noteOf(r.comments, 400),
    nota_destacada: r.highlight_comment ? true : null,
    llego_a_las: timeInCordoba(r.arrived_at),
    se_sento_a_las: timeInCordoba(r.seated_at),
    cerro_a_las: timeInCordoba(r.closed_at),
    motivo_de_cancelacion: r.cancelled_reason
      ? shortText(redactContacts(r.cancelled_reason))
      : null,
    evento_id: r.scheduled_event_id,
  })
}

export function searchRow(row: ReservationSearchResult) {
  return compact({
    id: row.id,
    nombre: redactContacts(row.guest_name),
    fecha: dayText(row.reservation_date),
    hora: row.reservation_time_local,
    personas: row.guests,
    estado: STATUS_LABELS[row.status],
    servicio: SEGMENT_LABELS[row.segment],
    evento: row.eventName,
  })
}

// ─── El cupo ─────────────────────────────────────────────────────────────────

const LIGHT = { none: null, ok: 'verde', warn: 'ámbar', over: 'rojo' } as const

function eventLoadRow(e: SegmentEventLoad) {
  return compact({
    id: e.id,
    nombre: e.name,
    hora: e.startsAt,
    cupo: e.capacity,
    personas: e.used,
    libres: Math.max(0, e.capacity - e.used),
    pasado_por: e.over ? e.used - e.capacity : null,
    reservas: e.reservations,
    cumples: e.birthdays > 0 ? e.birthdays : null,
    tortas: e.cakes > 0 ? e.cakes : null,
  })
}

/**
 * Un servicio contra su cupo. `personas` es el número principal; `libres`, lo que queda para reservas
 * normales (lo que apartó un evento no cuenta como libre).
 */
export function segmentData(s: SegmentLoad, isoDow: IsoDow) {
  return compact({
    servicio: SEGMENT_LABELS[s.key],
    personas: s.people,
    cupo: s.capacity ?? 'sin tope',
    libres: s.freeForNormal,
    estado: segmentStatusLine(s),
    semaforo: LIGHT[segmentTone(s)],
    reservas: s.activeReservations,
    por_planta: s.people > 0 ? zoneBreakdown(s.byZone) : null,
    eventos: s.events.length > 0 ? s.events.map(eventLoadRow) : null,
    normales:
      s.events.length > 0
        ? s.normalCap === null
          ? `${s.normalUsed}`
          : `${s.normalUsed} de ${s.normalCap}`
        : null,
    cumples: s.birthdays.total > 0 ? s.birthdays.total : null,
    tortas: s.cakes.total > 0 ? s.cakes.total : null,
    nota: segmentEventNote(s),
    de_donde_sale_el_cupo: capSourceLabel(s, isoDow),
  })
}

/** Los servicios que se dibujan ese día: los fijos siempre, el desayuno si tiene algo. */
export function dayCapacityData(day: DaySegments) {
  return compact({
    dia: dayText(day.date),
    dia_semana: weekdayName(day.date),
    servicios: shownSegmentKeys(day.segments).map((key) =>
      segmentData(day.segments[key], day.isoDow),
    ),
    horas_mal_cargadas: day.mismatches.length > 0 ? day.mismatches.map(mismatchCopy) : null,
  })
}

/** A la madrugada, «hoy» en la lista y en el calendario ya es otro día que el del tablero. */
export function dawnNote(serviceDay: string, today: string, asked: boolean): string | null {
  if (asked || serviceDay === today) return null
  return `Pasó la medianoche: esto es el ${dayText(today)}. El tablero sigue en la noche del ${dayText(serviceDay)} hasta las 5.`
}

// ─── Las reservas de un día o de un rango ────────────────────────────────────

export type ReservationFilters = {
  servicio?: ServiceWord
  estado?: StatusFilterWord
  planta?: ZoneFilterWord
  tipo?: KindWord
  gestorId?: string
  buscar?: string
}

/**
 * Lo que muestra la lista: sin canceladas salvo que las pidan. Las que no vinieron se quedan, como en
 * la pantalla.
 */
export function filterDayRows(
  rows: readonly ReservationWithJoins[],
  f: ReservationFilters,
): ReservationWithJoins[] {
  return rows.filter((r) => {
    if (f.estado) {
      if (r.status !== STATUS_OF_WORD[f.estado]) return false
    } else if (r.status === 'cancelled') return false
    if (f.servicio && segmentOfJoined(r) !== SEGMENT_OF_WORD[f.servicio]) return false
    if (f.planta && r.zone !== ZONE_OF_FILTER_WORD[f.planta]) return false
    if (f.tipo && r.kind !== KIND_OF_WORD[f.tipo]) return false
    if (
      f.gestorId &&
      r.primary_manager_id !== f.gestorId &&
      r.assistant_manager_id !== f.gestorId
    ) {
      return false
    }
    return !f.buscar || matchesQuery(r, f.buscar)
  })
}

export function dayReservationsData(input: {
  date: string
  rows: readonly ReservationWithJoins[]
  filtered: readonly ReservationWithJoins[]
  day: DaySegments
  note: string | null
}) {
  const { date, rows, filtered, day, note } = input
  const active = rows.filter(occupiesTable)
  const distinguish = nameDisambiguation(rows)
  const list = sortForBoard([...filtered]).map((r) =>
    reservationRow(r, { distinguish: distinguish.get(r.id) }),
  )
  const { filas, hay_mas } = cappedBySize(list, LIST_MAX, LIST_MAX_CHARS)
  const cancelled = rows.filter((r) => r.status === 'cancelled').length
  const noShow = rows.filter((r) => r.status === 'no_show').length
  return compact({
    dia: dayText(date),
    dia_semana: weekdayName(date),
    nota: note,
    reservas: active.length,
    personas: active.reduce((sum, r) => sum + coversOf(r), 0),
    canceladas: cancelled > 0 ? cancelled : null,
    no_vinieron: noShow > 0 ? noShow : null,
    servicios: activeDaySegments(day).map((s) => segmentData(s, day.isoDow)),
    horas_mal_cargadas: day.mismatches.length > 0 ? day.mismatches.map(mismatchCopy) : null,
    cuantas_filas: filtered.length,
    filas,
    hay_mas,
  })
}

/** Un día de un rango, en una línea, con las palabras del calendario. */
export function rangeDayRow(day: DaySegments) {
  const segments = activeDaySegments(day)
  const alerts = segments
    .filter((s) => ['warn', 'over'].includes(segmentTone(s)))
    .map((s) => `${SEGMENT_LABELS[s.key]}: ${segmentStatusLine(s)}`)
  return compact({
    fecha: dayText(day.date),
    dia: weekdayName(day.date),
    servicios: segments.map((s) => segmentHeadline(s, 'short')).join(' · '),
    alerta: alerts.length > 0 ? alerts.join(' · ') : null,
  })
}

export function rangeServicesData(days: readonly DaySegments[]) {
  return SEGMENT_KEYS.flatMap((key) => {
    let people = 0
    let reservations = 0
    for (const day of days) {
      people += day.segments[key].people
      reservations += day.segments[key].activeReservations
    }
    return reservations > 0
      ? [{ servicio: SEGMENT_LABELS[key], personas: people, reservas: reservations }]
      : []
  })
}

export function rangeReservationsData(input: {
  label: string
  totals: RangeTotals
  /** Los días del rango con algo, si el rango entra en el cálculo por servicio. */
  days: readonly DaySegments[] | null
  rows: readonly ReservationWithJoins[]
  total: number
}) {
  const { label, totals, days, rows, total } = input
  const distinguish = nameDisambiguation(rows)
  const list = rows.map((r) =>
    reservationRow(r, { withDate: true, distinguish: distinguish.get(r.id) }),
  )
  const { filas, hay_mas } = cappedBySize(list, LIST_MAX, LIST_MAX_CHARS - 2_500)
  const withActivity = (days ?? []).filter((d) => activeDaySegments(d).length > 0)
  return compact({
    periodo: label,
    reservas: totals.reservations,
    personas: totals.guests,
    salon: totals.salon,
    en_eventos: totals.eventos,
    cumples: totals.birthdays > 0 ? totals.birthdays : null,
    tortas: totals.cakes > 0 ? totals.cakes : null,
    por_servicio: days ? rangeServicesData(days) : null,
    dias: days ? capped(withActivity.map(rangeDayRow), 35).filas : null,
    nota: days
      ? null
      : 'El rango es largo: el desglose por servicio se pide de a 4 meses como máximo.',
    cuantas_filas: total,
    filas,
    hay_mas: hay_mas || total > filas.length,
  })
}

// ─── El tablero de la noche ──────────────────────────────────────────────────

export const BOARD_WORDS = {
  por_llegar: 'waiting',
  adentro: 'inside',
  terminadas: 'done',
  todas: 'all',
} as const satisfies Record<string, BoardFilter>

export type BoardWord = keyof typeof BOARD_WORDS

export function boardRow(
  r: ReservationWithJoins,
  clock: number | null,
  distinguish: string | undefined,
) {
  const waiting = r.status === 'pending'
  return compact({
    id: r.id,
    hora: hhmm(r.reservation_time_local),
    nombre: redactContacts(r.guest_name),
    distingue: distinguish ?? null,
    personas: coversOf(r),
    lugar: placeLabel(r, joinedEventName(r)),
    estado: STATUS_LABELS[r.status],
    mesa: r.table_label,
    cuando: waiting && clock !== null ? relativeTimeLabel(minutesUntil(r, clock)) : null,
    atrasada: waiting && urgencyOf(r, clock) === 'late' ? true : null,
    tipo: r.kind === 'normal' ? null : RESERVATION_KIND_LABELS[r.kind],
    sena: moneyIf(Number(r.deposit_cents)),
    torta: cakeText(r),
    avisos: alertsOf(r),
    nota: r.highlight_comment ? noteOf(r.comments, 120) : null,
  })
}

/** Quién falta llegar, quién está adentro y cómo viene cada servicio, con el reloj del tablero. */
export function boardData(input: {
  date: string
  serviceDay: string
  rows: ReservationWithJoins[]
  day: DaySegments
  /** Minutos del reloj del servicio; `null` si no es la noche de hoy. */
  clock: number | null
  nowText: string
  afterMidnight: boolean
  ver: BoardWord
  buscar?: string
}) {
  const { date, serviceDay, rows, day, clock, nowText, afterMidnight, ver, buscar } = input
  const pulse = nightPulse(rows, clock)
  const distinguish = nameDisambiguation(rows)
  const filter = BOARD_WORDS[ver]
  const list = filterForBoard(rows, { query: buscar ?? '', filter }).map((r) =>
    boardRow(r, clock, distinguish.get(r.id)),
  )
  const { filas, hay_mas } = cappedBySize(list, LIST_MAX, LIST_MAX_CHARS)
  return compact({
    dia: dayText(date),
    dia_semana: weekdayName(date),
    hora: clock !== null ? nowText : null,
    nota: afterMidnight
      ? `Pasó la medianoche: hasta las 5 el tablero sigue en la noche del ${dayText(date)}.`
      : date > serviceDay
        ? 'Es un día que todavía no llegó: nadie puede estar adentro.'
        : null,
    por_llegar: { reservas: pulse.waiting, personas: pulse.waitingCovers, atrasadas: pulse.late },
    adentro: { reservas: pulse.inside, personas: pulse.insideCovers },
    cerradas: { reservas: pulse.closed, personas: pulse.closedCovers },
    no_vinieron: { reservas: pulse.noShow, personas: pulse.noShowCovers },
    total: { reservas: pulse.reservations, personas: pulse.covers },
    servicios: activeDaySegments(day).map((s) => ({
      servicio: SEGMENT_LABELS[s.key],
      personas: s.people,
      cupo: s.capacity ?? 'sin tope',
      estado: segmentStatusLine(s),
    })),
    mostrando: buscar ? `Lo que coincide con «${buscar}»` : BOARD_FILTER_LABELS[filter],
    filas,
    hay_mas,
  })
}

// ─── Eventos y formatos ──────────────────────────────────────────────────────

export function eventRow(e: ScheduledEventWithTemplate, load: SegmentEventLoad | undefined) {
  const name = eventDisplayName(e)
  const used = load?.used ?? 0
  return compact({
    id: e.id,
    fecha: dayText(e.event_date),
    dia: weekdayName(e.event_date),
    hora: hhmm(e.starts_at_local),
    nombre: name,
    formato: e.template && e.template.name.trim() !== name ? e.template.name : null,
    servicio: SEGMENT_LABELS[segmentOfEventStart(e.starts_at_local)],
    cupo: e.capacity,
    personas: used,
    libres: Math.max(0, e.capacity - used),
    pasado_por: used > e.capacity ? used - e.capacity : null,
    reservas: load?.reservations ?? 0,
    cumples: load && load.birthdays > 0 ? load.birthdays : null,
    tortas: load && load.cakes > 0 ? load.cakes : null,
    grupo_privado: e.private_group ? true : null,
  })
}

export function eventCard(e: ScheduledEventWithTemplate, rows: readonly ReservationWithJoins[]) {
  const active = rows.filter(occupiesTable)
  const used = active.reduce((sum, r) => sum + coversOf(r), 0)
  const distinguish = nameDisambiguation(rows)
  const list = sortForBoard(rows.filter((r) => r.status !== 'cancelled')).map((r) =>
    reservationRow(r, { distinguish: distinguish.get(r.id) }),
  )
  const { filas, hay_mas } = cappedBySize(list, LIST_MAX, LIST_MAX_CHARS)
  const cancelled = rows.length - rows.filter((r) => r.status !== 'cancelled').length
  return compact({
    id: e.id,
    nombre: eventDisplayName(e),
    formato: e.template?.name ?? null,
    fecha: dayText(e.event_date),
    dia: weekdayName(e.event_date),
    hora: hhmm(e.starts_at_local),
    hasta: e.ends_at_local ? hhmm(e.ends_at_local) : null,
    servicio: SEGMENT_LABELS[segmentOfEventStart(e.starts_at_local)],
    cupo: e.capacity,
    personas: used,
    libres: Math.max(0, e.capacity - used),
    pasado_por: used > e.capacity ? used - e.capacity : null,
    reservas: active.length,
    canceladas: cancelled > 0 ? cancelled : null,
    puntos_por_asistir: e.attendance_points > 0 ? e.attendance_points : null,
    bonus_por_lleno: e.full_bonus_active,
    grupo_privado: e.private_group ? true : null,
    notas: shortText(e.notes, 200),
    filas,
    hay_mas,
  })
}

export function templateRow(t: ScheduledEventTemplateRow) {
  return compact({
    id: t.id,
    nombre: t.name.replace(/\s+/g, ' ').trim(),
    cupo: t.default_capacity,
    servicio: SEGMENT_LABELS[segmentOfMealType(t.default_meal_type)],
    inactivo: t.active ? null : true,
    grupos_privados: t.default_private_group ? true : null,
  })
}

export function cakeRow(c: CakeOptionRow) {
  return { id: c.id, nombre: c.name, masa: c.base, rellenos: c.fillings }
}

/** Sin teléfono ni mail: en el panel tampoco hacen falta para elegir quién la tomó. */
export function managerRow(m: ReservationManagerRow, selfId: string | null) {
  return compact({
    id: m.id,
    nombre: m.display_name,
    cobra_comision: m.commission_eligible,
    con_cuenta: m.user_id !== null,
    vos: m.id === selfId ? true : null,
  })
}

// ─── Comisiones ──────────────────────────────────────────────────────────────

export function commissionSummaryData(
  period: CommissionPeriod,
  rows: readonly CommissionSummaryRow[],
  truncated: boolean,
) {
  const totals = rows.reduce(
    (sum, r) => ({
      payable: sum.payable + r.payable_cents,
      paid: sum.paid + r.paid_cents,
      pending: sum.pending + r.pending_cents,
      guests: sum.guests + r.guests_total,
      reservations: sum.reservations + r.reservations_count,
      uncounted: sum.uncounted + r.uncounted_count,
    }),
    { payable: 0, paid: 0, pending: 0, guests: 0, reservations: 0, uncounted: 0 },
  )
  return compact({
    periodo: period.label,
    total: money(totals.payable),
    pagado: money(totals.paid),
    falta_pagar: money(totals.pending),
    reservas: totals.reservations,
    personas: totals.guests,
    sin_contar: totals.uncounted > 0 ? totals.uncounted : null,
    gestores: rows.map((r) =>
      compact({
        id: r.manager.id,
        nombre: r.manager.display_name,
        reservas: r.reservations_count,
        personas: r.guests_total,
        base: money(r.base_cents),
        bonus: moneyIf(r.bonus_cents),
        total: money(r.payable_cents),
        pagado: money(r.paid_cents),
        falta_pagar: money(r.pending_cents),
        sin_contar: r.uncounted_count > 0 ? r.uncounted_count : null,
      }),
    ),
    aviso: truncated
      ? 'Hay más reservas de las que entran en una lectura: estos totales pueden estar incompletos. Pedí un período más corto.'
      : null,
  })
}

function entryRow(e: CommissionBreakdownEntry, today: string) {
  return compact({
    reserva_id: e.reservation.id,
    fecha: dayText(e.reservation.reservation_date),
    reserva: redactContacts(e.reservation.guest_name),
    personas: e.guests_billed,
    sin_contar: e.reservation.actual_guests === null ? true : null,
    base: money(e.base_total_cents),
    bonus: moneyIf(e.bonus_total_cents),
    parte:
      e.split_factor_denominator > 1
        ? `${e.split_factor_numerator}/${e.split_factor_denominator}`
        : null,
    total: money(e.payable_cents),
    estado: e.paid_at
      ? 'Pagado'
      : e.reservation.reservation_date > today
        ? 'Pendiente, todavía no pasó'
        : 'Pendiente',
  })
}

/** El detalle de un gestor. Lo que no pasó todavía no se puede liquidar: va aparte. */
export function commissionEntriesData(input: {
  period: CommissionPeriod
  manager: string
  entries: readonly CommissionBreakdownEntry[]
  truncated: boolean
  today: string
}) {
  const { period, manager, entries, truncated, today } = input
  let paid = 0
  let pending = 0
  let payableNow = 0
  let guests = 0
  for (const e of entries) {
    guests += e.guests_billed
    if (e.paid_at) {
      paid += e.payable_cents
      continue
    }
    pending += e.payable_cents
    if (e.reservation.reservation_date <= today) payableNow += e.payable_cents
  }
  const { filas, hay_mas } = cappedBySize(
    entries.map((e) => entryRow(e, today)),
    LIST_MAX,
    LIST_MAX_CHARS,
  )
  return compact({
    gestor: manager,
    periodo: period.label,
    a_cobrar: money(pending),
    cobrado: money(paid),
    se_puede_liquidar_hoy: money(payableNow),
    reservas: entries.length,
    personas: guests,
    filas,
    hay_mas,
    aviso: truncated
      ? 'Hay más reservas de las que entran en una lectura: estos números pueden estar incompletos. Pedí un período más corto.'
      : null,
  })
}

export function rateTierData(
  tiers: readonly CommissionRateTierRow[],
  bonus: CommissionBonusRuleRow | null,
) {
  return compact({
    tarifas: tiers
      .filter((t) => t.active && t.meal_type !== 'hub_event')
      .map((t) => ({
        servicio: SEGMENT_LABELS[segmentOfMealType(t.meal_type)],
        personas:
          t.max_guests === null ? `${t.min_guests} o más` : `${t.min_guests} a ${t.max_guests}`,
        por_persona: money(t.rate_per_guest_cents),
      })),
    bonus_evento_lleno_por_persona:
      bonus?.active && bonus.bonus_per_guest_cents > 0 ? money(bonus.bonus_per_guest_cents) : null,
  })
}

// ─── Señas ───────────────────────────────────────────────────────────────────

export function depositsData(report: DepositsReport, label: string, basis: DepositBasis) {
  const { totals } = report
  const days = report.days
    .filter((d) => d.total_cents > 0)
    .map((d) =>
      compact({
        fecha: dayText(d.day),
        total: money(d.total_cents),
        canceladas_o_no_vino: moneyIf(d.fallen_cents),
        con_sena: d.with_deposit,
        reservas: d.reservations,
      }),
    )
  const { filas, hay_mas } = capped(days, 40)
  return compact({
    periodo: label,
    criterio: DEPOSIT_BASIS_LABELS[basis],
    total: money(totals.total_cents),
    vigente: money(totals.active_cents),
    canceladas: moneyIf(totals.cancelled_cents),
    no_vino: moneyIf(totals.no_show_cents),
    reservas: totals.reservations,
    con_sena: totals.with_deposit,
    dia_mas_alto: totals.top_day
      ? { fecha: dayText(totals.top_day.day), total: money(totals.top_day.total_cents) }
      : null,
    mediana_por_dia: moneyIf(totals.median_day_cents),
    promedio_por_dia: moneyIf(totals.avg_day_cents),
    filas,
    hay_mas,
    aviso: report.truncated
      ? 'Hay más reservas de las que entran en una lectura: el total puede estar incompleto. Pedí un período más corto.'
      : null,
  })
}

// ─── Entradas ────────────────────────────────────────────────────────────────

export type SeatReservationRow = {
  scheduled_event_id: string | null
  estimated_guests: number
  actual_guests: number | null
}

export type SeatOrderRow = {
  scheduled_event_id: string | null
  party_size: number
  status: string
  hold_expires_at: string
}

export type SeatCount = { taken: number; held: number; sold: number }

/**
 * La misma cuenta que `ticketing_event_seats`, con lo que la sesión del dueño puede leer: esa función
 * es solo del servidor y Tex no usa `service_role`. Ocupados = reservas en pie; guardados = compras a
 * medio pagar con el lugar todavía guardado. `sold` es solo para contar lo vendido online.
 */
export function seatCounts(
  reservations: readonly SeatReservationRow[],
  orders: readonly SeatOrderRow[],
  now: Date,
): Map<string, SeatCount> {
  const counts = new Map<string, SeatCount>()
  const of = (id: string): SeatCount => {
    const found = counts.get(id)
    if (found) return found
    const fresh = { taken: 0, held: 0, sold: 0 }
    counts.set(id, fresh)
    return fresh
  }
  for (const r of reservations) {
    if (!r.scheduled_event_id) continue
    of(r.scheduled_event_id).taken += r.actual_guests ?? r.estimated_guests
  }
  for (const o of orders) {
    if (!o.scheduled_event_id) continue
    if (o.status === 'approved') of(o.scheduled_event_id).sold += o.party_size
    else if (
      (o.status === 'pending' || o.status === 'rejected') &&
      new Date(o.hold_expires_at).getTime() > now.getTime()
    ) {
      of(o.scheduled_event_id).held += o.party_size
    }
  }
  return counts
}

export type ExperienceLite = {
  id: string
  template_id: string
  slug: string
  published: boolean
  title: string
  price_cents: number
  deposit_cents: number
  cash_price_cents: number | null
  allow_full_payment: boolean | null
  min_party_size: number | null
  max_party_size: number
}

function functionsOf(
  experience: ExperienceLite,
  events: readonly ScheduledEventWithTemplate[],
  counts: ReadonlyMap<string, SeatCount>,
  nowLocal: string,
) {
  const minParty = Math.max(1, experience.min_party_size ?? 1)
  return events
    .filter(
      (e) =>
        e.template_id === experience.template_id &&
        !e.private_group &&
        isOnSale(e.event_date, e.starts_at_local, nowLocal),
    )
    .map((e) => {
      const count = counts.get(e.id) ?? { taken: 0, held: 0, sold: 0 }
      const left = seatsLeft(e.capacity, count.taken, count.held)
      return {
        eventId: e.id,
        date: e.event_date,
        time: formatTime(e.starts_at_local),
        capacity: e.capacity,
        left,
        state: functionState(left, e.capacity, minParty),
        taken: count.taken,
        held: count.held,
        sold: count.sold,
      }
    })
}

/** La cartelera con cada función: cuántos lugares tiene, cuántos quedan y cuántos se vendieron online. */
export function entradasData(input: {
  experiences: readonly ExperienceLite[]
  events: readonly ScheduledEventWithTemplate[]
  counts: ReadonlyMap<string, SeatCount>
  nowLocal: string
  canSell: boolean
  publicUrl: string
  wanted?: string
}) {
  const { experiences, events, counts, nowLocal, canSell, publicUrl, wanted } = input
  const films = experiences.map((experience) => ({
    experience,
    published: experience.published,
    functions: functionsOf(experience, events, counts, nowLocal),
  }))
  const summary = carteleraSummary(films)
  const key = wanted ? normalizeText(wanted) : null
  const shown = key
    ? films.filter(
        (f) => normalizeText(f.experience.title).includes(key) || f.experience.slug.includes(key),
      )
    : films
  const rows = shown.map(({ experience: e, functions }) =>
    compact({
      id: e.id,
      pelicula: e.title,
      publicada: e.published,
      precio: money(Number(e.price_cents)),
      precio_efectivo: e.cash_price_cents === null ? null : money(Number(e.cash_price_cents)),
      sena: money(Number(e.deposit_cents)),
      solo_sena: e.allow_full_payment === false ? true : null,
      personas: `${Math.max(1, e.min_party_size ?? 1)} a ${e.max_party_size}`,
      funciones: functions.map((fn) =>
        compact({
          evento_id: fn.eventId,
          fecha: dayText(fn.date),
          dia: weekdayName(fn.date),
          hora: fn.time,
          cupo: fn.capacity,
          ocupados: fn.taken,
          guardados: fn.held > 0 ? fn.held : null,
          quedan: fn.left,
          vendidas_online: fn.sold,
          estado: availabilityLabel(fn),
        }),
      ),
    }),
  )
  const { filas, hay_mas } = cappedBySize(rows, 20, LIST_MAX_CHARS)
  return compact({
    se_puede_vender: canSell,
    cartelera: publicUrl,
    publicadas: summary.published,
    apagadas: summary.drafts,
    funciones_a_la_venta: summary.onSale,
    funciones_agotadas: summary.soldOut,
    filas,
    hay_mas,
  })
}

export const ORDER_FILTERS = ['pagadas', 'en_curso', 'sin_pagar', 'devueltas', 'a_revisar'] as const
export type OrderFilter = (typeof ORDER_FILTERS)[number]

function orderMatches(order: AdminOrder, filter: OrderFilter | undefined, now: Date): boolean {
  if (!filter) return true
  if (filter === 'a_revisar') return order.attention !== null
  const { tone } = orderStatusView(order, now)
  if (filter === 'pagadas') return tone === 'paid'
  if (filter === 'en_curso') return tone === 'paying' || tone === 'retrying'
  if (filter === 'sin_pagar') return tone === 'unpaid'
  return tone === 'refunded'
}

/** Las últimas ventas online. Sin el teléfono de quien compró: los últimos 4 si hay dos con el mismo nombre. */
export function ordersData(input: {
  orders: readonly AdminOrder[]
  now: Date
  estado?: OrderFilter
  pelicula?: string
  /** El tope de lo que se leyó, para decir si hay más. */
  read: number
}) {
  const { orders, now, estado, pelicula, read } = input
  const key = pelicula ? normalizeText(pelicula) : null
  const shown = orders.filter(
    (o) => orderMatches(o, estado, now) && (!key || normalizeText(o.title).includes(key)),
  )
  const nameCount = new Map<string, number>()
  for (const o of orders) {
    const name = normalizeText(o.guest_name)
    nameCount.set(name, (nameCount.get(name) ?? 0) + 1)
  }
  const paid = shown.filter((o) => o.status === 'approved')
  const rows = shown.map((o) =>
    compact({
      id: o.id,
      pelicula: o.title,
      funcion: orderFunctionLabel(o),
      a_nombre_de: redactContacts(o.guest_name),
      distingue:
        (nameCount.get(normalizeText(o.guest_name)) ?? 0) > 1 ? maskPhone(o.guest_phone) : null,
      personas: o.party_size,
      forma: paymentOptionLabel(o.payment_option),
      monto: money(orderAmountCents(o)),
      estado: orderStatusView(o, now).label,
      a_revisar: attentionView(o.attention)?.label ?? null,
      entraron: orderEntryLabel(o),
      deshizo: o.undo ? orderUndoLabel(o.undo).label : null,
      cuando: formatOrderMoment(o.created_at, now),
      reserva_id: o.reservation_id,
    }),
  )
  const { filas, hay_mas } = cappedBySize(rows, 40, LIST_MAX_CHARS)
  return compact({
    cobrado: money(paid.reduce((sum, o) => sum + orderAmountCents(o), 0)),
    personas_pagas: paid.reduce((sum, o) => sum + o.party_size, 0),
    cuantas: shown.length,
    filas,
    hay_mas,
    nota:
      orders.length >= read
        ? `Son las últimas ${read} compras: las anteriores se ven en la pantalla.`
        : null,
  })
}
