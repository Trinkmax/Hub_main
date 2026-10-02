/**
 * El cuadro «Conversión» de «Por evento» (la tira de fechas, a la derecha):
 * cuánta gente trajo cada fecha y cuánto costó traerla, de la más nueva a la
 * más vieja.
 *
 * Pedido de los socios (02/10/2026, C4): «Estos cuadritos son la clave, y
 * deberían ser exportables ambos […] Con el cuadro de la derecha, conversión.»
 * Este archivo arma TODO lo que el cuadro dibuja (`buildEventConversion`) y la
 * planilla que baja (`eventConversionToCsv`), con las mismas filas y los mismos
 * números: el componente (`editions-strip.tsx`) solo dibuja.
 *
 * Reglas (además de las de `event-marketing.ts` y `events-report.ts`):
 *
 * V1. **Filas = la tira.** Primero las fechas con reservas o con pauta gastada
 *     (de la más nueva a la más vieja); después las que no tuvieron ninguna de
 *     las dos (la tira las junta en una nota al pie; la planilla las trae como
 *     filas al final, con sus ceros). Si TODAS están vacías, van todas como
 *     filas: un cero es información distinta de un hueco.
 * V2. **La pauta solo si el evento tiene alguna fila de pauta.** Un evento que
 *     nunca se pautó no se llena de «Pauta sin cargar».
 * V3. **Hoy y lo que viene, «Por ahora»**: gasto y mensajes tal cual, sin
 *     cocientes (regla 6).
 * V4. **El total es el de la tira**: cociente de sumas sobre las fechas que ya
 *     pasaron CON mensajes cargados, y solo con 2 o más (con una, es esa fecha
 *     con otro nombre).
 * V5. **Los grupos privados no son fechas del evento**: no hay fila; una nota
 *     dice cuántas quedaron afuera (`privateEditionsNote`).
 * V6. **Los cocientes de una fecha, solo si su línea los dice.** Sin los
 *     mensajes, con 0 mensajes o sin ninguna reserva en pie, la línea lo dice
 *     en palabras («faltan los mensajes», «no escribió nadie», «ninguna
 *     reserva en pie») y la planilla deja vacíos el costo por mensaje, el
 *     cierre y el costo por reserva. Las dos deciden con `pastEditionQuotients`.
 *
 * Puro: sin DB, sin React y sin `Intl`.
 */

import { rowsToCsv } from '@/lib/stats/csv'
import { EVENT_CUADROS } from './event-cuadros'
import {
  csvFormulaGuard,
  csvPercent,
  csvUsd,
  type EventMarketingRow,
  editionMarketingLine,
  formatCount,
  formatDayMonth,
  isPendingMarketing,
  type MarketingPhase,
  marketingStatus,
  type PoolItem,
  pastEditionQuotients,
  pooledStripSummary,
  poolMarketing,
} from './event-marketing'
import { type EditionSummary, editionDelta, type TemplateReport } from './events-report'
import { privateEditionsNote } from './private-groups'

export const CONVERSION_TITLE = EVENT_CUADROS.conversion.title

// ─── El cuadro ───────────────────────────────────────────────────────────────

export type ConversionRow = {
  edition: EditionSummary
  phase: MarketingPhase
  /** Contra la anterior con reservas. `null` en la primera, hoy y lo que viene. */
  delta: { diff: number; againstDate: string } | null
  isBest: boolean
  /** La segunda línea: la pauta de esa fecha. `null` si el evento nunca se pautó (V2). */
  marketingLine: { text: string; tone: 'muted' | 'warning' } | null
}

export type EventConversion = {
  title: string
  subtitle: string
  /** Al lado del título: `9 fechas` (sin los grupos privados, V5). */
  countLabel: string
  /** Las fechas de la tira (V1). */
  rows: ConversionRow[]
  /** Las vacías que van al pie: `2 fechas más sin ninguna reserva: 06/10 · 13/10`. */
  collapsedText: string | null
  /** `La mejor: 15/09 con 62 personas · promedio 37 en 5 fechas`. */
  bestText: string | null
  /** El resumen agrupado de la pauta (V4); `pendingText` va en ámbar. */
  summary: { text: string; pendingText: string | null } | null
  /** La fecha más grande de la tira: la unidad de la barra sale de acá. */
  maxGuests: number
  /** Hay alguna fila de pauta en el evento (V2). */
  withAds: boolean
}

type ReportInput = Pick<
  TemplateReport,
  'editions' | 'best' | 'reference' | 'privateEditions' | 'templateName'
