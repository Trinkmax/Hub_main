/**
 * "Pauta en Meta": cuánto se gastó en anuncios para una fecha de evento y qué
 * dicen esos números al lado de la gente que entró.
 *
 * Lo carga un dueño a mano, copiando de Ads Manager («Importe gastado»,
 * «Conversaciones con mensajes iniciadas», «Alcance»), una fila por edición
 * (`scheduled_event_marketing`). Este archivo hace TODAS las cuentas y arma
 * TODOS los textos: los componentes solo dibujan lo que sale de acá.
 *
 * Reglas que fija este archivo:
 *
 * 1. **Un solo denominador: el bloque que está en pantalla.** La ficha del día
 *    usa su bloque; la tira de ediciones y la pestaña del mes usan la edición
 *    (agrupada por `scheduled_event_id`). `reservations` son las reservas en
 *    pie y `guests` su gente: los mismos números que los tres grandes. No se
 *    inventa otro conteo para la pauta, o los socios verían dos "11 reservas"
 *    que no coinciden.
 * 2. **Lo que falta no es cero.** Sin fila: «Sin cargar». Gasto 0: «No tuvo
 *    pauta». Gasto > 0 sin mensajes: «Incompleta». Mensajes 0: «No escribió
 *    nadie». Cada uno se dice con sus palabras; ninguno se dibuja como un 0.
 * 3. **El cierre nunca pasa de 100 %.** Si hay más reservas que mensajes, parte
 *    de la gente llegó por otro lado, y eso se dice en palabras.
 * 4. **El cierre es un techo y el costo por reserva es un piso.** Los dos
 *    cuentan todas las reservas en pie, también las que no pasaron por el
 *    anuncio. No hay manera honesta de separarlas (ver regla 10).
 * 5. **Los totales son cociente de sumas sobre el mismo conjunto, con la base
 *    nombrada.** Nunca promedio de cocientes: una fecha con 1 reserva no pesa
 *    lo mismo que una con 10. El resumen de la tira pide 2 fechas o más.
 * 6. **Hoy y las fechas futuras son "Por ahora".** Quedan fuera de los
 *    cocientes agrupados, de las comparaciones y de la lista de pendientes. Su
 *    gasto sí suma en lo invertido del mes, nombrado aparte.
 * 7. **Facturación no es ganancia.** El verbo es «facturó», nunca «volvió» ni
 *    «ganó»: la pauta no causó esa plata y la plata no descuenta costos.
 * 8. **Sin benchmarks ni semáforos.** No hay una base externa honesta. La única
 *    alerta es aritmética: el evento facturó menos de lo que costó la pauta.
 * 9. **Pantalla = CSV.** Mismo redondeo, por el mismo formateador.
 * 10. **Nada de atribución por `origin`.** `salon_reservations.origin` es
 *     `DEFAULT 'whatsapp'`: 11 de 11 en Noche Astral. No separa nada.
 *
 * Sobre el formato: todo se arma A MANO (dígitos, puntos de miles, coma
 * decimal y espacio duro `\u00A0`), sin `Intl.NumberFormat`. Node 25 formatea
 * el porcentaje como `21,6%` y el dólar como `US$ 175,26`, y el ICU del
 * navegador del dueño no tiene por qué coincidir: la misma cuenta renderizada
 * en el server y en el cliente daba strings distintos (hydration mismatch). A
 * mano sale idéntico en cualquier runtime. La fecha de carga es lo único que
 * pasa por `Intl`, y solo por `formatToParts` para sacar los números sueltos.
 *
 * Puro: sin DB ni React. De `events-report.ts` se importan SOLO tipos, porque
 * ese archivo importa las columnas de pauta de acá para sus planillas.
 */

import { rowsToCsv } from '@/lib/stats/csv'
import { SALON_TZ } from './date-presets'
import type { EditionSummary } from './events-report'

// ─── Tipos ─────────────────────────────────────────────────────────────────

export type MarketingPhase = 'past' | 'tonight' | 'future'
export type MarketingStatus = 'sin-cargar' | 'sin-pauta' | 'incompleta' | 'completa'

/** Una fila de `scheduled_event_marketing`, ya en unidades (salvo los centavos, que dicen serlo). */
export type EventMarketingRow = {
  scheduledEventId: string
  /** 0 = "no tuvo pauta" (y entonces todo lo demás es null, lo garantiza la DB). */
  adSpendUsdCents: number
  messages: number | null
  reach: number | null
  revenueArsCents: number | null
  usdArsRate: number | null
  notes: string | null
  updatedAt: string
  /** Ya abreviado con `shortName` ('Nacho B.'). */
  updatedByName: string | null
}

export type KpiReason =
  | 'sin-pauta'
  | 'sin-mensajes'
  | 'cero-mensajes'
  | 'mas-reservas-que-mensajes'
  | 'cero-reservas'
  | 'cero-personas'
  | 'sin-alcance'
  | 'sin-facturacion'

/** Un número que se pudo calcular, o el motivo exacto por el que no. */
export type Kpi = { ok: true; value: number } | { ok: false; reason: KpiReason }

export type MarketingKpis = {
  spendUsd: number
  costPerMessageUsd: Kpi
  closingRate: Kpi
  costPerReservationUsd: Kpi
  costPerGuestUsd: Kpi
  costPerThousandReachedUsd: Kpi
  replyRate: Kpi
  spendArs: Kpi
  revenueUsd: Kpi
  returnPerDollar: Kpi
  adShareOfRevenue: Kpi
  revenuePerGuestArs: Kpi
}

export type MarketingField =
  | 'adSpendUsd'
  | 'messages'
  | 'reach'
  | 'revenueArs'
  | 'usdArsRate'
  | 'notes'

export type MarketingActionState =
  | { ok: true; row: EventMarketingRow | null }
  | {
      ok: false
      code: 'forbidden' | 'invalid' | 'not_found' | 'stale' | 'error'
      message: string
      fieldErrors?: Partial<Record<MarketingField, string>>
    }

/** Lo que hace falta de un bloque para dividir: los mismos números que los tres grandes. */
export type MarketingBlock = { reservations: number; guests: number }

// ─── Formato (a mano; ver el comentario de arriba) ───────────────────────────

const NBSP = '\u00A0'

/**
 * `round(|v| × 10^exp)` como entero, redondeando sobre la representación
 * decimal corta del número y no sobre el binario. Con `Math.round(v * 100)`,
 * 1,005 da 100 (porque 1,005 × 100 = 100,49999…); `Intl` y cualquier persona
 * dicen 1,01. Pasando por el string `'1.005e2'` sale 100,5 → 101, igual que
 * `Intl`. Los números en notación exponencial (< 1e-6 o ≥ 1e21) no tienen ese
 * problema a la escala que usamos y van por la cuenta directa.
 */
function scaledInt(v: number, exp: number): number {
  const abs = Math.abs(v)
  const s = String(abs)
  return s.includes('e') ? Math.round(abs * 10 ** exp) : Math.round(Number(`${s}e${exp}`))
}

/** `1234567` → `'1.234.567'`. es-AR agrupa desde el millar (1.234, no 1234). */
function groupThousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Número con `digits` decimales fijos, coma decimal y puntos de miles opcionales. */
function decimalEsAr(v: number, digits: number, grouping: boolean): string {
  if (!Number.isFinite(v)) return '—'
  const n = scaledInt(v, digits)
  const negative = v < 0 && n > 0
  const fixed = (n / 10 ** digits).toFixed(digits)
  const [int = '0', frac] = fixed.split('.')
  const intPart = grouping ? groupThousands(int) : int
  return `${negative ? '-' : ''}${intPart}${frac ? `,${frac}` : ''}`
}

/** Redondeo a `digits` decimales con la misma regla que el formato. */
function roundTo(v: number, digits: number): number {
  const n = scaledInt(v, digits) / 10 ** digits
  return v < 0 ? -n : n
}

/** `175.26` → `'US$ 175,26'` · `1240.5` → `'US$ 1.240,50'`. */
export function formatUsd(v: number): string {
  return `US$${NBSP}${decimalEsAr(v, 2, true)}`
}

/**
 * Pesos enteros: `2480000` → `'$ 2.480.000'`. Da exactamente lo mismo que
 * `ARSFormat(cents)` de `lib/salon/format.ts` (está testeado), pero recibe
 * PESOS —acá las cuentas ya están en unidades— y no depende del ICU.
 */
