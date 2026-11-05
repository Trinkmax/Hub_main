import { isoDayInCordoba } from '@/lib/dates'
import type { ReviewInsights, ReviewListItem } from '@/lib/reviews/queries'
import type { BirthdayTile, MonthBirthdayReport } from '@/lib/salon/birthdays-report'
import { buildEventConsolidated } from '@/lib/salon/event-consolidated'
import {
  computeMarketingKpis,
  type EventMarketingRow,
  editionMarketingLine,
  formatPercent,
  formatUsd,
  type MarketingBlock,
  type MarketingPhase,
  type MonthMarketingReport,
  marketingSentence,
  nightAccountView,
  phaseOf,
  returnSentence,
  shortName,
} from '@/lib/salon/event-marketing'
import type { DayReport, ReportBlock, TemplateReport } from '@/lib/salon/events-report'
import {
  monthPrivateGroupsNote,
  privateEditionsNote,
  type WithPrivateGroups,
} from '@/lib/salon/private-groups'
import type { EventTemplateOption, TodaySalonOverview } from '@/lib/salon/queries'
import { MEAL_TYPE_LABELS, type MealType } from '@/lib/salon/types'
import type { DateRange, DateRangeInput } from '@/lib/staff-performance/date-range'
import type { StaffSummaryRow } from '@/lib/staff-performance/queries'
import type {
  ChurnRiskRow,
  CommunicationStats,
  EventRanking,
  Kpis,
  TopCustomerRow,
} from '@/lib/stats/queries'
import { cappedBySize, compact, plain, shortText } from '../read/common'
import { capped, dayText, money } from '../types'

/**
 * Los números del negocio, como los lee Tex: la misma cuenta que las pantallas (los reportes ya hacen
 * todas las cuentas y redactan), sin datos de contacto de nadie. Puro: lo prueba `tex-negocio.test.ts`.
 */

const LIST_MAX = 40
const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const

const pesos = (cents: number | string | null | undefined) => money(Number(cents ?? 0))