>
type MarketingInput = Readonly<Record<string, EventMarketingRow>>

function phaseOfEdition(e: Pick<EditionSummary, 'isFuture' | 'isTonight'>): MarketingPhase {
  return e.isTonight ? 'tonight' : e.isFuture ? 'future' : 'past'
}

function personas(n: number): string {
  return n === 1 ? '1 persona' : `${formatCount(n)} personas`
}

/** Las filas de la tira y las que colapsan al pie, en el orden de V1. */
function split(report: ReportInput, marketing: MarketingInput) {
  const rowOf = (e: EditionSummary) => marketing[e.eventId ?? e.key] ?? null
  const spent = (e: EditionSummary) => (rowOf(e)?.adSpendUsdCents ?? 0) > 0
  const listables = report.editions.filter((e) => e.reservations > 0 || spent(e))
  const empties = report.editions.filter((e) => e.reservations === 0 && !spent(e))
  return {
    rowOf,
    listed: listables.length > 0 ? listables : [...report.editions],
    collapsed: listables.length > 0 ? empties : [],
    withAds: report.editions.some((e) => rowOf(e) !== null),
  }
}

function poolItems(report: ReportInput, rowOf: (e: EditionSummary) => EventMarketingRow | null) {
  return report.editions.map(
    (e): PoolItem => ({
      phase: phaseOfEdition(e),
      reservations: e.reservations,
      guests: e.guests,
      billableGuests: e.billableGuests,
      row: rowOf(e),
    }),
  )
}

/**
 * Todo lo que dibuja el cuadro «Conversión». Pura y O(fechas).
 */
export function buildEventConversion(
  report: ReportInput,
  marketing: MarketingInput,
): EventConversion {
  const { rowOf, listed, collapsed, withAds } = split(report, marketing)
  const rows = listed.map((e): ConversionRow => {
    const phase = phaseOfEdition(e)
    return {
      edition: e,
      phase,
      delta: editionDelta(report.editions, report.editions.indexOf(e)),
      isBest: report.best?.date === e.date,
      marketingLine: withAds ? editionMarketingLine(e, rowOf(e), phase) : null,
    }
  })
  const n = report.editions.length
  return {
    title: CONVERSION_TITLE,
    subtitle: EVENT_CUADROS.conversion.subtitle,
    countLabel: n === 1 ? '1 fecha' : `${formatCount(n)} fechas`,
    rows,
    collapsedText:
      collapsed.length === 0
        ? null
        : `${formatCount(collapsed.length)} ${collapsed.length === 1 ? 'fecha más' : 'fechas más'} sin ninguna reserva: ${collapsed.map((e) => formatDayMonth(e.date)).join(' · ')}`,
    bestText: report.best
      ? `La mejor: ${formatDayMonth(report.best.date)} con ${personas(report.best.guests)}${
          report.reference
            ? ` · promedio ${formatCount(report.reference.avgGuests)} en ${formatCount(report.reference.editions)} fechas`
            : ''
        }`
      : null,
    summary: withAds ? pooledStripSummary(poolItems(report, rowOf)) : null,
    maxGuests: Math.max(1, ...listed.map((e) => e.guests)),
    withAds,
  }
}

// ─── La planilla ─────────────────────────────────────────────────────────────

export const CONVERSION_EXPORT_HEADERS: readonly string[] = [
  'Fecha',
  'Estado',
  'Personas',
  'Reservas',
  'Personas por reserva',
  'Diferencia con la anterior',
  'Fecha anterior',
  'Pauta USD',
  'Mensajes',
  'Costo por mensaje USD',
  '% de cierre',
  'Costo por reserva USD',
  'Estado de la pauta',
]

function estado(phase: MarketingPhase): string {
  return phase === 'tonight' ? 'es hoy' : phase === 'future' ? 'todavía no pasó' : 'ya pasó'
}

/** El promedio con UN decimal y coma, como la pantalla (`avgCell` de events-report). */
function avgCsv(avg: number | null): string {
  return avg === null ? '' : avg.toFixed(1).replace('.', ',')
}

/**
 * El estado de la pauta de una fecha, con las palabras de la tira: `completa`,
 * `faltan los mensajes`, `sin pauta`, `sin cargar` (solo si ya pasó: hoy y lo
 * que viene no están pendientes) o `por ahora`.
 */
function pautaEstado(row: EventMarketingRow | null, phase: MarketingPhase): string {
  if (row === null) return phase === 'past' ? 'sin cargar' : ''
  const status = marketingStatus(row)
  if (status === 'sin-pauta') return 'sin pauta'
  if (phase !== 'past') return 'por ahora'
  return status === 'incompleta' ? 'faltan los mensajes' : 'completa'
}

