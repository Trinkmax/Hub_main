/**
 * El consolidado de «Por evento»: la cuenta de cada fecha de UN evento, una
 * fila por fecha, para decir de un vistazo en cuáles dejó plata y en cuáles no.
 *
 * Pedido del dueño (30/09/2026): «un consolidado al lado [de la tira] como para
 * poder comparar todo de forma más rápida y decir, por ejemplo, en este 2x1 no
 * nos fue tan bien, este sí, en este sí, en este no». Boceto que eligió:
 * Fecha | Pers | Pauta | $/pers | Bebida/p | Resultado (con ✓ / ✗).
 *
 * Reglas que fija este archivo (además de las de `event-marketing.ts`):
 *
 * C1. **El veredicto es el de la ficha.** ✓ si el resultado de la noche
 *     (`computeMarketingKpis(...).nightResultArs`, el MISMO número que «La
 *     cuenta de la noche») se LEE positivo; ✗ si se lee negativo; «$ 0» sin
 *     marca si redondea a cero (`resultSign`): un −0,4 no es una pérdida.
 * C2. **Sin la cuenta cerrada no se juzga, y se dice por qué**: sin cargar, sin
 *     gente, o TODO lo que falta a la vez (ingreso, costo, bebida, dólar). Hoy
 *     y lo que viene no son filas: van a una nota.
 * C3. **La bebida vacía no bloquea**: con sus dos números vacíos la cuenta va
 *     sin bebida (regla 15) y una nota lo dice. Con uno solo cargado, la cuenta
 *     no cierra y la fecha no se juzga (lo decide el motor, no este archivo).
 * C4. **Orden de la tira** (de la más nueva a la más vieja), sin ranking: la
 *     barra con signo deja ver la mejor y la peor sin reordenar.
 * C5. **Filas**: las fechas que ya pasaron, desde la PRIMERA con fila de pauta,
 *     con reservas o con pauta gastada (el criterio con que la tira colapsa).
 *     Las anteriores con reservas van a una nota; las vacías no aparecen.
 * C6. **Totales = cociente de sumas sobre las fechas juzgadas**, con 2 o más.
 *     $/pers y Bebida/p del total solo si TODAS las juzgadas lo tienen (y
 *     ninguna usa la caja). Las noches sin pauta SÍ suman: es el total del
 *     evento, no de la pauta (la pestaña «Pauta» no las suma, regla 14).
 * C7. **Negativo en palabras** («$ X abajo»), nunca «-$». En la planilla, con signo.
 * C8. **Pantalla = CSV**: el cuadro se llama «Rentabilidad» (02/10, C4 de los
 *     socios) y su planilla (`eventProfitabilityToCsv`) es EXACTAMENTE lo que
 *     muestra: sus filas, su total y sus notas, con el desglose de cada fecha
 *     en columnas para rehacer la cuenta en Excel.
 *
 * Puro: sin DB ni React ni `Intl` (se dibuja en el server y en el cliente). De
 * `events-report.ts` se importan SOLO tipos.
 */

import { rowsToCsv } from '@/lib/stats/csv'
import { EVENT_CUADROS } from './event-cuadros'
import {
  computeMarketingKpis,
  csvFormulaGuard,
  decimalEsAr,
  type EventMarketingRow,
  formatArs,
  formatArsUnit,
  formatCount,
  formatDayMonth,
  formatUsd,
  hasDrinks,
  hasNightAccount,
  MARKETING_EXPORT_HEADERS,
  marketingCsvCells,
  NIGHT_RESULT_DISCLAIMER,
  type NightInput,
  type NightMathStep,
  nightGap,
  nightGapPhrase,
  nightResultReport,
  resultSign,
  shownPesos,
  weekdayDayMonth,
} from './event-marketing'
import type { EditionSummary } from './events-report'

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Lo que el consolidado necesita de cada edición. `EditionSummary` lo cumple tal cual. */
export type ConsolidatedEditionInput = Pick<
  EditionSummary,
  | 'key'
  | 'eventId'
  | 'date'
  | 'reservations'
  | 'guests'
  | 'billableGuests'
  | 'attendedGuests'
  | 'isFuture'
  | 'isTonight'
>

/** El veredicto de UNA fecha (D2). Los tres juzgados llevan el resultado a precisión completa. */
export type EditionVerdict =
  | { kind: 'dejo'; resultArs: number }
  | { kind: 'abajo'; resultArs: number }
  | { kind: 'cero'; resultArs: number }
  | {
      kind: 'sin-juzgar'
      why: 'es-hoy' | 'todavia-no-paso' | 'vacia' | 'sin-cargar' | 'sin-gente'
    }
  | { kind: 'sin-juzgar'; why: 'faltan-datos'; inputs: readonly NightInput[]; dollar: boolean }

export type JudgedVerdict = Extract<EditionVerdict, { resultArs: number }>

/**
 * Una celda: `text` a la vista; `srText` (si hay) es lo que oye el lector y va
 * en `title`. `srText` REEMPLAZA a `text` (lo visible queda `aria-hidden`): si
 * la celda muestra un monto, el `srText` lo tiene que decir.
 */