// ─── Los datos de contacto ───────────────────────────────────────────────────

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
/** Siete dígitos o más, con lo que la gente les pone en el medio. */
const PHONE_RE = /(?:\+?\d[\s().-]*){7,}/g
const HANDLE_RE = /(^|[\s(])@[\w.]{2,}/g

/** Un comentario puede traer un teléfono o un mail: esto viaja a la API de un tercero. */
export function withoutContact(text: string): string {
  return text
    .replace(EMAIL_RE, '[mail]')
    .replace(PHONE_RE, (match) => `[teléfono]${/[\s().-]*$/.exec(match)?.[0] ?? ''}`)
    .replace(HANDLE_RE, '$1[usuario]')
}

// ─── El Resumen (la portada del dueño) ───────────────────────────────────────

export type DailyMetric = {
  day: string | null
  visits: number | null
  revenue_cents: number | string | null
  customers_active: number | null
  customers_new: number | null
}

/** La misma cuenta de la portada: `+12%`, `-3%`, `0%` o «sin base» si antes no hubo nada. */
export function deltaText(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? '0%' : 'sin base'
  const rounded = Math.round(((current - previous) / previous) * 100)
  return rounded > 0 ? `+${rounded}%` : `${rounded}%`
}

function sumOf(rows: readonly DailyMetric[], read: (row: DailyMetric) => unknown): number {
  return rows.reduce((total, row) => total + Number(read(row) ?? 0), 0)
}

/** Lo que falta de los cinco pasos de «Configurá tu bar» (`onboarding-checklist.tsx`). */
export type SetupFacts = {
  capacitiesReady: boolean
  templatesReady: boolean
  eventScheduledReady: boolean
  firstReservationReady: boolean
  firstClosedReady: boolean
}

export function setupPending(facts: SetupFacts): string[] {
  return [
    ...(facts.capacitiesReady ? [] : ['Definí la capacidad del salón']),
    ...(facts.templatesReady ? [] : ['Creá los templates de eventos']),
    ...(facts.eventScheduledReady ? [] : ['Programá el primer evento del mes']),
    ...(facts.firstReservationReady ? [] : ['Cargá la primera reserva']),
    ...(facts.firstClosedReady ? [] : ['Cerrá la primera mesa']),
  ]
}

const MEAL_ORDER: readonly MealType[] = ['breakfast', 'lunch', 'tea_time', 'dinner', 'hub_event']

export function todayData(overview: TodaySalonOverview) {
  const { byStatus, peak } = overview
  return compact({
    fecha: dayText(overview.date),
    reservas: overview.reservationsCount,
    personas: overview.estimatedGuests,
    pendientes: byStatus.pending || null,
    llegaron: byStatus.arrived || null,
    sentadas: byStatus.seated || null,
    cerradas: byStatus.closed || null,
    pico: peak ? `${peak.startHHMM} a ${peak.endHHMM}, ${peak.guests} personas` : null,
    por_servicio: MEAL_ORDER.filter((meal) => overview.byMeal[meal].count > 0).map((meal) => ({
      servicio: MEAL_TYPE_LABELS[meal],
      reservas: overview.byMeal[meal].count,
      personas: overview.byMeal[meal].guests,
    })),
  })
}

function topCustomerRow(row: TopCustomerRow) {
  return compact({
    id: row.customer_id,
    nombre: `${row.first_name} ${row.last_name}`.trim(),
    visitas: row.total_visits,
    consumo_total: pesos(row.total_spent_cents),
    ticket_promedio: pesos(row.avg_ticket_cents),
    ultima_visita: dayText(isoDayInCordoba(row.last_visit_at)),
    lo_que_mas_pide: row.favorite_item_name,
  })
}

export function homeData(input: {
  kpis: Kpis
  daily: readonly DailyMetric[]
  top: readonly TopCustomerRow[]
  today: TodaySalonOverview
  setup: SetupFacts
}) {
  const { kpis, daily } = input
  // La misma partición de la portada: las últimas 30 filas contra las anteriores.
  const last = daily.slice(-30)
  const previous = daily.slice(0, Math.max(0, daily.length - 30))
  const visits = sumOf(last, (row) => row.visits)
  const revenue = sumOf(last, (row) => row.revenue_cents)
  const fresh = sumOf(last, (row) => row.customers_new)
  return compact({
    hoy: todayData(input.today),
    ultimos_30_dias: {
      clientes: kpis.customers_total,
      clientes_nuevos: fresh,
      nuevos_contra_antes: deltaText(
        fresh,
        sumOf(previous, (row) => row.customers_new),
      ),
      activos: kpis.customers_active_30d,
      visitas: kpis.visits_30d,
      visitas_contra_antes: deltaText(
        visits,
        sumOf(previous, (row) => row.visits),
      ),
      facturacion: pesos(kpis.revenue_30d_cents),
      facturacion_contra_antes: deltaText(
        revenue,
        sumOf(previous, (row) => row.revenue_cents),
      ),
      ticket_promedio: pesos(kpis.avg_ticket_30d_cents),
    },
    // La tarjeta de la portada se titula «del mes», pero suma toda la historia de cada cliente.
    top_clientes_por_consumo_total: input.top.map(topCustomerRow),
    falta_configurar: setupPending(input.setup),
  })
}

// ─── Estadísticas ────────────────────────────────────────────────────────────

export type HeatPoint = { dow: number | null; hour: number | null; visit_count: number | null }

/** Las franjas con más visitas: el mapa de calor en cinco renglones. */
export function busiestSlots(points: readonly HeatPoint[], max = 5) {
  return [...points]
    .sort((a, b) => Number(b.visit_count ?? 0) - Number(a.visit_count ?? 0))
    .slice(0, max)
    .filter((point) => Number(point.visit_count ?? 0) > 0)
    .map((point) => ({
      franja: `${DOW_LABELS[Number(point.dow)] ?? '?'} ${String(point.hour ?? 0).padStart(2, '0')}:00`,
      visitas: Number(point.visit_count ?? 0),
    }))
}

/** Noventa días en filas gastan de más: por mes. */
export function byMonth(daily: readonly DailyMetric[]) {
  const months = new Map<string, { visitas: number; cents: number }>()
  for (const row of daily) {
    const month = row.day?.slice(0, 7)
    if (!month) continue
    const sum = months.get(month) ?? { visitas: 0, cents: 0 }
    sum.visitas += Number(row.visits ?? 0)
    sum.cents += Number(row.revenue_cents ?? 0)
    months.set(month, sum)
  }
  return [...months.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, sum]) => ({ mes: month, visitas: sum.visitas, facturacion: money(sum.cents) }))
}