export function formatArs(pesos: number): string {
  return `$${NBSP}${decimalEsAr(pesos, 0, true)}`
}

/** El dólar del día: entero si es redondo, dos decimales si los tiene. `$ 1.450` · `$ 1.450,50`. */
export function formatPesosRate(v: number): string {
  return `$${NBSP}${rateDigits(v, true)}`
}

function rateDigits(v: number, grouping: boolean): string {
  const r = roundTo(v, 2)
  return decimalEsAr(r, Number.isInteger(r) ? 0 : 2, grouping)
}

/**
 * Un cociente como porcentaje con UN decimal: `11/51` → `'21,6 %'`.
 *
 * El dueño escribió 21,56 %; la pantalla dice 21,6 %. Mismo precedente que el
 * 57/22 contra 53/21 de la documentación: no es un error, es la precisión que
 * se lee. Cero exacto es `0 %` (sin decimal: es un cero de verdad) y algo
 * mayor que cero que redondea a cero dice `menos de 0,1 %`, para no mostrar un
 * cero que no es.
 */
export function formatPercent(ratio: number): string {
  if (ratio === 0) return `0${NBSP}%`
  const tenths = scaledInt(ratio, 3)
  if (tenths === 0 && ratio > 0) return `menos de 0,1${NBSP}%`
  return `${decimalEsAr((ratio < 0 ? -tenths : tenths) / 10, 1, true)}${NBSP}%`
}

/** Un conteo entero con puntos de miles: `8420` → `'8.420'`. */
export function formatCount(n: number): string {
  return decimalEsAr(Math.round(n), 0, true)
}

/** `51/8420` → `'6 de cada 1.000'`. Mayor que cero que redondea a cero: `menos de 1 de cada 1.000`. */
export function formatPerThousand(ratio: number): string {
  const n = scaledInt(ratio, 3)
  if (n === 0 && ratio > 0) return 'menos de 1 de cada 1.000'
  return `${formatCount(n)} de cada 1.000`
}

/** `'2026-09-09'` → `'09/09'`. Sin `Date`: la fecha es un `date` puro. */
export function formatDayMonth(isoDay: string): string {
  return `${isoDay.slice(8, 10)}/${isoDay.slice(5, 7)}`
}

/**
 * Un formateador, creado una sola vez. `hourCycle: 'h23'` porque con
 * `hour12: false` algunos motores devuelven `24` a la medianoche.
 */
const CORDOBA_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: SALON_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

type CordobaParts = { year: string; month: string; day: string; hour: string; minute: string }

function cordobaParts(iso: string): CordobaParts | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const out: CordobaParts = { year: '', month: '', day: '', hour: '', minute: '' }
  for (const part of CORDOBA_PARTS.formatToParts(date)) {
    if (part.type in out) out[part.type as keyof CordobaParts] = part.value
  }
  if (out.hour === '24') out.hour = '00'
  return out
}

/** `'2026-09-10T17:32:00Z'` → `'10/09 14:32'` (hora de Córdoba). String vacío si el timestamp no se lee. */
export function formatLoadedAt(iso: string): string {
  const p = cordobaParts(iso)
  return p ? `${p.day}/${p.month} ${p.hour}:${p.minute}` : ''
}

/** Día del calendario del bar al que pertenece un `timestamptz`, como `yyyy-MM-dd`. */
function cordobaIsoDay(iso: string): string | null {
  const p = cordobaParts(iso)
  return p ? `${p.year}-${p.month}-${p.day}` : null
}

/**
 * `'Nacho Badra'` → `'Nacho B.'`. Nombre y la inicial del ÚLTIMO apellido: es
 * lo que alcanza para que los socios sepan quién cargó, sin poner el nombre
 * completo en una pantalla que se comparte.
 */
export function shortName(displayName: string | null): string | null {
  const words = (displayName ?? '').trim().split(/\s+/).filter(Boolean)
  const first = words[0]
  if (!first) return null
  const last = words.length > 1 ? words[words.length - 1] : undefined
  const initial = last ? Array.from(last)[0]?.toLocaleUpperCase('es-AR') : undefined
  return initial ? `${first} ${initial}.` : first
}

// ─── Plurales ────────────────────────────────────────────────────────────────

function mensajes(n: number): string {
  return n === 1 ? '1 mensaje' : `${formatCount(n)} mensajes`
}

function reservasEnPie(n: number): string {
  return n === 1 ? '1 reserva en pie' : `${formatCount(n)} reservas en pie`
}

function personas(n: number): string {
  return n === 1 ? '1 persona' : `${formatCount(n)} personas`
}

function fechas(n: number): string {
  return n === 1 ? '1 fecha' : `${formatCount(n)} fechas`
}

// ─── Fase y estado ───────────────────────────────────────────────────────────

/** Las fechas son `date` puro: se comparan como strings, jamás con `new Date`. */
export function phaseOf(date: string, today: string): MarketingPhase {
  if (date < today) return 'past'
  if (date === today) return 'tonight'
  return 'future'
}

export function marketingStatus(row: EventMarketingRow | null): MarketingStatus {
  if (row === null) return 'sin-cargar'
  if (row.adSpendUsdCents <= 0) return 'sin-pauta'
  if (row.messages === null) return 'incompleta'
  return 'completa'
}

/**
 * ¿Le falta algo a una fecha que ya pasó? Sin fila, o con gasto y sin
 * mensajes. Hoy y lo futuro nunca están pendientes: la campaña puede seguir
 * corriendo y reclamarlo sería pedir un número que todavía no existe.
 */
export function isPendingMarketing(row: EventMarketingRow | null, phase: MarketingPhase): boolean {
  return phase === 'past' && (row === null || (row.adSpendUsdCents > 0 && row.messages === null))
}

/** El chip al lado de «PAUTA EN META». `null` cuando no hay nada que marcar. */
export function marketingStatusChip(
  row: EventMarketingRow | null,
  phase: MarketingPhase,
): { text: string; tone: 'warning' | 'muted' } | null {
  if (row === null || row.adSpendUsdCents <= 0) return null
  if (phase !== 'past') return { text: 'Por ahora', tone: 'muted' }
  if (row.messages === null) return { text: 'Incompleta', tone: 'warning' }
  return null
}

/** `Cargó Nacho B. · 10/09 14:32`, o `Cargada el 10/09 14:32` si no sabemos quién. */
export function loadedByLabel(row: EventMarketingRow): string {
  const at = formatLoadedAt(row.updatedAt)
  return row.updatedByName ? `Cargó ${row.updatedByName} · ${at}` : `Cargada el ${at}`
}

/**
 * Se cargó antes de que pasara la fecha: los números de Meta seguramente
 * siguieron moviéndose. Se compara el DÍA de Córdoba de la carga contra la
 * fecha del evento (cargar la tarde del evento no cuenta como "antes").
 */
export function loadedBeforeEventLine(
  row: EventMarketingRow | null,
  eventDate: string,
  phase: MarketingPhase,
): string | null {
  if (phase !== 'past' || row === null || row.adSpendUsdCents <= 0) return null
  const loadedDay = cordobaIsoDay(row.updatedAt)
  if (loadedDay === null || loadedDay >= eventDate) return null
  return `Se cargó el ${formatDayMonth(loadedDay)}, antes del evento. Si la campaña siguió, actualizá con los números finales de Meta.`
}

// ─── Cuentas de una edición ──────────────────────────────────────────────────

function ok(value: number): Kpi {
  return { ok: true, value }
}

function no(reason: KpiReason): Kpi {
  return { ok: false, reason }
}

function hasRevenue(
  row: EventMarketingRow,
): row is EventMarketingRow & { revenueArsCents: number; usdArsRate: number } {
  return row.revenueArsCents !== null && row.usdArsRate !== null && row.usdArsRate > 0
}

/**
 * Todas las cuentas de una edición, a precisión completa: se redondea recién
 * al formatear.
 *
 * Ejemplo del dueño: US$ 175,26, 51 mensajes, 11 reservas en pie, 29 personas,
 * alcance 8.420, facturación $ 2.480.000 con dólar a $ 1.450.
 */
