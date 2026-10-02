/**
 * «Cómo se repartió el ingreso»: la dona de pauta / costo / resultado.
 *
 * Pedido de los socios (02/10/2026), C5 en «Por evento»: «Armar un gráfico de
 * torta por evento para ver la participación en porcentaje de "Pauta, costo,
 * ganancia"». C6 en «Pauta»: lo mismo para el mes. Este archivo arma TODO lo
 * que la dona y su leyenda dicen; el componente solo dibuja.
 *
 * Reglas que fija este archivo:
 *
 * T1. **El todo es el INGRESO**: ingreso = pauta + costo + resultado. Las tres
 *     porciones van SIEMPRE en ese orden (el de los socios) y cada una con su
 *     color: el color sigue a la cosa, nunca al tamaño.
 * T2. **Una torta no tiene porciones negativas.** Si la cuenta quedó abajo no
 *     se dibuja ninguna porción: el aro queda vacío, el centro dice cuánto
 *     faltó y la oración lo cuenta en palabras («La pauta y el costo se
 *     llevaron más que todo el ingreso: faltaron $ X»). La leyenda sigue con
 *     sus tres renglones: misma estructura siempre (C2 de los socios).
 * T3. **Se llama «Resultado», no «ganancia»** (regla 11 de
 *     `event-marketing.ts`): no descuenta sueldos, alquiler ni impuestos, y el
 *     disclaimer viaja en el objeto para que la pantalla no pueda olvidarlo.
 * T4. **Porcentajes con un decimal que suman 100,0 %** (resto mayor, sobre la
 *     suma de las tres partes). Sin pauta, la pauta no desaparece: dice «sin
 *     pauta» y «0 %». Algo mayor que cero que redondea a cero dice «menos de
 *     0,1 %», como `formatPercent`.
 * T5. **Los montos son los de la cuenta que la pantalla ya muestra al lado**:
 *     en «Por evento», el total del cuadro «Rentabilidad» (con 2 fechas o más,
 *     redondeado UNA vez, como su fila de total en la planilla; con una sola,
 *     cada número por su lado, como su desglose); en «Pauta», la cuenta del mes
 *     (cada suma por su lado, como la línea de la cuenta y su planilla).
 * T6. **Faltante no es cero**: sin ninguna fecha con la cuenta cerrada no hay
 *     dona (`null`), y la pantalla no dibuja nada en su lugar.
 * T7. **La base se nombra** («En las 3 fechas con la cuenta cerrada (1 sin
 *     pauta)»): el todo de la dona no es todo el evento ni todo el mes.
 *
 * Puro: sin DB, sin React y sin `Intl` (se dibuja en el server y en el
 * cliente). Formatea con los formateadores a mano de `event-marketing.ts`.
 */

import { type ConsolidatedEditionInput, editionVerdict } from './event-consolidated'
import {
  computeMarketingKpis,
  decimalEsAr,
  type EventMarketingRow,
  formatArs,
  formatCount,
  formatPercent,
  type MonthMarketingReport,
  NIGHT_RESULT_DISCLAIMER,
  noAdsResultLabel,
  shownPesos,
} from './event-marketing'

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** La cuenta que reparte la dona, en PESOS ENTEROS (los que se leen). */
export type MoneyTotals = {
  revenueArs: number
  costArs: number
  adSpendArs: number
  /** Ingreso − costo − pauta. Negativo = la cuenta quedó abajo. */
  resultArs: number
  /** Cuántas fechas entran, y cuántas de esas fueron sin pauta (la base las nombra). */
  dates: number
  organicDates: number
}

export type MoneyShareKey = 'pauta' | 'costo' | 'resultado'