export function overviewStats(input: {
  kpis: Kpis
  daily: readonly DailyMetric[]
  heat: readonly HeatPoint[]
}) {
  const { kpis, daily, heat } = input
  return {
    ultimos_30_dias: {
      clientes: kpis.customers_total,
      activos: kpis.customers_active_30d,
      visitas: kpis.visits_30d,
      visitas_por_dia: Number((kpis.visits_30d / 30).toFixed(1)),
      facturacion: pesos(kpis.revenue_30d_cents),
      ticket_promedio: pesos(kpis.avg_ticket_30d_cents),
    },
    ultimos_90_dias: {
      facturacion: money(sumOf(daily, (row) => row.revenue_cents)),
      por_mes: byMonth(daily),
    },
    franjas_con_mas_visitas: busiestSlots(heat),
  }
}

/** Sin el teléfono, que la vista trae y acá no hace falta: el id lleva a la ficha. */
function churnRow(row: ChurnRiskRow) {
  return compact({
    id: row.customer_id,
    nombre: `${row.first_name} ${row.last_name}`.trim(),
    visitas: row.total_visits,
    venia_cada_dias: Number(row.visit_frequency_days),
    dias_sin_venir: row.days_since_last_visit,
    ultima_visita: dayText(isoDayInCordoba(row.last_visit_at)),
    consumo_total: pesos(row.total_spent_cents),
  })
}

export function customerStats(
  top: readonly TopCustomerRow[],
  churn: readonly ChurnRiskRow[],
  max: number,
) {
  const risk = capped(churn.map(churnRow), max)
  return {
    top_por_consumo_total: top.slice(0, max).map(topCustomerRow),
    en_riesgo_de_irse: {
      cuantos: churn.length,
      filas: risk.filas,
      hay_mas: risk.hay_mas,
    },
  }
}

export function eventStats(events: readonly EventRanking[], today: string) {
  return {
    filas: events.map((event) =>
      compact({
        id: event.event_id,
        evento: event.event_name,
        fecha: dayText(event.starts_at),
        todavia_no_paso: event.starts_at > today ? true : null,
        reservas: event.reservations,
        asistieron: event.attended,
        no_vinieron: event.no_show,
        no_show: `${Math.round(event.no_show_rate * 100)} %`,
      }),
    ),
  }
}

/**
 * Cada destinatario cuenta una vez, en su último estado: un leído ya no está en «entregados» ni en
 * «enviados». Por eso acá no se saca un porcentaje de uno sobre otro.
 */
export function commsStats(stats: CommunicationStats) {
  return {
    destinatarios: stats.total_recipients,
    enviados: stats.sent,
    entregados: stats.delivered,
    leidos: stats.read,
    fallaron: stats.failed,
    nota: 'Cada destinatario cuenta una sola vez, en su último estado: un leído no suma en entregados.',
  }
}

export const STAFF_PERIODS = {
  hoy: 'today',
  ultimos_7: 'last7',
  ultimos_30: 'last30',
  este_mes: 'this_month',
  mes_pasado: 'last_month',
} as const

/**
 * El período de la pestaña Mozos. Las fechas van con la hora de Córdoba: a medianoche UTC serían el día
 * anterior acá.
 */