export function computeMarketingKpis(block: MarketingBlock, row: EventMarketingRow): MarketingKpis {
  const spendUsd = row.adSpendUsdCents / 100
  if (row.adSpendUsdCents <= 0) {
    const none = no('sin-pauta')
    return {
      spendUsd: 0,
      costPerMessageUsd: none,
      closingRate: none,
      costPerReservationUsd: none,
      costPerGuestUsd: none,
      costPerThousandReachedUsd: none,
      replyRate: none,
      spendArs: none,
      revenueUsd: none,
      returnPerDollar: none,
      adShareOfRevenue: none,
      revenuePerGuestArs: none,
    }
  }

  const { reservations, guests } = block
  const { messages, reach } = row

  const costPerMessageUsd =
    messages === null
      ? no('sin-mensajes')
      : messages === 0
        ? no('cero-mensajes')
        : ok(spendUsd / messages)

  // Techo, no medida exacta: cuenta todas las reservas en pie, también las que
  // entraron por otro lado. Por eso nunca se muestra arriba de 100 %.
  const closingRate =
    messages === null
      ? no('sin-mensajes')
      : messages === 0
        ? no('cero-mensajes')
        : reservations > messages
          ? no('mas-reservas-que-mensajes')
          : ok(reservations / messages)

  const hasReach = reach !== null && reach > 0
  const replyRate = !hasReach
    ? no('sin-alcance')
    : messages === null
      ? no('sin-mensajes')
      : ok(messages / reach)

  let spendArs = no('sin-facturacion')
  let revenueUsd = no('sin-facturacion')
  let returnPerDollar = no('sin-facturacion')
  let adShareOfRevenue = no('sin-facturacion')
  let revenuePerGuestArs = no('sin-facturacion')
  if (hasRevenue(row)) {
    const revenueArs = row.revenueArsCents / 100
    const spendInPesos = spendUsd * row.usdArsRate
    const revenueInDollars = revenueArs / row.usdArsRate
    spendArs = ok(spendInPesos)
    revenueUsd = ok(revenueInDollars)
    returnPerDollar = ok(revenueInDollars / spendUsd)
    // Una facturación de $ 0 no se puede repartir: la pauta no es "infinito %" de nada.
    adShareOfRevenue = revenueArs > 0 ? ok(spendInPesos / revenueArs) : no('sin-facturacion')
    revenuePerGuestArs = guests > 0 ? ok(revenueArs / guests) : no('cero-personas')
  }

  return {
    spendUsd,
    costPerMessageUsd,
    closingRate,
    costPerReservationUsd: reservations > 0 ? ok(spendUsd / reservations) : no('cero-reservas'),
    costPerGuestUsd: guests > 0 ? ok(spendUsd / guests) : no('cero-personas'),
    costPerThousandReachedUsd: hasReach ? ok((spendUsd / reach) * 1000) : no('sin-alcance'),
    replyRate,
    spendArs,
    revenueUsd,
    returnPerDollar,
    adShareOfRevenue,
    revenuePerGuestArs,
  }
}

// ─── Textos de la ficha ──────────────────────────────────────────────────────

/**
 * La oración de arriba de la ficha, que es lo que los socios leen primero.
 *
 * Hoy y lo futuro llevan `Por ahora: ` y cambian «quedaron» por «hay»: la
 * noche todavía no terminó, nada "quedó" todavía.
 */