export type MoneyShareSlice = {
  key: MoneyShareKey
  label: 'Pauta' | 'Costo' | 'Resultado'
  /** Lo que mide el arco. 0 = sin arco (sin pauta, resultado en cero, o la cuenta quedó abajo). */
  arc: number
  /**
   * `24,1 %` (reparto: los tres suman 100,0 %) · `0 %` · `menos de 0,1 %` ·
   * `95,6 %` (abajo: cuánto del ingreso se llevó; ya no suman 100) · `—`.
   */
  share: string
  /** `$ 474.406` · `sin pauta` · `$ 0` · `$ 73.600 abajo`. */
  amount: string
  tone: 'default' | 'muted' | 'warning'
}

export type MoneyShare = {
  /** `reparto`: hay torta. `abajo`: la cuenta quedó abajo y el aro va vacío (T2). */
  state: 'reparto' | 'abajo'
  title: string
  /** `En las 3 fechas con la cuenta cerrada` (T7). */
  base: string
  /**
   * El centro del aro: el todo (`$ 1.971.000` / `de ingreso`) o lo que faltó
   * (`$ 73.600` / `abajo`). Es texto que el lector oye: en «Por evento» el
   * ingreso no está escrito en ningún otro lado.
   */
  center: { value: string; label: string; tone: 'default' | 'warning' }
  /** Siempre los tres, en orden: pauta, costo, resultado (T1). */
  slices: readonly [MoneyShareSlice, MoneyShareSlice, MoneyShareSlice]
  /** La dona dicha en palabras: va visible debajo (es el `figcaption`). */
  sentence: string
  /** Notas al pie, solo si aplican. */
  notes: string[]
  /** Siempre `NIGHT_RESULT_DISCLAIMER` (T3). */
  disclaimer: string
}

// ─── Palabras ────────────────────────────────────────────────────────────────

export const MONEY_SHARE_TITLE = 'Cómo se repartió el ingreso'

/** Va en la pestaña «Pauta» cuando el mes tuvo noches sin pauta con su cuenta: no entran (regla 14). */
export const MONEY_SHARE_ORGANIC_NOTE =
  'Las noches sin pauta no entran: su resultado está en «Sin pauta», más abajo.'

// Espacio duro escrito con su código: un NBSP literal en el fuente es invisible.
const NBSP = '\u00A0'

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// ─── Porcentajes que suman 100 ───────────────────────────────────────────────

/**
 * Reparte `units` (1000 = décimas de punto, 100 = pesos de cada $ 100) entre
 * los valores, proporcional y por resto mayor: la suma da exacta. Un valor 0
 * nunca recibe nada. Empates: gana el que va antes (pauta, costo, resultado).
 */