export function staffRangeInput(input: {
  periodo?: keyof typeof STAFF_PERIODS
  desde?: string
  hasta?: string
}): DateRangeInput {
  if (input.desde && input.hasta) {
    return {
      preset: 'custom',
      from: new Date(`${input.desde}T12:00:00-03:00`),
      to: new Date(`${input.hasta}T12:00:00-03:00`),
    }
  }
  return { preset: STAFF_PERIODS[input.periodo ?? 'ultimos_7'] }
}

/** Sin el mail: si un mozo no cargó su nombre, no se dice quién es por el mail. */
export function staffStats(rows: readonly StaffSummaryRow[], range: DateRange) {
  return {
    desde: dayText(isoDayInCordoba(range.from)),
    hasta: dayText(isoDayInCordoba(range.to)),
    filas: rows.map((row) => ({
      mozo: row.full_name?.trim() || 'Sin nombre cargado',
      mesas: row.sessions_count,
      personas: Number(row.party_size_share.toFixed(1)),
      facturacion: money(row.revenue_share_cents),
      items: Number(row.items_share.toFixed(1)),
    })),
  }
}

// ─── Cómo nos fue ────────────────────────────────────────────────────────────

/** Los textos de los reportes traen espacios duros. */
const words = (text: string | null | undefined) => (text ? plain(text) : null)

/** La pauta y la cuenta de una fecha de evento, redactadas por `event-marketing.ts`. */
export function nightPauta(
  block: MarketingBlock,
  row: EventMarketingRow | null,
  phase: MarketingPhase,
) {
  const account = nightAccountView(block, row, phase)
  const report = account.report
  const cuenta = compact({
    estado: account.status,
    falta_cargar: words(account.lead),
    titular: words(report?.headline),
    cuenta: words(report?.math),
    por_persona: words(report?.perGuest),
    despues_de_la_pauta: words(report?.perGuestAfterAds),
    con_que_gente: words(report?.basis),
    falta: words(report?.missing),
    nota: words(report?.revenueNote),
    aclaracion: report ? words(report.disclaimer) : null,
  })
  if (row === null) return { pauta: phase === 'past' ? 'Sin cargar' : 'Todavía no', cuenta }
  const k = computeMarketingKpis(block, row)
  const retorno = returnSentence(k)
  return {
    pauta: compact({
      frase: words(marketingSentence(block, row, phase)),
      invertido: row.adSpendUsdCents > 0 ? words(formatUsd(row.adSpendUsdCents / 100)) : null,
      mensajes: row.messages,
      alcance: row.reach,
      por_mensaje: k.costPerMessageUsd.ok ? words(formatUsd(k.costPerMessageUsd.value)) : null,
      cierre: k.closingRate.ok ? words(formatPercent(k.closingRate.value)) : null,
      por_reserva: k.costPerReservationUsd.ok
        ? words(formatUsd(k.costPerReservationUsd.value))
        : null,
      por_persona: k.costPerGuestUsd.ok ? words(formatUsd(k.costPerGuestUsd.value)) : null,
      retorno: retorno
        ? words(`${retorno.lead}${retorno.warning ? ` ${retorno.warning}` : ''}`)
        : null,
    }),
    cuenta,
  }
}

const BLOCK_KIND: Readonly<Record<ReportBlock['kind'], string>> = {
  event: 'evento',
  private: 'grupo privado',
  plain: 'sin evento',
}

function blockCounts(block: ReportBlock) {
  return compact({
    personas: block.guests,
    reservas: block.reservations,
    promedio_por_reserva: block.avg,
    contadas_al_cerrar: block.attendedGuests || null,
    mesas_contadas:
      block.reservations > 0 ? `${block.countedTables} de ${block.reservations}` : null,
    canceladas: block.cancelled || null,
    no_vinieron: block.noShow || null,
    personas_que_se_cayeron: block.fallenGuests || null,
  })
}