export function marketingSentence(
  block: MarketingBlock,
  row: EventMarketingRow,
  phase: MarketingPhase,
): string {
  if (row.adSpendUsdCents <= 0) return 'No tuvo pauta.'
  const live = phase !== 'past'
  const spend = formatUsd(row.adSpendUsdCents / 100)
  const pusimos = live ? `Por ahora: pusimos ${spend} en pauta` : `Pusimos ${spend} en pauta`
  const { reservations, guests } = block

  // "quedaron 11 reservas en pie (29 personas)" / "hay …" / "no quedó ninguna …"
  const standing = (capital: boolean): string => {
    if (reservations === 0) {
      const text = live ? 'no hay ninguna reserva en pie' : 'no quedó ninguna reserva en pie'
      return capital ? capitalize(text) : text
    }
    const verb = live ? 'hay' : reservations === 1 ? 'quedó' : 'quedaron'
    const text = `${verb} ${reservasEnPie(reservations)} (${personas(guests)})`
    return capital ? capitalize(text) : text
  }

  if (row.messages === null) return `${pusimos}. Faltan cargar los mensajes.`
  if (row.messages === 0) {
    return reservations === 0
      ? `${pusimos}, no escribió nadie y ${standing(false)}.`
      : `${pusimos} y no escribió nadie. ${standing(true)}.`
  }
  const llegaron = row.messages === 1 ? 'llegó 1 mensaje' : `llegaron ${mensajes(row.messages)}`
  return `${pusimos}, ${llegaron} y ${standing(false)}.`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * La línea grande del recuadro «Retorno». `warning` va en `text-warning-text`
 * después de `lead` (el componente pone el espacio entre los dos). Se decide
 * con el valor REDONDEADO, el que se lee: US$ 0,999 dice "US$ 1,00" y no puede
 * venir con "menos de lo que costó".
 */
export function returnSentence(k: MarketingKpis): { lead: string; warning: string | null } | null {
  if (!k.returnPerDollar.ok) return null
  const value = k.returnPerDollar.value
  const below = roundTo(value, 2) < 1
  return {
    lead: `Por cada US$${NBSP}1 de pauta, el evento facturó ${formatUsd(value)}${below ? ':' : '.'}`,
    warning: below ? 'menos de lo que costó la pauta.' : null,
  }
}

export const RETURN_DISCLAIMER = 'Es facturación, no ganancia: no descuenta costos.'

/**
 * El detalle del recuadro «Retorno», en pedazos para poder resaltar el número:
 * `before + value + after` es exactamente el texto de la spec.
 */
export function returnDetails(
  block: MarketingBlock,
  row: EventMarketingRow,
): Array<{ before: string; value: string; after: string }> {
  const k = computeMarketingKpis(block, row)
  if (!hasRevenue(row) || !k.spendArs.ok) return []
  const items = [
    { before: 'Facturación ', value: formatArs(row.revenueArsCents / 100), after: '' },
    {
      before: 'Pauta en pesos ',
      value: formatArs(k.spendArs.value),
      after: ` (dólar ${formatPesosRate(row.usdArsRate)})`,
    },
  ]
  if (k.adShareOfRevenue.ok) {
    items.push({
      before: 'La pauta fue el ',
      value: formatPercent(k.adShareOfRevenue.value),
      after: ' de lo facturado',
    })
  }
  if (k.revenuePerGuestArs.ok) {
    items.push({ before: '', value: formatArs(k.revenuePerGuestArs.value), after: ' por persona' })
  }
  return items
}

export type KpiTileKind = 'costPerMessage' | 'closingRate' | 'costPerReservation'

/**
 * Valor y cuenta de cada una de las tres fichas grandes. `value: null` se
 * dibuja como `—` con `aria-hidden`, precedido por `srReason` en `sr-only`; el
 * motivo en palabras es `hint`, que se lee siempre.
 */
export function kpiHint(
  kind: KpiTileKind,
  block: MarketingBlock,
  row: EventMarketingRow,
): { value: string | null; hint: string; srReason: string | null } {
  const cannot = (hint: string) => ({ value: null, hint, srReason: 'No se puede calcular:' })
  if (row.adSpendUsdCents <= 0) return cannot('no tuvo pauta')

  const k = computeMarketingKpis(block, row)
  const spend = formatUsd(k.spendUsd)
  const { reservations } = block
  const { messages } = row

  if (kind === 'costPerMessage') {
    if (messages === null) return cannot('faltan cargar los mensajes')
    if (messages === 0 || !k.costPerMessageUsd.ok) return cannot('no escribió nadie')
    return {
      value: formatUsd(k.costPerMessageUsd.value),
      hint: `${spend} ÷ ${mensajes(messages)}`,
      srReason: null,
    }
  }

  if (kind === 'closingRate') {
    if (messages === null) return cannot('faltan cargar los mensajes')
    if (messages === 0) return cannot('sin mensajes no hay cierre')
    if (!k.closingRate.ok) {
      return cannot(
        `${reservasEnPie(reservations)} y ${mensajes(messages)}: parte llegó por otro lado`,
      )
    }
    if (reservations === 0) {
      return {
        value: formatPercent(0),
        hint: `ninguna reserva en pie de ${mensajes(messages)}`,
        srReason: null,
      }
    }
    return {
      value: formatPercent(k.closingRate.value),
      hint: `${reservasEnPie(reservations)} de ${mensajes(messages)}`,
      srReason: null,
    }
  }

  if (!k.costPerReservationUsd.ok) return cannot('no quedó ninguna reserva en pie')
  return {
    value: formatUsd(k.costPerReservationUsd.value),
    hint: `${spend} ÷ ${reservasEnPie(reservations)}`,
    srReason: null,
  }
}

/**
 * La «ficha técnica» de abajo de las tres fichas. Sin alcance no va nada del
 * alcance; sin gente no va «Por persona». Nada se dibuja con `—` acá: lo que
 * no se puede calcular simplemente no está.
 */
export function fichaItems(
  block: MarketingBlock,
  row: EventMarketingRow,
): Array<{ label: string; value: string }> {
  const k = computeMarketingKpis(block, row)
  const items: Array<{ label: string; value: string }> = []
  if (k.costPerGuestUsd.ok)
    items.push({ label: 'Por persona', value: formatUsd(k.costPerGuestUsd.value) })
  if (row.reach !== null && row.reach > 0) {
    items.push({ label: 'Alcance', value: formatCount(row.reach) })
    if (k.costPerThousandReachedUsd.ok) {
      items.push({
        label: 'Cada 1.000 alcanzados',
        value: formatUsd(k.costPerThousandReachedUsd.value),
      })
    }
    if (k.replyRate.ok) {
      items.push({
        label: 'Escribió',
        value: `${formatPercent(k.replyRate.value)} (${formatPerThousand(k.replyRate.value)})`,
      })
    }
  }
  return items
}

/** Los bullets de «¿Cómo se calcula?». Los de alcance y retorno aparecen solo si aplican. */
export function howItsCalculated(row: EventMarketingRow): string[] {
  const bullets = [
    'Por mensaje: lo gastado dividido los mensajes. Tiene que parecerse al «Costo por resultado» de Meta.',
    'De cierre: reservas en pie de la fecha sobre mensajes. Cuenta todas las reservas, también las que no pasaron por el anuncio, así que es lo máximo que pudo cerrar la pauta.',
    'Por reserva y por persona: la pauta repartida entre las reservas en pie y su gente. Si parte llegó por otro lado, cada reserva de la pauta costó más.',
    'Mensajes: Meta no vuelve a contar a quien escribe de nuevo dentro de los 7 días.',
  ]
  if (row.reach !== null && row.reach > 0) {
    bullets.push('Cada 1.000 alcanzados no es el CPM de Meta: ese es por cada 1.000 impresiones.')
  }
  if (row.adSpendUsdCents > 0 && hasRevenue(row)) {
    bullets.push(
      'Retorno: la facturación pasada a dólares con el dólar cargado, dividida la pauta.',
    )
  }
  bullets.push('Las reservas se toman como están ahora: si se cancela una, estos números cambian.')
  return bullets
}

/**
 * «CON ESTOS NÚMEROS» del formulario: se recalcula a cada tecla con los
 * últimos valores válidos. Lo que falta se ve como `—`, nunca como 0.
 */
export function previewLines(
  block: MarketingBlock,
  values: {
    adSpendUsd: number | null
    messages: number | null
    reach: number | null
    revenueArs: number | null
    usdArsRate: number | null
  },
): Array<{ text: string }> {
  const DASH = '—'
  const spend = values.adSpendUsd !== null && values.adSpendUsd > 0 ? values.adSpendUsd : null
  const { messages } = values
  const { reservations, guests } = block

  const perMessage =
    spend !== null && messages !== null && messages > 0 ? formatUsd(spend / messages) : DASH

  let closing: string
  if (messages === null) {
    const who = reservations === 0 ? 'ninguna reserva en pie' : reservasEnPie(reservations)
    closing = `${DASH} de cierre · ${who} de ${DASH} mensajes`
  } else if (messages === 0) {
    closing = `${DASH} de cierre · sin mensajes no hay cierre`
  } else if (reservations > messages) {
    closing = `${DASH} de cierre · ${reservasEnPie(reservations)} y ${mensajes(messages)}: parte llegó por otro lado`
  } else if (reservations === 0) {
    closing = `${formatPercent(0)} de cierre · ninguna reserva en pie de ${mensajes(messages)}`
  } else {
    closing = `${formatPercent(reservations / messages)} de cierre · ${reservasEnPie(reservations)} de ${mensajes(messages)}`
  }

  const perReservation = spend !== null && reservations > 0 ? formatUsd(spend / reservations) : DASH
  const perGuest = spend !== null && guests > 0 ? formatUsd(spend / guests) : DASH

  return [
    { text: `${perMessage} por mensaje · Comparalo con «Costo por resultado» en Meta.` },
    { text: closing },
    { text: `${perReservation} por reserva · ${perGuest} por persona` },
  ]
}

// ─── Tira de ediciones (Por evento) ──────────────────────────────────────────

/** La segunda línea de cada edición en la tira. `null` cuando no hay nada que decir. */
export function editionMarketingLine(
  edition: MarketingBlock,
  row: EventMarketingRow | null,
  phase: MarketingPhase,
): { text: string; tone: 'muted' | 'warning' } | null {
  if (row === null) return phase === 'past' ? { text: 'Pauta sin cargar', tone: 'warning' } : null
  if (row.adSpendUsdCents <= 0) return { text: 'Sin pauta', tone: 'muted' }

  const spend = formatUsd(row.adSpendUsdCents / 100)
  const { messages } = row

  if (phase !== 'past') {
    const tail =
      messages === null ? '' : messages === 0 ? ' · no escribió nadie' : ` · ${mensajes(messages)}`
    return { text: `Por ahora: pauta ${spend}${tail}`, tone: 'muted' }
  }

  if (messages === null) return { text: `Pauta ${spend} · faltan los mensajes`, tone: 'muted' }
  if (messages === 0) return { text: `Pauta ${spend} · no escribió nadie`, tone: 'muted' }
  if (edition.reservations === 0) {
    return {
      text: `Pauta ${spend} · ${mensajes(messages)} · ninguna reserva en pie`,
      tone: 'muted',
    }
  }

  const k = computeMarketingKpis(edition, row)
  const closing = k.closingRate.ok
    ? `${formatPercent(k.closingRate.value)} de cierre`
    : 'más reservas que mensajes'
  const perReservation = k.costPerReservationUsd.ok
    ? ` · ${formatUsd(k.costPerReservationUsd.value)} por reserva`
    : ''
  return {
    text: `Pauta ${spend} · ${mensajes(messages)} · ${closing}${perReservation}`,
    tone: 'muted',
  }
}

// ─── Totales (cociente de sumas) ─────────────────────────────────────────────

export type PoolItem = {
  phase: MarketingPhase
  reservations: number
  guests: number
  row: EventMarketingRow | null
}

/**
 * Cuatro conjuntos, y cada cociente sale de UNO solo:
 * - `all`: toda fila con gasto, en cualquier fase (lo invertido).
 * - `P`: fechas que ya pasaron con gasto (por reserva, por persona).
 * - `Q`: P con mensajes cargados (por mensaje, cierre).
 * - `R`: P con facturación cargada (retorno). `null` si no hay ninguna.
 */
export type PooledMarketing = {
  all: { spendUsd: number; dates: number; notYet: number; notYetSpendUsd: number }
  P: {
    dates: number
    spendUsd: number
    reservations: number
    guests: number
    costPerReservationUsd: Kpi
    costPerGuestUsd: Kpi
    missingMessages: number
  }
  Q: {
    dates: number
    spendUsd: number
    messages: number
    reservations: number
    costPerMessageUsd: Kpi
    closingRate: Kpi
    costPerReservationUsd: Kpi
  }
  R: {
    dates: number
    spendUsd: number
    revenueUsd: number
    revenueArs: number
    spendArs: number
    returnPerDollar: Kpi
    adShareOfRevenue: Kpi
  } | null
}

/**
 * Totales como cociente de sumas, nunca promedio de cocientes: A (US$ 100 / 10
 * reservas) + B (US$ 30 / 1) cuesta US$ 11,82 por reserva, no US$ 20,00. Y el
 * retorno agrupado es Σ(facturación_i ÷ dólar_i) ÷ Σpauta_i: cada fecha se
 * pasa a dólares con SU dólar, que en Argentina cambia de una semana a otra.
 */
export function poolMarketing(items: ReadonlyArray<PoolItem>): PooledMarketing {
  const all = { spendUsd: 0, dates: 0, notYet: 0, notYetSpendUsd: 0 }
  const P = { dates: 0, spendUsd: 0, reservations: 0, guests: 0, missingMessages: 0 }
  const Q = { dates: 0, spendUsd: 0, messages: 0, reservations: 0 }
  const R = { dates: 0, spendUsd: 0, revenueUsd: 0, revenueArs: 0, spendArs: 0 }

  // Se suma en centavos para no arrastrar error de coma flotante entre muchas fechas.
  let allCents = 0
  let notYetCents = 0
  let pCents = 0
  let qCents = 0
  let rCents = 0

  for (const item of items) {
    const row = item.row
    if (row === null || row.adSpendUsdCents <= 0) continue
    const cents = row.adSpendUsdCents
    all.dates += 1
    allCents += cents
    if (item.phase !== 'past') {
      all.notYet += 1
      notYetCents += cents
      continue
    }
    P.dates += 1
    pCents += cents
    P.reservations += item.reservations
    P.guests += item.guests
    if (row.messages === null) {
      P.missingMessages += 1
    } else {
      Q.dates += 1
      qCents += cents
      Q.messages += row.messages
      Q.reservations += item.reservations
    }
    if (hasRevenue(row)) {
      const revenueArs = row.revenueArsCents / 100
      R.dates += 1
      rCents += cents
      R.revenueArs += revenueArs
      R.revenueUsd += revenueArs / row.usdArsRate
      R.spendArs += (cents / 100) * row.usdArsRate
    }
  }

  all.spendUsd = allCents / 100
  all.notYetSpendUsd = notYetCents / 100
  P.spendUsd = pCents / 100
  Q.spendUsd = qCents / 100
  R.spendUsd = rCents / 100

  return {
    all,
    P: {
      ...P,
      costPerReservationUsd:
        P.dates === 0
          ? no('sin-pauta')
          : P.reservations > 0
            ? ok(P.spendUsd / P.reservations)
            : no('cero-reservas'),
      costPerGuestUsd:
        P.dates === 0
          ? no('sin-pauta')
          : P.guests > 0
            ? ok(P.spendUsd / P.guests)
            : no('cero-personas'),
    },
    Q: {
      ...Q,
      costPerMessageUsd:
        Q.dates === 0
          ? no('sin-mensajes')
          : Q.messages > 0
            ? ok(Q.spendUsd / Q.messages)
            : no('cero-mensajes'),
      closingRate:
        Q.dates === 0
          ? no('sin-mensajes')
          : Q.messages === 0
            ? no('cero-mensajes')
            : Q.reservations > Q.messages
              ? no('mas-reservas-que-mensajes')
              : ok(Q.reservations / Q.messages),
      costPerReservationUsd:
        Q.dates === 0
          ? no('sin-mensajes')
          : Q.reservations > 0
            ? ok(Q.spendUsd / Q.reservations)
            : no('cero-reservas'),
    },
    R:
      R.dates === 0
        ? null
        : {
            ...R,
            returnPerDollar: ok(R.revenueUsd / R.spendUsd),
            adShareOfRevenue:
              R.revenueArs > 0 ? ok(R.spendArs / R.revenueArs) : no('sin-facturacion'),
          },
  }
}

/**
 * El resumen a la derecha del encabezado de la tira. Solo con 2 fechas o más
 * en Q (con una sola, el "total" es esa fecha con otro nombre). Todos los
 * cocientes salen de Q; el cierre se omite si hay más reservas que mensajes.
 * `pendingText` va en ámbar después de un `·` que pone el componente.
 */
export function pooledStripSummary(
  items: ReadonlyArray<PoolItem>,
): { text: string; pendingText: string | null } | null {
  const { Q } = poolMarketing(items)
  if (Q.dates < 2) return null
  const parts = [`Pauta en ${fechas(Q.dates)}: ${formatUsd(Q.spendUsd)}`]
  if (Q.costPerMessageUsd.ok) parts.push(`${formatUsd(Q.costPerMessageUsd.value)} por mensaje`)
  if (Q.closingRate.ok) parts.push(`${formatPercent(Q.closingRate.value)} de cierre`)
  if (Q.costPerReservationUsd.ok)
    parts.push(`${formatUsd(Q.costPerReservationUsd.value)} por reserva`)
  const pending = items.filter((i) => isPendingMarketing(i.row, i.phase)).length
  return {
    text: parts.join(' · '),
    pendingText: pending > 0 ? `falta cargar ${formatCount(pending)}` : null,
  }
}

// ─── Parser de lo que se tipea ───────────────────────────────────────────────

export type NumberKind = 'money' | 'count' | 'rate'

export type ParsedNumber =
  | { ok: true; value: number }
  | { ok: false; reason: 'vacio' | 'ilegible' | 'negativo' | 'con-decimales' }

/** Primer grupo de 1 a 3 dígitos y el resto de exactamente 3. */
function validGroups(groups: ReadonlyArray<string>): boolean {
  return groups.every((g, i) => (i === 0 ? /^\d{1,3}$/.test(g) : /^\d{3}$/.test(g)))
}

/** Deja el número como lo entiende `Number` (`'1234.5'`), o `null` si es ambiguo. */
function normalizeSeparators(s: string): string | null {
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  if (lastDot === -1 && lastComma === -1) return s

  if (lastDot !== -1 && lastComma !== -1) {
    // Los dos: el último es el decimal y el otro solo puede separar miles.
    const decimal = lastDot > lastComma ? '.' : ','
    const group = decimal === '.' ? ',' : '.'
    const decimalAt = s.lastIndexOf(decimal)
    const intPart = s.slice(0, decimalAt)
    const fracPart = s.slice(decimalAt + 1)
    if (intPart.includes(decimal) || !/^\d+$/.test(fracPart)) return null
    const groups = intPart.split(group)
    return validGroups(groups) ? `${groups.join('')}.${fracPart}` : null
  }

  const sep = lastDot !== -1 ? '.' : ','
  const parts = s.split(sep)
  // Más de una vez: separa miles, y todos los grupos tienen que ser de 3.
  if (parts.length > 2) return validGroups(parts) ? parts.join('') : null
  const [intPart = '', fracPart = ''] = parts
  // Una vez y 3 dígitos atrás: miles (`1.450`, `8,420`). `1234.567` es ambiguo.
  if (/^\d{3}$/.test(fracPart)) return validGroups(parts) ? parts.join('') : null
  // Una vez y 1-2 dígitos: decimal (`175,26`, `175.26`, `1450,50`).
  if (/^\d{1,2}$/.test(fracPart)) return `${intPart || '0'}.${fracPart}`
  return null
}

/**
 * Lee lo que el dueño pega desde Meta o tipea a mano, en cualquiera de los
 * dos formatos. Ads Manager en es-LA muestra `US$175,26`; una planilla en
 * inglés, `1,234.50`. La regla "si hay coma, es el decimal" leía mal esto
 * último, así que cuando hay ambos separadores manda el ÚLTIMO, y cuando hay
 * uno solo lo deciden los dígitos que lo siguen (3 = miles; 1-2 = decimal).
 */
export function parseLocaleNumber(raw: string, kind: NumberKind): ParsedNumber {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false, reason: 'vacio' }
  const firstDigit = trimmed.search(/\d/)
  // Un menos (o el signo tipográfico) antes del primer dígito. Un guion después
  // ("175,26 - USD") es texto y se descarta con el resto.
  if (firstDigit > 0 && /[-−]/.test(trimmed.slice(0, firstDigit)))
    return { ok: false, reason: 'negativo' }
  // Fuera US$, USD, $, letras, espacios y espacios duros: quedan dígitos y separadores.
  const cleaned = trimmed.replace(/[^\d.,]/g, '')
  if (!/\d/.test(cleaned)) return { ok: false, reason: 'ilegible' }
  const normalized = normalizeSeparators(cleaned)
  if (normalized === null) return { ok: false, reason: 'ilegible' }
  const value = Number(normalized)
  if (!Number.isFinite(value)) return { ok: false, reason: 'ilegible' }
  if (kind === 'count' && !Number.isInteger(value)) return { ok: false, reason: 'con-decimales' }
  return { ok: true, value }
}