export function largestRemainder(values: readonly number[], units: number): number[] {
  const total = values.reduce((a, b) => a + b, 0)
  if (total <= 0) return values.map(() => 0)
  const raw = values.map((v) => (v / total) * units)
  const out = raw.map((r) => Math.floor(r))
  let left = units - out.reduce((a, b) => a + b, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .filter((x) => x.frac > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    out[i] = (out[i] ?? 0) + 1
    left -= 1
  }
  return out
}

/** Décimas de punto → `24,1 %`. 0 con valor > 0 → `menos de 0,1 %`. */
function tenthsText(tenths: number, value: number): string {
  if (value <= 0) return `0${NBSP}%`
  if (tenths === 0) return `menos de 0,1${NBSP}%`
  return `${decimalEsAr(tenths / 10, 1, true)}${NBSP}%`
}

// ─── «De cada $ 100» ─────────────────────────────────────────────────────────

/** `$ 24` · `$ 1` · `menos de $ 1` (algo que hay, pero no llega a un peso de cada cien). */
function per100(pesos: number, value: number): string {
  return pesos === 0 && value > 0 ? `menos de $${NBSP}1` : `$${NBSP}${formatCount(pesos)}`
}

/** Concuerda con el monto: `$ 1 se fue` · `menos de $ 1 se fue` · `$ 24 se fueron`. */
function singular(pesos: number, value: number): boolean {
  return pesos === 1 || (pesos === 0 && value > 0)
}

// ─── La dona ─────────────────────────────────────────────────────────────────

/**
 * Todo lo que dibuja la dona, a partir de una cuenta ya redondeada (T5).
 * `base` la arma quien llama (`eventMoneyShareBase` / `monthMoneyShareBase`).
 */
export function buildMoneyShare(
  totals: MoneyTotals,
  opts: { base: string; notes?: string[] },
): MoneyShare {
  const { revenueArs: revenue, costArs: cost, adSpendArs: ads, resultArs: result } = totals
  const noAds = ads <= 0
  const base = {
    title: MONEY_SHARE_TITLE,
    base: opts.base,
    notes: opts.notes ?? [],
    disclaimer: NIGHT_RESULT_DISCLAIMER,
  }

  // ── Quedó abajo: el aro va vacío y se dice en palabras (T2) ──
  if (result < 0) {
    const missing = formatArs(-result)
    const ofRevenue = (v: number) => (revenue > 0 ? formatPercent(v / revenue) : '—')
    const sentence = noAds
      ? `El costo (${formatArs(cost)}) se llevó más que todo el ingreso (${formatArs(revenue)}): faltaron ${missing}.`
      : `La pauta y el costo (${formatArs(ads + cost)}) se llevaron más que todo el ingreso (${formatArs(revenue)}): faltaron ${missing}.`
    return {
      ...base,
      state: 'abajo',
      center: { value: missing, label: 'abajo', tone: 'warning' },
      slices: [
        noAds
          ? {
              key: 'pauta',
              label: 'Pauta',
              arc: 0,
              share: `0${NBSP}%`,
              amount: 'sin pauta',
              tone: 'muted',
            }
          : {
              key: 'pauta',
              label: 'Pauta',
              arc: 0,
              share: ofRevenue(ads),
              amount: formatArs(ads),
              tone: 'default',
            },
        {
          key: 'costo',
          label: 'Costo',
          arc: 0,
          share: ofRevenue(cost),
          amount: formatArs(cost),
          tone: 'default',
        },
        {
          key: 'resultado',
          label: 'Resultado',
          arc: 0,
          share: '—',
          amount: `${missing} abajo`,
          tone: 'warning',
        },
      ],
      sentence,
    }
  }

  // ── Reparto: la torta (T1, T4) ──
  const parts = [Math.max(ads, 0), Math.max(cost, 0), Math.max(result, 0)]
  const tenths = largestRemainder(parts, 1000)
  const hundred = largestRemainder(parts, 100)
  const [pA = 0, pC = 0, pR = 0] = parts
  const [tA = 0, tC = 0, tR = 0] = tenths
  const [hA = 0, hC = 0, hR = 0] = hundred
  const everythingZero = pA + pC + pR === 0

  const go = (h: number, v: number) => `${per100(h, v)} ${singular(h, v) ? 'se fue' : 'se fueron'}`
  const stay = (h: number, v: number) => `${singular(h, v) ? 'quedó' : 'quedaron'} ${per100(h, v)}`
  const OF_EACH = `De cada $${NBSP}100 que entraron`
  let sentence: string
  if (everythingZero) sentence = `La cuenta dio $${NBSP}0: no entró ni salió plata.`
  else if (pR === 0 && noAds) sentence = 'Todo el ingreso se fue en costo: no quedó nada.'
  else if (pR === 0)
    sentence = `${OF_EACH}, ${go(hA, pA)} en pauta y ${per100(hC, pC)} en costo: no quedó nada.`
  else if (noAds) sentence = `${OF_EACH}, ${go(hC, pC)} en costo y ${stay(hR, pR)}: no hubo pauta.`
  else
    sentence = `${OF_EACH}, ${go(hA, pA)} en pauta, ${per100(hC, pC)} en costo y ${stay(hR, pR)}.`

  const shareOf = (t: number, v: number) => (everythingZero ? '—' : tenthsText(t, v))
  return {
    ...base,
    state: 'reparto',
    center: { value: formatArs(revenue), label: 'de ingreso', tone: 'default' },
    slices: [
      noAds
        ? {
            key: 'pauta',
            label: 'Pauta',
            arc: 0,
            share: shareOf(0, 0),
            amount: 'sin pauta',
            tone: 'muted',
          }
        : {
            key: 'pauta',
            label: 'Pauta',
            arc: pA,
            share: shareOf(tA, pA),
            amount: formatArs(pA),
            tone: 'default',
          },
      {
        key: 'costo',
        label: 'Costo',
        arc: pC,
        share: shareOf(tC, pC),
        amount: formatArs(pC),
        tone: 'default',
      },
      pR === 0
        ? {
            key: 'resultado',
            label: 'Resultado',
            arc: 0,
            share: shareOf(0, 0),
            amount: formatArs(0),
            tone: 'muted',
          }
        : {
            key: 'resultado',
            label: 'Resultado',
            arc: pR,
            share: shareOf(tR, pR),
            amount: formatArs(pR),
            tone: 'default',
          },
    ],
    sentence,
  }
}

// ─── El dibujo del aro ───────────────────────────────────────────────────────

/** Una porción del aro, en fracciones de vuelta: desde las 12, en el sentido del reloj. */
export type DonutArc = { key: MoneyShareKey; start: number; size: number }

/**
 * Dónde va cada porción del aro, en el orden de T1. Las de `arc` 0 no se
 * dibujan, y sin ninguna (la cuenta abajo, o todo en cero) el aro va vacío
 * (T2). El componente dibuja un `<circle>` por porción con esto, sin recharts,
 * para que la dona salga entera en el HTML del server.
 */
export function donutArcs(slices: ReadonlyArray<Pick<MoneyShareSlice, 'key' | 'arc'>>): DonutArc[] {
  const total = slices.reduce((sum, s) => sum + Math.max(s.arc, 0), 0)
  if (total <= 0) return []
  const arcs: DonutArc[] = []
  let start = 0
  for (const s of slices) {
    if (s.arc <= 0) continue
    const size = s.arc / total
    arcs.push({ key: s.key, start, size })
    start += size
  }
  return arcs
}

// ─── La base (T7) ────────────────────────────────────────────────────────────

/** `En la única fecha con la cuenta cerrada` · `En las 3 fechas con la cuenta cerrada (1 sin pauta)`. */
export function eventMoneyShareBase(totals: Pick<MoneyTotals, 'dates' | 'organicDates'>): string {
  const { dates, organicDates } = totals
  const head =
    dates === 1
      ? 'En la única fecha con la cuenta cerrada'
      : `En las ${formatCount(dates)} fechas con la cuenta cerrada`
  if (organicDates === 0) return head
  if (dates === 1) return `${head} (sin pauta)`
  if (organicDates === dates) return `${head} (todas sin pauta)`
  return `${head} (${formatCount(organicDates)} sin pauta)`
}

/** La base de la cuenta del mes, con mayúscula: `En 17 de 21 fechas con ingreso y costo cargados (5 con bebida)`. */
export function monthMoneyShareBase(report: Pick<MonthMarketingReport, 'result'>): string | null {
  return report.result ? capitalize(report.result.base) : null
}

// ─── Los totales (T5) ────────────────────────────────────────────────────────

/**
 * La cuenta de las fechas JUZGADAS de un evento (las de ✓ / ✗ / «$ 0» del
 * cuadro «Rentabilidad»). `null` sin ninguna (T6).
 *
 * Con 2 o más se redondea como la fila de total del cuadro en la planilla:
 * ingreso, margen y resultado UNA vez, y costo y pauta por diferencia (cierra
 * justo). Con una sola, cada número por su lado, como el desglose de esa fecha.
 */
export function eventMoneyTotals(input: {
  editions: ReadonlyArray<ConsolidatedEditionInput>
  marketing: Readonly<Record<string, EventMarketingRow>>
}): MoneyTotals | null {
  const judged: Array<{ e: ConsolidatedEditionInput; row: EventMarketingRow }> = []
  for (const e of input.editions) {
    const row = input.marketing[e.eventId ?? e.key] ?? null
    if (row === null) continue
    if (editionVerdict(e, row).kind === 'sin-juzgar') continue
    judged.push({ e, row })
  }
  if (judged.length === 0) return null
  const organicDates = judged.filter(({ row }) => row.adSpendUsdCents <= 0).length

  const kpis = judged.map(({ e, row }) => computeMarketingKpis(e, row))
  const value = (k: { ok: true; value: number } | { ok: false }) => (k.ok ? k.value : 0)

  if (judged.length === 1) {
    const k = kpis[0]
    if (!k) return null
    return {
      revenueArs: shownPesos(value(k.revenueArs)),
      costArs: shownPesos(value(k.costArs)),
      adSpendArs: shownPesos(value(k.adSpendArs)),
      resultArs: shownPesos(value(k.nightResultArs)),
      dates: 1,
      organicDates,
    }
  }

  let revenue = 0
  let margin = 0
  let result = 0
  for (const k of kpis) {
    revenue += value(k.revenueArs)
    margin += value(k.grossMarginArs)
    result += value(k.nightResultArs)
  }
  const revenueRead = shownPesos(revenue)
  const marginRead = shownPesos(margin)
  const resultRead = shownPesos(result)
  return {
    revenueArs: revenueRead,
    costArs: revenueRead - marginRead,
    adSpendArs: marginRead - resultRead,
    resultArs: resultRead,
    dates: judged.length,
    organicDates,
  }
}

/**
 * La cuenta del mes de la pestaña «Pauta»: el conjunto S (fechas CON pauta que
 * ya pasaron, con ingreso, costo y dólar), cada suma redondeada por su lado,
 * igual que la línea de la cuenta del mes y su planilla. `null` sin S (T6).
 */
export function monthMoneyTotals(report: Pick<MonthMarketingReport, 'pool'>): MoneyTotals | null {
  const S = report.pool.S
  if (S === null) return null
  return {
    revenueArs: shownPesos(S.revenueArs),
    costArs: shownPesos(S.costArs),
    adSpendArs: shownPesos(S.adSpendArs),
    resultArs: shownPesos(S.resultArs),
    dates: S.dates,
    // S no tiene noches sin pauta (regla 14): se nombran en una nota.
    organicDates: 0,
  }
}

/** La dona de «Por evento». `null` sin fechas con la cuenta cerrada (T6). */
export function eventMoneyShare(input: {
  editions: ReadonlyArray<ConsolidatedEditionInput>
  marketing: Readonly<Record<string, EventMarketingRow>>
}): MoneyShare | null {
  const totals = eventMoneyTotals(input)
  return totals === null ? null : buildMoneyShare(totals, { base: eventMoneyShareBase(totals) })
}

/** La dona de la pestaña «Pauta». `null` si el mes no tiene la cuenta cerrada en ninguna fecha con pauta. */
export function monthMoneyShare(
  report: Pick<MonthMarketingReport, 'pool' | 'result' | 'editions'>,
): MoneyShare | null {
  const totals = monthMoneyTotals(report)
  const base = monthMoneyShareBase(report)
  if (totals === null || base === null) return null
  // Una noche sin pauta con su cuenta cerrada no entra (regla 14) y se dice.
  const organicWithResult = report.editions.some(
    (e) => e.status === 'sin-pauta' && noAdsResultLabel(e) !== null,
  )
  return buildMoneyShare(totals, {
    base,
    notes: organicWithResult ? [MONEY_SHARE_ORGANIC_NOTE] : [],
  })
}