export function dayReportData(
  report: DayReport & { marketing: Readonly<Record<string, EventMarketingRow>> },
  today: string,
) {
  const phase = phaseOf(report.day, today)
  return compact({
    vista: 'Por día',
    fecha: dayText(report.day),
    personas: report.totals.guests,
    reservas: report.totals.reservations,
    bloques: report.blocks.map((block) =>
      compact({
        titulo: block.title,
        tipo: BLOCK_KIND[block.kind],
        evento_id: block.eventId,
        ...blockCounts(block),
        ...(block.kind === 'event'
          ? nightPauta(
              block,
              block.eventId ? (report.marketing[block.eventId] ?? null) : null,
              phase,
            )
          : {}),
      }),
    ),
    aviso: report.truncated ? 'Hay demasiadas reservas: faltan algunas en la cuenta.' : null,
  })
}

export function templateOptionsData(options: readonly EventTemplateOption[], truncated: boolean) {
  return compact({
    vista: 'Por evento',
    nota: 'Elegí un evento: mandalo en evento, con su nombre o su id.',
    aviso: truncated ? 'Hay demasiada historia: el orden puede no ser exacto.' : null,
    ...capped(
      options.map((option) =>
        compact({
          id: option.id,
          evento: option.name,
          fechas_hechas: option.pastEditions,
          personas: option.guests,
          proximas: option.upcoming || null,
        }),
      ),
      LIST_MAX,
    ),
  })
}

export function templateReportData(
  report: TemplateReport & { marketing: Readonly<Record<string, EventMarketingRow>> },
) {
  const consolidated = buildEventConsolidated({
    templateName: report.templateName,
    editions: report.editions,
    marketing: report.marketing,
  })
  const results = new Map(consolidated?.rows.map((row) => [row.eventId, row.result.sr]) ?? [])
  const rows = report.editions
    .filter((e) => e.reservations > 0 || e.isFuture || e.isTonight || report.marketing[e.key])
    .map((edition) => {
      const phase: MarketingPhase = edition.isFuture
        ? 'future'
        : edition.isTonight
          ? 'tonight'
          : 'past'
      const line = editionMarketingLine(edition, report.marketing[edition.key] ?? null, phase)
      return compact({
        evento_id: edition.eventId,
        fecha: dayText(edition.date),
        momento: phase === 'future' ? 'todavía no pasó' : phase === 'tonight' ? 'es hoy' : null,
        personas: edition.guests,
        reservas: edition.reservations,
        promedio_por_reserva: edition.avg,
        pauta: words(line?.text),
        resultado: words(results.get(edition.key)),
      })
    })
  const headline = consolidated?.headline
  return compact({
    vista: 'Por evento',
    evento: report.templateName,
    id: report.templateId,
    ultima: report.latest
      ? {
          fecha: dayText(report.latest.date),
          personas: report.latest.guests,
          reservas: report.latest.reservations,
        }
      : null,
    mejor: report.best ? { fecha: dayText(report.best.date), personas: report.best.guests } : null,
    promedio_de_personas: report.reference
      ? { personas: report.reference.avgGuests, fechas: report.reference.editions }
      : null,
    rentabilidad: consolidated
      ? compact({
          frase: words(`${headline?.before}${headline?.value}${headline?.after}`),
          sin_juzgar: words(consolidated.unjudgedNote),
          total: words(consolidated.total?.sentence),
        })
      : null,
    aviso: report.truncated ? 'Hay demasiadas reservas: faltan algunas en la cuenta.' : null,
    grupos_privados: words(privateEditionsNote(report.privateEditions)),
    ...cappedBySize(rows, LIST_MAX),
  })
}