/**
 * Cómo queda el input al salir del campo: `1,234.50` → `1.234,50`. Plata y
 * dólar van enteros si son redondos y con 2 decimales si no; los conteos,
 * enteros. Siempre vuelve a leerse igual con `parseLocaleNumber`.
 */
export function canonicalInput(value: number, kind: NumberKind): string {
  if (kind === 'count') return formatCount(value)
  return rateDigits(value, true)
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

export const MARKETING_EXPORT_HEADERS: readonly string[] = [
  'Pauta USD',
  'Mensajes',
  'Alcance',
  'Costo por mensaje USD',
  '% de cierre',
  'Costo por reserva USD',
  'Costo por persona USD',
  'Facturación ARS',
  'Dólar',
  'Retorno (USD facturados por USD de pauta)',
  'Pauta sobre facturación %',
  'Nota',
]

/**
 * Excel ejecuta una celda que arranca con `=`, `+`, `-`, `@`, tab o CR como
 * fórmula. Lo que escribió una persona (la nota, el nombre de un evento) va con
 * un apóstrofo adelante, que Excel no muestra.
 */
export function csvFormulaGuard(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

// Mismos redondeos que la pantalla, sin separador de miles: es lo que Excel en
// es-AR lee como número.
const csvUsd = (v: number) => decimalEsAr(v, 2, false)
const csvArs = (v: number) => decimalEsAr(v, 0, false)

/**
 * Misma regla que `formatPercent`, sin el `%`. Algo mayor que cero que redondea
 * a cero escribe `menos de 0,1`: la celda queda como texto, pero un `0,0` sería
 * un cero que no es, y la pantalla no lo dice.
 */
function csvPercent(ratio: number): string {
  if (ratio === 0) return '0'
  const tenths = scaledInt(ratio, 3)
  if (tenths === 0 && ratio > 0) return 'menos de 0,1'
  return decimalEsAr((ratio < 0 ? -tenths : tenths) / 10, 1, false)
}
const csvKpi = (k: Kpi, fmt: (v: number) => string) => (k.ok ? fmt(k.value) : '')

/**
 * Las 12 columnas de pauta de una fila. Celda vacía donde la pantalla muestra
 * `—` o la sección no aplica ("Sin evento", fechas sin fila). "No tuvo pauta"
 * escribe `0,00` y deja el resto vacío.
 */
export function marketingCsvCells(
  block: MarketingBlock | null,
  row: EventMarketingRow | null,
): string[] {
  const empty = MARKETING_EXPORT_HEADERS.map(() => '')
  if (block === null || row === null) return empty
  if (row.adSpendUsdCents <= 0) return ['0,00', ...empty.slice(1)]
  const k = computeMarketingKpis(block, row)
  return [
    csvUsd(k.spendUsd),
    row.messages === null ? '' : String(row.messages),
    row.reach === null ? '' : String(row.reach),
    csvKpi(k.costPerMessageUsd, csvUsd),
    csvKpi(k.closingRate, csvPercent),
    csvKpi(k.costPerReservationUsd, csvUsd),
    csvKpi(k.costPerGuestUsd, csvUsd),
    hasRevenue(row) ? csvArs(row.revenueArsCents / 100) : '',
    hasRevenue(row) ? rateDigits(row.usdArsRate, false) : '',
    csvKpi(k.returnPerDollar, csvUsd),
    csvKpi(k.adShareOfRevenue, csvPercent),
    row.notes ? csvFormulaGuard(row.notes) : '',
  ]
}

// ─── Pestaña «Pauta» (el mes) ────────────────────────────────────────────────

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] as const

/** `'2026-09-09'` → `'mié 09/09'`. Aritmética de calendario pura, idéntica en cualquier TZ. */
function weekdayDayMonth(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()]
  return `${weekday ?? ''} ${formatDayMonth(isoDay)}`.trim()
}