export type ConsolidatedCell = {
  text: string
  srText: string | null
  tone: 'default' | 'muted' | 'warning'
}

/** La celda «Resultado». */
export type ConsolidatedResult = {
  /** `$ 355.979` · `$ 136.488` (con `suffix`) · `$ 0` · el motivo corto (`faltan ingreso y costo`). */
  text: string
  /** `'abajo'` solo en negativo: la palabra va pegada al monto, nunca un `-$`. */
  suffix: 'abajo' | null
  tone: 'default' | 'muted' | 'warning'
  /** ✓ (`dejo`) · ✗ (`abajo`) · nada (en cero, sin juzgar, y el total). */
  mark: 'dejo' | 'abajo' | null
  /** La frase entera: sr-only y `title`. `La noche dejó $ 355.979.` */
  sr: string
}

export type ConsolidatedRow = {
  /** `scheduled_event_id`. */
  eventId: string
  date: string
  /** `15/09`: la tabla. */
  dayMonth: string
  /** `mar 15/09`: la tarjeta. */
  weekdayLabel: string
  verdict: EditionVerdict['kind']
  cells: {
    /** La gente de la cuenta (`billableGuests`): la misma que multiplica la plata. */
    guests: ConsolidatedCell
    spend: ConsolidatedCell
    perGuest: ConsolidatedCell
    drinkPerGuest: ConsolidatedCell
  }
  result: ConsolidatedResult
  /** Tarjeta, renglón 2: `65 personas · pauta US$ 105,82 · $ 14.500 por persona · bebida sin cargar`. */
  cardLine: string
  /** Tarjeta, renglón 3, y el desglose: por qué no se juzga. `null` si se juzgó. */
  reasonText: string | null
  /** El desglose: la cuenta de la ficha tal cual (`nightResultReport`). */
  detail: {
    steps: NightMathStep[]
    result: NightMathStep | null
    lines: string[]
    /** `Se carga desde la ficha de esa noche.` cuando cargando algo se puede juzgar. */
    howToFix: string | null
  }
  /** Fracciones (0..1) de la pista, con un solo eje para todas las filas. `null` = sin barra. */
  bar: { left: number; width: number; tone: 'positive' | 'negative' } | null
  /** `15/09: ver la cuenta` (empieza con lo que se ve). */
  toggleLabel: string
  /** `Ver la noche del 15/09`. */
  linkLabel: string
}

export type ConsolidatedTotal = {
  /** Debajo de «Total» en la tabla: `3 fechas`. */
  base: string
  /** El `<th>` para el lector: `Total de las 3 fechas con la cuenta cerrada`. */
  srLabel: string
  cells: {
    guests: ConsolidatedCell
    spend: ConsolidatedCell
    perGuest: ConsolidatedCell
    drinkPerGuest: ConsolidatedCell
  }
  result: ConsolidatedResult
  /** Debajo del total: `$ 2.724 por persona` · `$ 1.200 abajo por persona`. `null` en cero. */
  perPersonText: string | null
  /** Tarjeta: `En total dejó $ 414.006 en las 3 fechas con la cuenta cerrada ($ 2.724 por persona).` */
  sentence: string
  /** Tarjeta: `152 personas · pauta US$ 301,48 · $ 12.230 por persona`. */
  cardLine: string
  negative: boolean
  /**
   * La fila de total de la planilla del evento: celdas por nombre de columna.
   * Cierra: Ingreso − Costo = Margen y Margen − Pauta = Resultado.
   */
  csv: { label: string; verdict: string; cells: Readonly<Record<string, string>> }
}

export type EventConsolidated = {
  title: string
  /** Debajo del título: qué responde el cuadro. */
  subtitle: string
  /** `<caption>` sr-only y `aria-label` de la lista. */
  caption: string
  /** `Dejó plata en ` + **`2 de 3`** + ` fechas con la cuenta cerrada.` */
  headline: { before: string; value: string; after: string }
  /** `2 fechas sin juzgar.` (en gris, al lado). `null` sin juzgadas o sin pendientes. */
  unjudgedNote: string | null
  counts: {
    rows: number
    judged: number
    positive: number
    negative: number
    even: number
    unjudged: number
  }
  rows: ConsolidatedRow[]
  /** El cero de las barras (0..1). `null` = sin barras (menos de 2 juzgadas, o todas en cero). */
  axis: number | null
  /** Solo con 2 fechas juzgadas o más (con una, el total es esa fecha con otro nombre). */
  total: ConsolidatedTotal | null
  notes: string[]
}

// ─── Palabras ────────────────────────────────────────────────────────────────

/** El cuadro de la izquierda de «Por evento» (02/10: «con el cuadro de la izquierda, rentabilidad»). */
export const CONSOLIDATED_TITLE = EVENT_CUADROS.rentabilidad.title