export function monthPautaData(report: WithPrivateGroups<MonthMarketingReport>) {
  const rows = report.rows.map((row) =>
    compact({
      evento_id: row.eventId,
      fecha: dayText(row.date),
      evento: row.title,
      momento: row.phaseLabel,
      por_reserva: words(row.cardHeadline),
      detalle: words(row.cardLine),
      resultado: words(row.cells.nightResult.text) || null,
    }),
  )
  return compact({
    vista: 'Pauta',
    mes: report.monthLabel,
    aviso: report.emptyState?.title ?? report.notice,
    resumen: report.summary.map(plain),
    numeros: report.tiles.map((tile) =>
      compact({
        que: words(tile.label),
        valor: words(tile.value),
        detalle: words(tile.hint),
      }),
    ),
    resultado: report.result
      ? {
          frase: plain(report.result.sentence),
          cuenta: plain(report.result.math),
          base: plain(report.result.base),
          aclaracion: plain(report.result.disclaimer),
        }
      : null,
    faltan_cargar: report.pending
      ? {
          titulo: report.pending.title,
          fechas: report.pending.rows.map((row) =>
            compact({
              evento_id: row.eventId,
              fecha: dayText(row.date),
              evento: row.title,
              reservas: row.reservationsLabel,
            }),
          ),
        }
      : null,
    sin_pauta: words(report.noAdsText),
    grupos_privados: words(monthPrivateGroupsNote(report.privateGroups)),
    falta_informacion: report.truncated ? 'Hay demasiadas reservas: faltan algunas.' : null,
    ...cappedBySize(rows, LIST_MAX),
  })
}

function tileWords(tile: BirthdayTile) {
  return compact({ que: tile.label, valor: words(tile.value), detalle: words(tile.hint) })
}

export function birthdaysData(report: MonthBirthdayReport) {
  const days = report.days
    .filter((day) => day.birthdays > 0 || day.fallen > 0)
    .map((day) =>
      compact({
        dia: day.label,
        cumples: day.birthdays,
        personas: day.guests,
        en_eventos: day.inEvents || null,
        se_cayeron: day.fallen || null,
      }),
    )
  return compact({
    vista: 'Cumpleaños',
    mes: report.monthLabel,
    frase: plain(report.headline),
    numeros: report.tiles.map(tileWords),
    notas: report.notes.map(plain),
    reservados_en_el_mes: plain(report.bookedLine),
    pauta: report.pauta
      ? compact({
          frase: plain(report.pauta.sentence),
          numeros: report.pauta.tiles.map(tileWords),
          sin_cerrar: words(report.pauta.gap),
          falta: words(report.pauta.missing),
          ficha: report.pauta.ficha.map((item) => ({ que: item.label, valor: plain(item.value) })),
        })
      : 'Sin cargar',
    falta_informacion: report.truncated ? 'Hay demasiadas reservas: faltan algunas.' : null,
    ...cappedBySize(days, LIST_MAX),
  })
}

// ─── Las reseñas ─────────────────────────────────────────────────────────────

const REVIEW_COMMENT_MAX = 280

export function reviewRow(review: ReviewListItem) {
  const comment = review.comment
    ? shortText(withoutContact(review.comment), REVIEW_COMMENT_MAX)
    : null
  return compact({
    id: review.id,
    estrellas: review.rating,
    fecha: dayText(isoDayInCordoba(review.createdAt)),
    // Solo para reconocerla: nombre e inicial, y el id lleva a la ficha.
    cliente: shortName(review.customerName) ?? 'Anónimo',
    cliente_id: review.customerId,
    comentario: comment,
    fue_a_google: review.redirectedToMaps ? true : null,
  })
}

export function reviewsData(
  insights: ReviewInsights,
  reviews: readonly ReviewListItem[],
  rating: number | undefined,
) {
  return compact({
    total: insights.total,
    promedio: insights.total > 0 ? insights.average : null,
    cinco_estrellas: insights.total > 0 ? `${insights.fiveStarPct} %` : null,
    por_estrellas: insights.distribution,
    filtro: rating ? `${rating} ${rating === 1 ? 'estrella' : 'estrellas'}` : null,
    ...cappedBySize(reviews.map(reviewRow), LIST_MAX),
  })
}