/** Lo que el mes necesita de cada edición. `EditionSummary` lo cumple tal cual. */
export type MonthEditionInput = Pick<
  EditionSummary,
  'key' | 'eventId' | 'date' | 'title' | 'colorHex' | 'reservations' | 'guests' | 'startsAtLocal'
>

/** Una edición del mes, liviana: viaja al cliente para el formulario inline. */
export type MonthEdition = {
  eventId: string
  date: string
  title: string
  colorHex: string | null
  reservations: number
  guests: number
  phase: MarketingPhase
  row: EventMarketingRow | null
  status: MarketingStatus
}

export type MonthCell = {
  /** `''` = la celda no aplica (fechas que todavía no pasaron). */
  text: string
  tone: 'default' | 'muted' | 'warning'
  /** Motivo en palabras para `sr-only` y `title` cuando `text` es `—`. */
  srText: string | null
}

export type MonthMarketingListRow = {
  eventId: string
  date: string
  /** `'09/09'`. */
  dayMonth: string
  /** `'mié 09/09'`. */
  weekdayLabel: string
  title: string
  colorHex: string | null
  phase: MarketingPhase
  /** `'todavía no pasó'` / `'es hoy'` debajo de la fecha; `null` si ya pasó. */
  phaseLabel: string | null
  cells: {
    spend: MonthCell
    messages: MonthCell
    closingRate: MonthCell
    costPerReservation: MonthCell
    guests: MonthCell
    returnPerDollar: MonthCell
  }
  /** Tarjeta mobile, a la derecha: `'US$ 15,93'` + «por reserva». `null` si no hay número. */
  cardHeadline: string | null
  /** Tarjeta mobile, línea 2: `Pauta US$ 175,26 · 51 mensajes · 21,6 % de cierre · 29 personas · retorno US$ 9,76`. */
  cardLine: string
}

export type MonthMarketingTile = {
  key: 'invested' | 'costPerReservation' | 'closingRate' | 'returnPerDollar'
  label: string
  /** `null` = `—` con `sr-only` «No se puede calcular:». */
  value: string | null
  hint: string
  tone: 'default' | 'warning'
}

export type MonthPendingRow = {
  eventId: string
  date: string
  title: string
  colorHex: string | null
  weekdayLabel: string
  reservations: number
  guests: number
  reservationsLabel: string
  incomplete: boolean
  row: EventMarketingRow | null
  cargarAriaLabel: string
  noAdsAriaLabel: string
}

export type MonthMarketingReport = {
  ym: string
  /** `'Septiembre de 2026'`. */
  monthLabel: string
  /** `'septiembre'`, para las oraciones. */
  monthName: string
  truncated: boolean
  /** Sin ninguna edición en el mes: se dibuja solo esto. */
  emptyState: { title: string; description: string } | null
  /** Hay ediciones pero no hay nada que resumir todavía. Va en lugar de los totales. */
  notice: string | null
  pending: { title: string; subtitle: string; rows: MonthPendingRow[] } | null
  /** Oraciones del resumen, en orden. Vacío si no hay gasto cargado. */
  summary: string[]
  /** Vacío si no hay gasto cargado. */
  tiles: MonthMarketingTile[]
  /** «Fechas con pauta», de la más vieja a la más nueva. */
  rows: MonthMarketingListRow[]
  /** La columna Retorno aparece solo si alguna fecha pasada tiene facturación. */
  showReturnColumn: boolean
  /** `Sin pauta: Pizza libre 10/09 · Merienda y Arte 26/09`. */
  noAdsText: string | null
  footnotes: string[]
  /** Todas las ediciones del mes, ascendente: la planilla sale de acá. */
  editions: MonthEdition[]
  pool: PooledMarketing
}

export const MONTH_FOOTNOTES: readonly string[] = [
  'El mes lo da la fecha del evento, no el día en que se pagó Meta.',
  'Solo suma la pauta cargada en fechas de eventos: la pauta general del bar no está acá.',
  'Por reserva y de cierre cuentan solo fechas que ya pasaron.',
]

function monthNameOf(ym: string): string | null {
  const month = Number(ym.slice(5, 7))
  return /^\d{4}-\d{2}$/.test(ym) ? (MONTHS[month - 1] ?? null) : null
}

function cell(
  text: string,
  tone: MonthCell['tone'] = 'default',
  srText: string | null = null,
): MonthCell {
  return { text, tone, srText }
}

const NOT_APPLICABLE = cell('', 'muted')