/** El encabezado de la tabla: lo que se ve es el boceto del dueño; `srLabel`, lo que oye el lector. */
export const CONSOLIDATED_COLUMNS = [
  { key: 'date', label: 'Fecha', srLabel: null },
  { key: 'guests', label: 'Pers', srLabel: 'Personas de la cuenta' },
  { key: 'spend', label: 'Pauta', srLabel: 'Pauta en Meta' },
  { key: 'perGuest', label: '$/pers', srLabel: 'Ingreso por persona' },
  { key: 'drinkPerGuest', label: 'Bebida/p', srLabel: 'Ingreso de bebida por persona' },
  { key: 'result', label: 'Resultado', srLabel: 'Resultado de la noche' },
] as const

export const CONSOLIDATED_BASIS_NOTE =
  'Personas: la gente de la cuenta, contada al cerrar cada mesa —lo reservado en las que quedaron sin cerrar—, así que puede no coincidir con «Conversión».'
export const CONSOLIDATED_CASH_NOTE =
  'Donde dice «caja», el ingreso es la facturación real de la caja, que ya trae la bebida.'
export const CONSOLIDATED_NO_DRINKS_NOTE =
  'La bebida no está cargada en ninguna fecha: el resultado sale solo del ingreso y el costo por persona.'

const HOW_TO_FIX = 'Se carga desde la ficha de esa noche.'
// Las mismas palabras que la caja «La cuenta de la noche» sin cargar (regla 13).
const SIN_CARGAR_CORE = 'faltan la pauta, el ingreso y el costo por persona'
const DASH = '—'

const SHORT: Readonly<Record<NightInput, string>> = {
  revenuePerGuest: 'ingreso',
  costPerGuest: 'costo',
  drinkRevenuePerGuest: 'ingreso de bebida',
  drinkCostPerGuest: 'costo de bebida',
}

function personas(n: number): string {
  return n === 1 ? '1 persona' : `${formatCount(n)} personas`
}

function fechas(n: number): string {
  return n === 1 ? '1 fecha' : `${formatCount(n)} fechas`
}