function conversionCsvRow(
  e: EditionSummary,
  report: ReportInput,
  row: EventMarketingRow | null,
  withAds: boolean,
): string[] {
  const phase = phaseOfEdition(e)
  const d = editionDelta(report.editions, report.editions.indexOf(e))
  const base = [
    e.date,
    estado(phase),
    String(e.guests),
    String(e.reservations),
    avgCsv(e.avg),
    d === null ? '' : String(d.diff),
    d === null ? '' : d.againstDate,
  ]
  if (!withAds || row === null) {
    return [...base, '', '', '', '', '', withAds ? pautaEstado(row, phase) : '']
  }
  const spend = row.adSpendUsdCents / 100
  const messages = row.messages === null ? '' : String(row.messages)
  // Hoy y lo que viene: solo lo cargado (V3). Sin pauta: nada de Meta.
  if (phase !== 'past' || row.adSpendUsdCents <= 0) {
    return [...base, csvUsd(spend), messages, '', '', '', pautaEstado(row, phase)]
  }
  // Los cocientes, solo si la línea los dice (V6): misma función que la línea.
  const q = pastEditionQuotients(e, row)
  const k = q.kind === 'cocientes' ? q.kpis : null
  return [
    ...base,
    csvUsd(spend),
    messages,
    k?.costPerMessageUsd.ok ? csvUsd(k.costPerMessageUsd.value) : '',
    k?.closingRate.ok ? csvPercent(k.closingRate.value) : '',
    k?.costPerReservationUsd.ok ? csvUsd(k.costPerReservationUsd.value) : '',
    pautaEstado(row, phase),
  ]
}

/**
 * La planilla del cuadro «Conversión». Mismo orden que la tira (V1: las vacías
 * al final, como filas), mismas columnas de pauta que su segunda línea (V2,
 * V3, V6) y abajo lo que dice su encabezado: el total con mensajes cargados (V4),
 * la mejor fecha y el promedio. Al final, la nota de los grupos privados (V5).
 */
export function eventConversionToCsv(report: ReportInput, marketing: MarketingInput): string {
  const { rowOf, listed, collapsed, withAds } = split(report, marketing)
  const rows: string[][] = [...listed, ...collapsed].map((e) =>
    conversionCsvRow(e, report, rowOf(e), withAds),
  )

  const width = CONVERSION_EXPORT_HEADERS.length
  const at = (cells: Partial<Record<string, string>>, label: string) =>
    CONVERSION_EXPORT_HEADERS.map((h, i) => (i === 0 ? label : (cells[h] ?? '')))

  if (withAds) {
    const items = poolItems(report, rowOf)
    const { Q } = poolMarketing(items)
    // El mismo corte que `pooledStripSummary`: con una sola fecha no hay total.
    if (Q.dates >= 2) {
      const pending = items.filter((i) => isPendingMarketing(i.row, i.phase)).length
      rows.push(
        at(
          {
            Reservas: String(Q.reservations),
            'Pauta USD': csvUsd(Q.spendUsd),
            Mensajes: String(Q.messages),
            'Costo por mensaje USD': Q.costPerMessageUsd.ok
              ? csvUsd(Q.costPerMessageUsd.value)
              : '',
            '% de cierre': Q.closingRate.ok ? csvPercent(Q.closingRate.value) : '',
            'Costo por reserva USD': Q.costPerReservationUsd.ok
              ? csvUsd(Q.costPerReservationUsd.value)
              : '',
            'Estado de la pauta': pending > 0 ? `falta cargar ${pending}` : '',
          },
          `Total con mensajes cargados (${Q.dates} fechas)`,
        ),
      )
    }
  }
  if (report.best) {
    rows.push(at({ Personas: String(report.best.guests) }, `La mejor (${report.best.date})`))
  }
  if (report.reference) {
    rows.push(
      at(
        { Personas: String(report.reference.avgGuests) },
        `Promedio de las ${report.reference.editions} fechas que ya pasaron con reservas`,
      ),
    )
  }
  const note = privateEditionsNote(report.privateEditions)
  if (note) {
    rows.push(Array.from({ length: width }, () => ''))
    rows.push([csvFormulaGuard(note), ...Array.from({ length: width - 1 }, () => '')])
  }
  return rowsToCsv([...CONVERSION_EXPORT_HEADERS], rows, { separator: ';', bom: true })
}