function listRow(e: MonthEdition, row: EventMarketingRow): MonthMarketingListRow {
  const spend = formatUsd(row.adSpendUsdCents / 100)
  const base = {
    eventId: e.eventId,
    date: e.date,
    dayMonth: formatDayMonth(e.date),
    weekdayLabel: weekdayDayMonth(e.date),
    title: e.title,
    colorHex: e.colorHex,
    phase: e.phase,
  }

  if (e.phase !== 'past') {
    // Por ahora: solo lo que se cargó, sin cocientes (regla 6).
    const messages =
      row.messages === null
        ? cell('—', 'muted', 'sin mensajes cargados')
        : cell(formatCount(row.messages))
    const tail =
      row.messages === null
        ? ''
        : row.messages === 0
          ? ' · no escribió nadie'
          : ` · ${mensajes(row.messages)}`
    return {
      ...base,
      phaseLabel: e.phase === 'tonight' ? 'es hoy' : 'todavía no pasó',
      cells: {
        spend: cell(spend),
        messages,
        closingRate: NOT_APPLICABLE,
        costPerReservation: NOT_APPLICABLE,
        guests: NOT_APPLICABLE,
        returnPerDollar: NOT_APPLICABLE,
      },
      cardHeadline: null,
      cardLine: `Pauta ${spend}${tail}`,
    }
  }

  const k = computeMarketingKpis(e, row)
  const messages =
    row.messages === null
      ? cell('falta', 'warning', 'faltan cargar los mensajes')
      : cell(formatCount(row.messages))

  let closingRate: MonthCell
  if (k.closingRate.ok) closingRate = cell(formatPercent(k.closingRate.value))
  else if (k.closingRate.reason === 'mas-reservas-que-mensajes')
    closingRate = cell('—', 'muted', 'más reservas que mensajes')
  else if (k.closingRate.reason === 'cero-mensajes')
    closingRate = cell('—', 'muted', 'no escribió nadie')
  else closingRate = cell('—', 'muted', 'faltan cargar los mensajes')

  const costPerReservation = k.costPerReservationUsd.ok
    ? cell(formatUsd(k.costPerReservationUsd.value))
    : cell('—', 'muted', 'ninguna reserva en pie')

  const returnBelowOne = k.returnPerDollar.ok && roundTo(k.returnPerDollar.value, 2) < 1
  const returnPerDollar = k.returnPerDollar.ok
    ? cell(formatUsd(k.returnPerDollar.value), returnBelowOne ? 'warning' : 'default')
    : cell('—', 'muted', 'sin facturación')

  const parts = [`Pauta ${spend}`]
  if (row.messages === null) parts.push('faltan los mensajes')
  else if (row.messages === 0) parts.push('no escribió nadie')
  else parts.push(mensajes(row.messages))
  if (k.closingRate.ok) parts.push(`${formatPercent(k.closingRate.value)} de cierre`)
  else if (k.closingRate.reason === 'mas-reservas-que-mensajes')
    parts.push('más reservas que mensajes')
  parts.push(e.reservations === 0 ? 'ninguna reserva en pie' : personas(e.guests))
  if (k.returnPerDollar.ok) parts.push(`retorno ${formatUsd(k.returnPerDollar.value)}`)

  return {
    ...base,
    phaseLabel: null,
    cells: {
      spend: cell(spend),
      messages,
      closingRate,
      costPerReservation,
      guests: cell(formatCount(e.guests)),
      returnPerDollar,
    },
    cardHeadline: k.costPerReservationUsd.ok ? formatUsd(k.costPerReservationUsd.value) : null,
    cardLine: parts.join(' · '),
  }
}

/** `(1 todavía no pasó)` / `(2 todavía no pasaron)` / `''`. */
function notYetParenthetical(notYet: number): string {
  if (notYet === 0) return ''
  return ` (${formatCount(notYet)} todavía no ${notYet === 1 ? 'pasó' : 'pasaron'})`
}

/**
 * Todo lo que dibuja la pestaña «Pauta» de un mes, ya contado y redactado.
 *
 * El mes lo da la FECHA DEL EVENTO, no el día en que se pagó Meta. Las
 * ediciones que no son del mes pedido se descartan (la query ya las filtra;
 * esto es la red).
 */
export function buildMonthMarketingReport(input: {
  ym: string
  today: string
  editions: ReadonlyArray<MonthEditionInput>
  marketing: Readonly<Record<string, EventMarketingRow>>
  truncated: boolean
}): MonthMarketingReport {
  const monthName = monthNameOf(input.ym) ?? input.ym
  const monthLabel = monthNameOf(input.ym)
    ? `${capitalize(monthName)} de ${input.ym.slice(0, 4)}`
    : input.ym

  const editions: MonthEdition[] = input.editions
    .filter((e) => e.date.startsWith(`${input.ym}-`))
    .map((e) => {
      const eventId = e.eventId ?? e.key
      const row = input.marketing[eventId] ?? null
      return {
        eventId,
        date: e.date,
        title: e.title,
        colorHex: e.colorHex,
        reservations: e.reservations,
        guests: e.guests,
        phase: phaseOf(e.date, input.today),
        row,
        status: marketingStatus(row),
        _startsAt: e.startsAtLocal ?? '',
      }
    })
    .sort((a, b) =>
      a.date !== b.date
        ? a.date < b.date
          ? -1
          : 1
        : a._startsAt.localeCompare(b._startsAt) || a.title.localeCompare(b.title),
    )
    .map(({ _startsAt, ...e }) => e)

  const pool = poolMarketing(editions)
  const { all, P, Q, R } = pool

  const emptyState =
    editions.length === 0
      ? {
          title:
            input.ym < input.today.slice(0, 7)
              ? `No hubo eventos en ${monthName}`
              : `No hay eventos programados en ${monthName}`,
          description: 'La pauta se carga por fecha de evento.',
        }
      : null

  const hasPast = editions.some((e) => e.phase === 'past')
  let notice: string | null = null
  if (editions.length > 0 && !hasPast) {
    // Con pauta ya cargada no se pide cargarla: el resumen y la lista de abajo
    // la muestran, y las fichas ya dicen «todavía no pasó ninguna fecha con pauta».
    notice =
      all.dates === 0
        ? `Todavía no pasó ninguna fecha de ${monthName}. Si ya estás pautando, cargala desde la ficha de cada evento.`
        : null
  } else if (editions.length > 0 && all.dates === 0) {
    notice = `Todavía no hay pauta cargada en ${monthName}.`
  }

  // Pendientes: fechas que ya pasaron, sin cargar o incompletas. Nunca hoy ni lo futuro.
  const pendingEditions = editions.filter((e) => isPendingMarketing(e.row, e.phase))
  const pending =
    pendingEditions.length === 0
      ? null
      : {
          title:
            pendingEditions.length === 1
              ? 'Falta cargar 1 fecha que ya pasó'
              : `Faltan cargar ${formatCount(pendingEditions.length)} fechas que ya pasaron`,
          subtitle: 'Hasta que estén, los totales del mes quedan cortos.',
          rows: pendingEditions.map((e) => {
            const label = `${e.title} del ${formatDayMonth(e.date)}`
            return {
              eventId: e.eventId,
              date: e.date,
              title: e.title,
              colorHex: e.colorHex,
              weekdayLabel: weekdayDayMonth(e.date),
              reservations: e.reservations,
              guests: e.guests,
              reservationsLabel:
                e.reservations === 0 ? 'sin reservas en pie' : reservasEnPie(e.reservations),
              incomplete: e.status === 'incompleta',
              row: e.row,
              cargarAriaLabel: `Cargar la pauta de ${label}`,
              noAdsAriaLabel: `${label}: no tuvo pauta`,
            }
          }),
        }

  const summary: string[] = []
  const tiles: MonthMarketingTile[] = []
  if (all.dates > 0) {
    summary.push(
      `En ${monthName} pusimos ${formatUsd(all.spendUsd)} de pauta en ${fechas(all.dates)}${notYetParenthetical(all.notYet)}.`,
    )
    if (P.dates > 0) {
      const which =
        P.dates === 1 ? 'En la que ya pasó' : `En las ${formatCount(P.dates)} que ya pasaron`
      const standing =
        P.reservations === 0
          ? 'no quedó ninguna reserva en pie'
          : `${P.reservations === 1 ? 'quedó' : 'quedaron'} ${reservasEnPie(P.reservations)} (${personas(P.guests)})`
      let body: string
      if (Q.dates === 0) body = standing
      else if (Q.messages === 0) body = `no escribió nadie y ${standing}`
      else
        body = `${Q.messages === 1 ? 'llegó 1 mensaje' : `llegaron ${mensajes(Q.messages)}`} y ${standing}`
      summary.push(`${which} ${body}.`)
      if (P.missingMessages > 0)
        summary.push(`Faltan los mensajes de ${fechas(P.missingMessages)}.`)
    }

    tiles.push({
      key: 'invested',
      label: 'Invertido',
      value: formatUsd(all.spendUsd),
      hint: `en ${fechas(all.dates)}${notYetParenthetical(all.notYet)}`,
      tone: 'default',
    })

    // Por reserva: P, incluidas las fechas con 0 reservas (la plata se gastó igual).
    tiles.push(
      P.dates === 0
        ? {
            key: 'costPerReservation',
            label: 'Por reserva',
            value: null,
            hint: 'todavía no pasó ninguna fecha con pauta',
            tone: 'default',
          }
        : P.costPerReservationUsd.ok
          ? {
              key: 'costPerReservation',
              label: 'Por reserva',
              value: formatUsd(P.costPerReservationUsd.value),
              hint: `${formatUsd(P.spendUsd)} ÷ ${reservasEnPie(P.reservations)}`,
              tone: 'default',
            }
          : {
              key: 'costPerReservation',
              label: 'Por reserva',
              value: null,
              hint: 'no quedó ninguna reserva en pie',
              tone: 'default',
            },
    )

    // De cierre: Q, con SUS reservas (no las de P), o el cociente mezcla conjuntos.
    let closingHint: string
    let closingValue: string | null = null
    if (P.dates === 0) closingHint = 'todavía no pasó ninguna fecha con pauta'
    else if (Q.dates === 0) closingHint = 'faltan cargar los mensajes'
    else if (Q.messages === 0) closingHint = 'sin mensajes no hay cierre'
    else if (!Q.closingRate.ok) closingHint = 'más reservas que mensajes'
    else {
      closingValue = formatPercent(Q.closingRate.value)
      closingHint =
        Q.reservations === 0
          ? `ninguna reserva en pie de ${mensajes(Q.messages)}`
          : `${reservasEnPie(Q.reservations)} de ${mensajes(Q.messages)}`
    }
    tiles.push({
      key: 'closingRate',
      label: 'De cierre',
      value: closingValue,
      hint: closingHint,
      tone: 'default',
    })

    if (R?.returnPerDollar.ok) {
      const ofDates = P.dates === 1 ? '1 fecha' : `${formatCount(P.dates)} fechas`
      tiles.push({
        key: 'returnPerDollar',
        label: `Facturó por cada US$${NBSP}1`,
        value: formatUsd(R.returnPerDollar.value),
        hint: `en ${formatCount(R.dates)} de ${ofDates} con facturación · Es facturación, no ganancia.`,
        tone: roundTo(R.returnPerDollar.value, 2) < 1 ? 'warning' : 'default',
      })
    }
  }

  const rows = editions.flatMap((e) =>
    e.row !== null && e.row.adSpendUsdCents > 0 ? [listRow(e, e.row)] : [],
  )
  const noAds = editions.filter((e) => e.status === 'sin-pauta')

  return {
    ym: input.ym,
    monthLabel,
    monthName,
    truncated: input.truncated,
    emptyState,
    notice,
    pending,
    summary,
    tiles,
    rows,
    showReturnColumn: R !== null,
    noAdsText:
      noAds.length === 0
        ? null
        : `Sin pauta: ${noAds.map((e) => `${e.title} ${formatDayMonth(e.date)}`).join(' · ')}`,
    footnotes: [...MONTH_FOOTNOTES],
    editions,
    pool,
  }
}