/** `a` · `a y b` · `a, b y c`. */
function listY(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

function cell(
  text: string,
  tone: ConsolidatedCell['tone'] = 'default',
  srText: string | null = null,
): ConsolidatedCell {
  return { text, tone, srText }
}

/** La celda: `falta el costo` · `faltan ingreso y costo` · `faltan ingreso, costo y dólar`. */
export function missingShort(inputs: readonly NightInput[], dollar: boolean): string {
  const words = [...inputs.map((i) => SHORT[i]), ...(dollar ? ['dólar'] : [])]
  const first = words[0]
  if (first === undefined) return 'falta cargar la cuenta'
  if (words.length === 1) return `falta el ${first}`
  return `faltan ${listY(words)}`
}

// ─── El veredicto de UNA fecha (D2) ──────────────────────────────────────────

/**
 * ✓ / ✗ / en cero / sin juzgar, con el mismo motor que la ficha. Lo usan el
 * consolidado y la columna «¿Dejó plata?» de la planilla del evento, así que
 * vale para CUALQUIER edición, esté o no en la tabla.
 */
export function editionVerdict(
  edition: ConsolidatedEditionInput,
  row: EventMarketingRow | null,
): EditionVerdict {
  if (edition.isTonight) return { kind: 'sin-juzgar', why: 'es-hoy' }
  if (edition.isFuture) return { kind: 'sin-juzgar', why: 'todavia-no-paso' }
  // Sin reservas NI pauta gastada: la tira la colapsa al pie; no hay nada que juzgar.
  if (edition.reservations === 0 && !(row !== null && row.adSpendUsdCents > 0)) {
    return { kind: 'sin-juzgar', why: 'vacia' }
  }
  // Sin gente no hay cuenta aunque se cargue toda la plata (`cero-personas` en
  // la ficha): va antes que «sin cargar», para no pedir lo que no sirve.
  if (edition.billableGuests <= 0) return { kind: 'sin-juzgar', why: 'sin-gente' }
  if (row === null) return { kind: 'sin-juzgar', why: 'sin-cargar' }
  const result = computeMarketingKpis(edition, row).nightResultArs
  if (result.ok) {
    const sign = resultSign(result.value)
    if (sign === 'positive') return { kind: 'dejo', resultArs: result.value }
    if (sign === 'negative') return { kind: 'abajo', resultArs: result.value }
    return { kind: 'cero', resultArs: result.value }
  }
  const gap = nightGap(edition, row)
  // Con gente y sin resultado, el hueco siempre es de datos; la rama es para TS.
  if (gap === null || gap.kind === 'sin-gente') return { kind: 'sin-juzgar', why: 'sin-gente' }
  return { kind: 'sin-juzgar', why: 'faltan-datos', inputs: gap.inputs, dollar: gap.dollar }
}

/** Motivo corto (lo que entra en la celda) de una fecha sin juzgar. */
function shortReason(
  v: Extract<EditionVerdict, { kind: 'sin-juzgar' }>,
  reservations: number,
): string {
  switch (v.why) {
    case 'es-hoy':
      return 'es hoy'
    case 'todavia-no-paso':
      return 'todavía no pasó'
    case 'vacia':
      return 'sin reservas ni pauta'
    case 'sin-cargar':
      return 'sin cargar'
    case 'sin-gente':
      return reservations > 0 ? 'sin gente' : 'ninguna reserva'
    case 'faltan-datos':
      return missingShort(v.inputs, v.dollar)
  }
}

/** Motivo largo, en minúscula: `faltan el ingreso y el costo por persona, y el dólar del día`. */
function longReason(
  v: Extract<EditionVerdict, { kind: 'sin-juzgar' }>,
  reservations: number,
): string {
  switch (v.why) {
    case 'es-hoy':
      return 'es hoy'
    case 'todavia-no-paso':
      return 'todavía no pasó'
    case 'vacia':
      return 'no hubo reservas ni pauta'
    case 'sin-cargar':
      return SIN_CARGAR_CORE
    case 'sin-gente':
      return nightGapPhrase({ kind: 'sin-gente' }, reservations)
    case 'faltan-datos':
      return nightGapPhrase(
        { kind: 'faltan-datos', inputs: [...v.inputs], dollar: v.dollar },
        reservations,
      )
  }
}

/**
 * La celda «¿Dejó plata?» de la planilla: `sí` · `no` · `quedó en cero` ·
 * `sin juzgar: faltan ingreso, costo y dólar`. El motivo es el corto, el mismo
 * que se ve en la celda de la pantalla.
 */
export function editionVerdictCsv(v: EditionVerdict, reservations: number): string {
  if (v.kind === 'dejo') return 'sí'
  if (v.kind === 'abajo') return 'no'
  if (v.kind === 'cero') return 'quedó en cero'
  return `sin juzgar: ${shortReason(v, reservations)}`
}

function judgedResult(v: JudgedVerdict): ConsolidatedResult {
  if (v.kind === 'dejo') {
    const amount = formatArs(v.resultArs)
    return {
      text: amount,
      suffix: null,
      tone: 'default',
      mark: 'dejo',
      sr: `La noche dejó ${amount}.`,
    }
  }
  if (v.kind === 'abajo') {
    const amount = formatArs(Math.abs(v.resultArs))
    return {
      text: amount,
      suffix: 'abajo',
      tone: 'warning',
      mark: 'abajo',
      sr: `La noche quedó ${amount} abajo.`,
    }
  }
  return {
    text: formatArs(0),
    suffix: null,
    tone: 'muted',
    mark: null,
    sr: 'La noche quedó en cero.',
  }
}

// ─── El consolidado ──────────────────────────────────────────────────────────

type Judged = { e: ConsolidatedEditionInput; row: EventMarketingRow; v: JudgedVerdict }

/**
 * Todo lo que dibuja el consolidado, ya contado y redactado. `null` si no hay
 * ninguna fila: el evento no tiene pauta cargada en ninguna fecha, o solo en
 * fechas que todavía no pasaron. Sin consolidado, la tira va a lo ancho.
 */
export function buildEventConsolidated(input: {
  templateName: string
  /** Como vienen de `aggregateTemplateReport`: de la más nueva a la más vieja. */
  editions: ReadonlyArray<ConsolidatedEditionInput>
  /** Pauta por `scheduled_event_id`. Sin fila = «Sin cargar». */
  marketing: Readonly<Record<string, EventMarketingRow>>
}): EventConsolidated | null {
  const rowOf = (e: ConsolidatedEditionInput) => input.marketing[e.eventId ?? e.key] ?? null
  const loaded = input.editions.filter((e) => rowOf(e) !== null)
  const first = loaded.reduce<ConsolidatedEditionInput | null>(
    (a, b) => (a === null || b.date < a.date ? b : a),
    null,
  )
  if (first === null) return null

  const past = (e: ConsolidatedEditionInput) => !e.isFuture && !e.isTonight
  // El criterio con que la tira colapsa al pie (editions-strip.tsx, `listables`).
  const listable = (e: ConsolidatedEditionInput) =>
    e.reservations > 0 || (rowOf(e)?.adSpendUsdCents ?? 0) > 0

  const listed = input.editions.filter((e) => past(e) && listable(e) && e.date >= first.date)
  if (listed.length === 0) return null
  const earlier = input.editions.filter((e) => past(e) && e.reservations > 0 && e.date < first.date)
  const tonight = input.editions.some((e) => e.isTonight)
  const upcoming = input.editions.filter((e) => e.isFuture).length

  const verdicts = listed.map((e) => ({ e, row: rowOf(e), v: editionVerdict(e, rowOf(e)) }))
  const judged: Judged[] = []
  for (const x of verdicts) {
    if (x.v.kind !== 'sin-juzgar' && x.row !== null) judged.push({ e: x.e, row: x.row, v: x.v })
  }
  const n = judged.length
  const positive = judged.filter((x) => x.v.kind === 'dejo').length
  const negative = judged.filter((x) => x.v.kind === 'abajo').length
  const even = n - positive - negative
  const unjudged = verdicts.length - n

  // Un solo eje para todas las barras; «en cero» no lo mueve.
  const maxPos = Math.max(0, ...judged.filter((x) => x.v.kind === 'dejo').map((x) => x.v.resultArs))
  const maxNeg = Math.max(
    0,
    ...judged.filter((x) => x.v.kind === 'abajo').map((x) => -x.v.resultArs),
  )
  const span = maxPos + maxNeg
  const axis = n >= 2 && span > 0 ? maxNeg / span : null

  const rows = verdicts.map(({ e, row, v }): ConsolidatedRow => {
    const dm = formatDayMonth(e.date)
    const cash = row !== null && row.revenueArsCents !== null
    const drink = row?.drinkRevenuePerGuestArsCents ?? null

    const spend =
      row === null
        ? cell(DASH, 'muted', 'pauta sin cargar')
        : row.adSpendUsdCents <= 0
          ? cell('sin pauta', 'muted')
          : cell(formatUsd(row.adSpendUsdCents / 100))
    const perGuest =
      row === null
        ? cell(DASH, 'muted', 'sin cargar')
        : cash
          ? cell('caja', 'muted', 'el ingreso es la facturación real de la caja')
          : row.revenuePerGuestArsCents !== null
            ? cell(formatArsUnit(row.revenuePerGuestArsCents / 100))
            : cell(DASH, 'muted', 'ingreso por persona sin cargar')
    const drinkPerGuest =
      row === null
        ? cell(DASH, 'muted', 'sin cargar')
        : cash
          ? cell('caja', 'muted', 'la bebida está en la facturación de la caja')
          : drink === 0
            ? cell('incluida', 'default', 'bebida incluida')
            : drink !== null
              ? cell(formatArsUnit(drink / 100))
              : cell(
                  DASH,
                  'muted',
                  hasDrinks(row) ? 'ingreso de bebida sin cargar' : 'bebida sin cargar',
                )

    let result: ConsolidatedResult
    let reasonText: string | null = null
    let howToFix: string | null = null
    if (v.kind === 'sin-juzgar') {
      const long = longReason(v, e.reservations)
      result = {
        text: shortReason(v, e.reservations),
        suffix: null,
        tone: 'muted',
        mark: null,
        sr: `Sin juzgar: ${long}.`,
      }
      if (v.why === 'sin-gente') {
        reasonText =
          e.reservations > 0
            ? 'Se contaron 0 personas al cerrar las mesas: no hay gente con la que hacer la cuenta.'
            : 'No quedó ninguna reserva en pie: no hay gente con la que hacer la cuenta.'
      } else {
        reasonText = `Para juzgarla ${long}.`
        howToFix = HOW_TO_FIX
      }
    } else {
      result = judgedResult(v)
    }

    const parts = [
      e.billableGuests > 0
        ? personas(e.billableGuests)
        : e.reservations > 0
          ? '0 personas'
          : 'ninguna reserva en pie',
    ]
    parts.push(
      row === null
        ? 'pauta sin cargar'
        : row.adSpendUsdCents <= 0
          ? 'sin pauta'
          : `pauta ${formatUsd(row.adSpendUsdCents / 100)}`,
    )
    if (row !== null && hasNightAccount(row)) {
      if (cash) parts.push(`ingreso de la caja ${formatArs((row.revenueArsCents ?? 0) / 100)}`)
      else {
        if (row.revenuePerGuestArsCents !== null)
          parts.push(`${formatArsUnit(row.revenuePerGuestArsCents / 100)} por persona`)
        if (drink === 0) parts.push('bebida incluida')
        else if (drink !== null) parts.push(`bebida ${formatArsUnit(drink / 100)}`)
        else if (!hasDrinks(row)) parts.push('bebida sin cargar')
      }
    }

    const night = row === null ? null : nightResultReport(e, row, 'past')
    let bar: ConsolidatedRow['bar'] = null
    if (axis !== null && (v.kind === 'dejo' || v.kind === 'abajo')) {
      const w = Math.abs(v.resultArs) / span
      bar =
        v.kind === 'dejo'
          ? { left: axis, width: w, tone: 'positive' }
          : { left: axis - w, width: w, tone: 'negative' }
    }

    return {
      eventId: e.eventId ?? e.key,
      date: e.date,
      dayMonth: dm,
      weekdayLabel: weekdayDayMonth(e.date),
      verdict: v.kind,
      cells: { guests: cell(formatCount(e.billableGuests)), spend, perGuest, drinkPerGuest },
      result,
      cardLine: parts.join(' · '),
      reasonText,
      detail: {
        steps: night?.steps ?? [],
        result: night?.result ?? null,
        lines: night
          ? [night.perGuest, night.perGuestAfterAds, night.basis, night.revenueNote].filter(
              (s): s is string => s !== null,
            )
          : [],
        howToFix,
      },
      bar,
      toggleLabel: `${dm}: ver la cuenta`,
      linkLabel: `Ver la noche del ${dm}`,
    }
  })

  // Titular (D2): cuenta solo las fechas con la cuenta cerrada.
  const after = n === 1 ? ' fecha con la cuenta cerrada.' : ' fechas con la cuenta cerrada.'
  const headline: EventConsolidated['headline'] =
    n === 0
      ? { before: 'Todavía no hay ninguna fecha con la cuenta cerrada.', value: '', after: '' }
      : n === 1
        ? {
            before:
              positive === 1
                ? 'Dejó plata en '
                : negative === 1
                  ? 'Quedó abajo en '
                  : 'Quedó en cero en ',
            value: 'la única',
            after,
          }
        : positive === n
          ? { before: 'Dejó plata en ', value: `las ${formatCount(n)}`, after }
          : negative === n
            ? { before: 'Quedó abajo en ', value: `las ${formatCount(n)}`, after }
            : even === n
              ? { before: 'Quedó en cero en ', value: `las ${formatCount(n)}`, after }
              : positive === 0
                ? { before: 'No dejó plata en ', value: `ninguna de las ${formatCount(n)}`, after }
                : {
                    before: 'Dejó plata en ',
                    value: `${formatCount(positive)} de ${formatCount(n)}`,
                    after,
                  }

  const total = n >= 2 ? buildTotal(judged, positive) : null

  const notes: string[] = []
  if (tonight || upcoming > 0) {
    notes.push(
      tonight && upcoming === 0
        ? 'La de esta noche se juzga cuando pase.'
        : tonight
          ? upcoming === 1
            ? 'La de esta noche y la que viene se juzgan cuando pasen.'
            : `La de esta noche y las ${formatCount(upcoming)} que vienen se juzgan cuando pasen.`
          : upcoming === 1
            ? 'La fecha que viene se juzga cuando pase.'
            : `Las ${formatCount(upcoming)} fechas que vienen se juzgan cuando pasen.`,
    )
  }
  if (earlier.length > 0) {
    const list = earlier.map((e) => formatDayMonth(e.date)).join(' · ')
    notes.push(`Antes del ${formatDayMonth(first.date)} no se cargó la plata: ${list}.`)
  }
  if (verdicts.some(({ e }) => e.billableGuests !== e.guests)) notes.push(CONSOLIDATED_BASIS_NOTE)
  if (verdicts.some(({ row }) => row !== null && row.revenueArsCents !== null)) {
    notes.push(CONSOLIDATED_CASH_NOTE)
  }
  if (n > 0) {
    // Juzgada sin bebida: sus dos números vacíos (con uno solo, el motor no
    // cierra la cuenta y la fecha ni se juzga). Con caja, el ingreso ya la trae.
    const noDrink = judged.filter(({ row }) => row.revenueArsCents === null && !hasDrinks(row))
    // «En ninguna fecha» habla de TODA la tabla, no solo de las juzgadas. Una
    // fecha sin juzgar con algo de la bebida (el 15/09 con el costo de bebida
    // borrado, o una a la que le falta el dólar) la muestra en su fila, y la
    // nota absoluta la contradiría: ahí va la lista de las juzgadas sin bebida.
    const drinkInTable = verdicts.some(({ row }) => row !== null && hasDrinks(row))
    if (noDrink.length === n && !drinkInTable) notes.push(CONSOLIDATED_NO_DRINKS_NOTE)
    else if (noDrink.length > 0) {
      notes.push(
        `Sin la bebida cargada: ${noDrink.map(({ e }) => formatDayMonth(e.date)).join(' · ')}. Ahí el resultado sale solo del ingreso y el costo por persona.`,
      )
    }
    notes.push(NIGHT_RESULT_DISCLAIMER)
  }

  return {
    title: CONSOLIDATED_TITLE,
    subtitle: EVENT_CUADROS.rentabilidad.subtitle,
    caption: `${CONSOLIDATED_TITLE} de ${input.templateName}: la cuenta de cada fecha que ya pasó, de la más nueva a la más vieja.`,
    headline,
    unjudgedNote: n === 0 || unjudged === 0 ? null : `${fechas(unjudged)} sin juzgar.`,
    counts: { rows: rows.length, judged: n, positive, negative, even, unjudged },
    rows,
    axis,
    total,
    notes,
  }
}

/** El total: sumas sobre las fechas juzgadas; los por persona, cociente de esas sumas (C6). */
function buildTotal(judged: readonly Judged[], positive: number): ConsolidatedTotal {
  const n = judged.length
  let guests = 0
  let spendCents = 0
  let revenue = 0
  let margin = 0
  let result = 0
  let food = 0
  let drink = 0
  let allFood = true
  let allDrink = true
  let allDrinkIncluded = true
  let anyDrink = false
  let anyCash = false
  let allOrganic = true
  for (const { e, row } of judged) {
    const k = computeMarketingKpis(e, row)
    guests += e.billableGuests
    spendCents += row.adSpendUsdCents
    if (row.adSpendUsdCents > 0) allOrganic = false
    // Las juzgadas tienen la cuenta entera: si no, no tendrían resultado. El
    // costo y la pauta no se suman: la planilla los saca por diferencia (abajo).
    if (k.revenueArs.ok) revenue += k.revenueArs.value
    if (k.grossMarginArs.ok) margin += k.grossMarginArs.value
    if (k.nightResultArs.ok) result += k.nightResultArs.value
    const cash = row.revenueArsCents !== null
    if (cash) anyCash = true
    if (cash || row.revenuePerGuestArsCents === null) allFood = false
    else food += e.billableGuests * (row.revenuePerGuestArsCents / 100)
    const d = row.drinkRevenuePerGuestArsCents
    if (cash || d === null) allDrink = false
    else {
      anyDrink = true
      drink += e.billableGuests * (d / 100)
      if (d !== 0) allDrinkIncluded = false
    }
  }

  const sign = resultSign(result)
  const amount = formatArs(Math.abs(result))
  const perPerson = result / guests
  const perSign = resultSign(perPerson)
  const base = `en las ${formatCount(n)} fechas con la cuenta cerrada`
  const perPersonText =
    perSign === 'positive'
      ? `${formatArs(perPerson)} por persona`
      : perSign === 'negative'
        ? `${formatArs(Math.abs(perPerson))} abajo por persona`
        : null
  const sentence =
    sign === 'positive'
      ? `En total dejó ${amount} ${base}${perPersonText ? ` (${perPersonText})` : ''}.`
      : sign === 'negative'
        ? `En total quedó ${amount} abajo ${base}${perPersonText ? ` (${perPersonText})` : ''}.`
        : `En total quedó en cero ${base}.`
  const foodText = allFood ? formatArs(food / guests) : null
  const drinkText = allDrink ? (allDrinkIncluded ? 'incluida' : formatArs(drink / guests)) : null
  const noAverage = 'sin promedio: en alguna fecha manda la facturación de la caja'
  const csvArs = (v: number) => decimalEsAr(v, 0, false)
  // La fila de la planilla tiene que cerrar con el Resultado de la pantalla,
  // redondeado UNA vez. Redondeando cada suma por su lado no cierra: en Noche
  // Astral la pauta es 814.068,5 y el resultado 636.131,5, los dos suben medio
  // peso y Margen − Pauta da un peso menos que el Resultado. Por eso se
  // redondean las sumas parciales de la cuenta (ingreso, margen y resultado) y
  // el costo y la pauta salen por diferencia: cada uno queda a menos de un peso
  // del suyo, y sin pauta la pauta da 0 justo (margen y resultado son la misma
  // suma). Con el margen armado como «ingreso − costo» ya redondeados, un
  // cubierto o un costo con centavos dejaba el peso en la pauta aunque no la
  // hubiera (Pauta USD 0,00 al lado de Pauta ARS 1).
  const revenueRead = shownPesos(revenue)
  const marginRead = shownPesos(margin)
  const resultRead = shownPesos(result)

  const cardParts = [
    personas(guests),
    allOrganic ? 'sin pauta' : `pauta ${formatUsd(spendCents / 100)}`,
  ]
  if (foodText) cardParts.push(`${foodText} por persona`)
  if (drinkText)
    cardParts.push(drinkText === 'incluida' ? 'bebida incluida' : `bebida ${drinkText}`)

  const resultCell: ConsolidatedResult =
    sign === 'negative'
      ? {
          text: amount,
          suffix: 'abajo',
          tone: 'warning',
          mark: null,
          sr: `En total quedó ${amount} abajo.`,
        }
      : sign === 'zero'
        ? {
            text: formatArs(0),
            suffix: null,
            tone: 'muted',
            mark: null,
            sr: 'En total quedó en cero.',
          }
        : {
            text: amount,
            suffix: null,
            tone: 'default',
            mark: null,
            sr: `En total dejó ${amount}.`,
          }

  // El `srText` reemplaza al monto a la vista (ver `ConsolidatedCell`): va
  // adelante, o el lector oye «promedio de …» y nunca el número.
  const average = (text: string) =>
    `${text}, promedio de las ${formatCount(n)} fechas, sobre ${personas(guests)}`

  return {
    base: fechas(n),
    srLabel: `Total de las ${formatCount(n)} fechas con la cuenta cerrada`,
    cells: {
      guests: cell(formatCount(guests)),
      spend: allOrganic ? cell('sin pauta', 'muted') : cell(formatUsd(spendCents / 100)),
      perGuest: foodText
        ? cell(foodText, 'default', average(foodText))
        : cell(DASH, 'muted', noAverage),
      drinkPerGuest: drinkText
        ? cell(
            drinkText,
            'default',
            drinkText === 'incluida'
              ? `bebida incluida en las ${formatCount(n)} fechas`
              : average(drinkText),
          )
        : cell(
            DASH,
            'muted',
            anyCash
              ? noAverage
              : anyDrink
                ? 'sin promedio: no todas las fechas tienen la bebida cargada'
                : 'ninguna fecha tiene la bebida cargada',
          ),
    },
    result: resultCell,
    perPersonText,
    sentence,
    cardLine: cardParts.join(' · '),
    negative: sign === 'negative',
    csv: {
      label: `Total con la cuenta cerrada (${fechas(n)})`,
      verdict: `${formatCount(positive)} de ${formatCount(n)}`,
      // Por nombre de columna de `PROFITABILITY_EXPORT_HEADERS`. Cierra:
      // Ingreso − Costo = Margen y Margen − Pauta ARS = Resultado.
      cells: {
        'Personas de la cuenta': String(guests),
        'Ingreso por persona ARS': allFood ? csvArs(food / guests) : '',
        'Ingreso de bebida por persona ARS': allDrink ? csvArs(drink / guests) : '',
        'Ingreso ARS': csvArs(revenueRead),
        'Costo ARS': csvArs(revenueRead - marginRead),
        'Margen ARS': csvArs(marginRead),
        'Pauta USD': decimalEsAr(spendCents / 100, 2, false),
        'Pauta ARS': csvArs(marginRead - resultRead),
        'Resultado ARS': csvArs(resultRead),
      },
    },
  }
}

// ─── La planilla del cuadro «Rentabilidad» (02/10) ──────────────────────────

/**
 * Las columnas, en el orden de la cuenta (personas → precios → ingreso, costo,
 * margen → pauta → resultado → veredicto): la fila se rehace de izquierda a
 * derecha en Excel. Lo que el cuadro muestra (Fecha, Pers, Pauta, $/pers,
 * Bebida/p, Resultado y ✓/✗) está todo; el resto es el desglose que se abre al
 * tocar la fecha.
 */
export const PROFITABILITY_EXPORT_HEADERS: readonly string[] = [
  'Fecha',
  'Personas de la cuenta',
  'Ingreso por persona ARS',
  'Ingreso de bebida por persona ARS',
  'Costo por persona ARS',
  'Costo de bebida por persona ARS',
  'Ingreso ARS',
  'Costo ARS',
  'Margen ARS',
  'Pauta USD',
  'Dólar',
  'Pauta ARS',
  'Resultado ARS',
  '¿Dejó plata?',
]

const CAJA = 'caja'

/** Una columna de la cuenta de `marketingCsvCells`, por nombre: mismo redondeo que el día y el mes. */
function nightCell(cells: readonly string[], header: string): string {
  return cells[MARKETING_EXPORT_HEADERS.indexOf(header)] ?? ''
}

function profitabilityRow(e: ConsolidatedEditionInput, row: EventMarketingRow | null): string[] {
  const v = editionVerdict(e, row)
  const verdict = editionVerdictCsv(v, e.reservations)
  if (row === null) {
    return [e.date, String(e.billableGuests), '', '', '', '', '', '', '', '', '', '', '', verdict]
  }
  const cells = marketingCsvCells(e, row)
  // Como el cuadro: con la facturación real de la caja, los dos ingresos por
  // persona dicen «caja» (el precio tipeado no hizo la cuenta).
  const cash = row.revenueArsCents !== null
  return [
    e.date,
    String(e.billableGuests),
    cash ? CAJA : nightCell(cells, 'Ingreso por persona ARS'),
    cash ? CAJA : nightCell(cells, 'Ingreso de bebida por persona ARS'),
    nightCell(cells, 'Costo por persona ARS'),
    nightCell(cells, 'Costo de bebida por persona ARS'),
    nightCell(cells, 'Ingreso ARS'),
    nightCell(cells, 'Costo ARS'),
    nightCell(cells, 'Margen ARS'),
    nightCell(cells, 'Pauta USD'),
    nightCell(cells, 'Dólar'),
    nightCell(cells, 'Pauta ARS'),
    nightCell(cells, 'Resultado ARS'),
    verdict,
  ]
}

/**
 * La planilla del cuadro «Rentabilidad»: EXACTAMENTE sus filas (las fechas que
 * ya pasaron, desde la primera con la plata cargada; de la más nueva a la más
 * vieja), su fila de total (solo si el cuadro la muestra: 2 fechas juzgadas o
 * más) y sus notas al pie, cada una en su renglón. Pantalla = CSV (C8).
 *
 * El resultado negativo va con signo (Excel lo lee como número); en pantalla,
 * «abajo» (C7). `privateNote` es la nota de los grupos privados del formato,
 * si los tiene.
 */
export function eventProfitabilityToCsv(input: {
  templateName: string
  editions: ReadonlyArray<ConsolidatedEditionInput>
  marketing: Readonly<Record<string, EventMarketingRow>>
  privateNote?: string | null
}): string {
  const width = PROFITABILITY_EXPORT_HEADERS.length
  const note = (text: string) => [
    csvFormulaGuard(text),
    ...Array.from({ length: width - 1 }, () => ''),
  ]
  const data = buildEventConsolidated(input)
  const rows: string[][] = []
  if (data === null) {
    rows.push(note('Todavía no hay ninguna fecha que ya pasó con la plata cargada.'))
  } else {
    const byId = new Map(input.editions.map((e) => [e.eventId ?? e.key, e]))
    for (const r of data.rows) {
      const e = byId.get(r.eventId)
      if (!e) continue
      rows.push(profitabilityRow(e, input.marketing[r.eventId] ?? null))
    }
    if (data.total) {
      const t = data.total.csv
      rows.push(
        PROFITABILITY_EXPORT_HEADERS.map((h, i) =>
          i === 0 ? t.label : h === '¿Dejó plata?' ? t.verdict : (t.cells[h] ?? ''),
        ),
      )
    }
    if (data.notes.length > 0 || input.privateNote) rows.push(note(''))
    for (const n of data.notes) rows.push(note(n))
  }
  if (input.privateNote) rows.push(note(input.privateNote))
  return rowsToCsv([...PROFITABILITY_EXPORT_HEADERS], rows, { separator: ';', bom: true })
}