export const MONTH_EXPORT_HEADERS: readonly string[] = [
  'Fecha',
  'Evento',
  'Estado',
  'Personas',
  'Reservas',
  ...MARKETING_EXPORT_HEADERS,
]

/** Índices (dentro de las columnas de pauta) de los cocientes que "Por ahora" no tiene. */
const RATIO_COLUMNS = new Set([
  'Costo por mensaje USD',
  '% de cierre',
  'Costo por reserva USD',
  'Costo por persona USD',
  'Retorno (USD facturados por USD de pauta)',
  'Pauta sobre facturación %',
])

function monthEstado(e: MonthEdition): string {
  if (e.phase === 'tonight') return 'es hoy'
  if (e.phase === 'future') return 'todavía no pasó'
  switch (e.status) {
    case 'completa':
      return 'completa'
    case 'incompleta':
      return 'incompleta'
    case 'sin-pauta':
      return 'sin pauta'
    default:
      return 'sin cargar'
  }
}

/**
 * La planilla del mes: una fila por edición y los totales al final.
 *
 * Un total por conjunto (P, Q, R), cada uno con SOLO las sumas que usan sus
 * cocientes y con la base en el nombre. En una sola fila las reservas de P
 * quedaban al lado del cierre de Q y la cuenta no se podía rehacer en Excel
 * con las celdas de esa misma fila. Cada fila sale solo si su conjunto tiene
 * alguna fecha:
 *
 * - `Total con pauta que ya pasó`: P. Personas, reservas, pauta, por reserva y
 *   por persona.
 * - `… con mensajes cargados`: Q. Sus reservas, su pauta, los mensajes, costo
 *   por mensaje, cierre y por reserva.
 * - `… con facturación`: R. Su pauta, la facturación, el retorno y la pauta
 *   sobre facturación (cada fecha pasó a dólares con SU dólar, por eso la
 *   columna del dólar queda vacía).
 * - `Pauta de fechas que todavía no pasaron`: solo el gasto.
 *
 * Alcance y dólar nunca llevan total: el alcance de dos fechas no se suma (es
 * gente que se repite) y el dólar cambia de una fecha a otra.
 *
 * Las fechas que no pasaron llevan lo cargado pero no los cocientes, igual que
 * la lista de la pantalla.
 */
export function monthMarketingToCsv(report: MonthMarketingReport): string {
  const { P, Q, R, all } = report.pool
  const rows: string[][] = report.editions.map((e) => {
    const cells = marketingCsvCells(e, e.row)
    const marketing =
      e.phase === 'past'
        ? cells
        : cells.map((c, i) => (RATIO_COLUMNS.has(MARKETING_EXPORT_HEADERS[i] ?? '') ? '' : c))
    return [
      e.date,
      csvFormulaGuard(e.title),
      monthEstado(e),
      String(e.guests),
      String(e.reservations),
      ...marketing,
    ]
  })

  // Fecha;Evento;Estado;Personas;Reservas + las 12 de pauta. Lo que el total no
  // pone queda vacío.
  const totalRow = (label: string, cells: Partial<Record<string, string>>): string[] => [
    label,
    '',
    '',
    cells.Personas ?? '',
    cells.Reservas ?? '',
    ...MARKETING_EXPORT_HEADERS.map((h) => cells[h] ?? ''),
  ]

  if (P.dates > 0) {
    rows.push(
      totalRow(`Total con pauta que ya pasó (${fechas(P.dates)})`, {
        Personas: String(P.guests),
        Reservas: String(P.reservations),
        'Pauta USD': csvUsd(P.spendUsd),
        'Costo por reserva USD': csvKpi(P.costPerReservationUsd, csvUsd),
        'Costo por persona USD': csvKpi(P.costPerGuestUsd, csvUsd),
      }),
    )
  }
  if (Q.dates > 0) {
    rows.push(
      totalRow(`Total con pauta que ya pasó, con mensajes cargados (${fechas(Q.dates)})`, {
        Reservas: String(Q.reservations),
        'Pauta USD': csvUsd(Q.spendUsd),
        Mensajes: String(Q.messages),
        'Costo por mensaje USD': csvKpi(Q.costPerMessageUsd, csvUsd),
        '% de cierre': csvKpi(Q.closingRate, csvPercent),
        'Costo por reserva USD': csvKpi(Q.costPerReservationUsd, csvUsd),
      }),
    )
  }
  if (R) {
    rows.push(
      totalRow(`Total con pauta que ya pasó, con facturación (${fechas(R.dates)})`, {
        'Pauta USD': csvUsd(R.spendUsd),
        'Facturación ARS': csvArs(R.revenueArs),
        'Retorno (USD facturados por USD de pauta)': csvKpi(R.returnPerDollar, csvUsd),
        'Pauta sobre facturación %': csvKpi(R.adShareOfRevenue, csvPercent),
      }),
    )
  }
  rows.push([
    'Pauta de fechas que todavía no pasaron',
    '',
    '',
    '',
    '',
    csvUsd(all.notYetSpendUsd),
    ...MARKETING_EXPORT_HEADERS.slice(1).map(() => ''),
  ])

  return rowsToCsv([...MONTH_EXPORT_HEADERS], rows, { separator: ';', bom: true })
}
