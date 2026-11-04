/**
 * La planilla del mes de Ventas: qué dice cada renglón, qué se puede hacer desde él, los tres números
 * de arriba y las oraciones que acompañan. Puro (sin lecturas): sale de lo que ya arma la pantalla
 * (`buildProjection`, `monthDays`) y lo prueban `administracion-ventas-planilla.test.tsx`,
 * `administracion-ventas-vista.test.ts` y `administracion-ventas-noche.test.ts`.
 *
 * Un solo «vendido» para todo el mes: el de cada renglón es la venta neta (sin las comisiones
 * estimadas), que es contra lo que se mide el cumplimiento desde la planilla de los socios. Así la
 * suma de los renglones ES el número de arriba y el del Resumen. Un día sin cargar nunca es un cero.
 */

import { hrefWith } from '@/components/administracion/cajas-ventas/periods'
import type { TotalizerItem } from '@/components/administracion/planilla/totalizer'
import type { PostingCatalog } from '@/lib/accounting/context'
import type { MonthDayState } from '@/lib/accounting/home'
import type {
  CashCheck,
  CashTotals,
  Compliance,
  ProjectionSummary,
} from '@/lib/accounting/projection'
import { cashDiffText } from '@/lib/accounting/projection'
import {
  capitalizeFirst,
  formatDayMonth,
  isRealIsoDay,
  monthName,
  WEEKDAY_NAMES_MIN,
  weekdayName,
  weekdayOf,
} from '@/lib/dates'
import { formatCents, formatCentsShort, NBSP } from '@/lib/money'

// ─── Los días ────────────────────────────────────────────────────────────────

/** El día en su renglón: «lu 02». Vacío si no es un día real. */
export function dayCell(day: string): string {
  if (!isRealIsoDay(day)) return ''
  return `${WEEKDAY_NAMES_MIN[weekdayOf(day)] ?? ''} ${day.slice(8, 10)}`
}

/** «lunes 02/11», para los lectores de pantalla de las celdas que se escriben. */
export function longDay(day: string): string {
  return `${weekdayName(day)} ${formatDayMonth(day)}`.trim()
}

/** «Miércoles 7 de octubre». Vacío si no es un día real. */
export function longDayTitle(day: string): string {
  if (!isRealIsoDay(day)) return ''
  const month = monthName(Number(day.slice(5, 7)))
  return capitalizeFirst(`${weekdayName(day)} ${Number(day.slice(8, 10))} de ${month}`)
}

/** «a», «a y b», «a, b y c». */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`
}

/** El evento del calendario y la nota del día, en la línea chica debajo del día. */
export function dayExtra(events: readonly string[], note: string | null): string | null {
  const parts = [...events, ...(note ? [note] : [])]
  return parts.length > 0 ? parts.join(' · ') : null
}

// ─── Los objetivos mientras se escriben ──────────────────────────────────────

/**
 * Lo recién guardado, por día: se muestra hasta que la página trae el dato nuevo. `from` es lo que
 * decía la página al guardar: cuando ya dice otra cosa, manda la página.
 */
export type PendingTargets = Readonly<Record<string, { from: number | null; value: number | null }>>

/** El objetivo guardado de un día: el de la página o, mientras viaja, el recién guardado. */
export function savedTarget(
  server: number | null,
  pending: PendingTargets[string] | undefined,
): number | null {
  return pending && pending.from === server ? pending.value : server
}

/**
 * Las filas de la base con los objetivos de la pantalla: lo que se está escribiendo manda sobre lo
 * guardado. Con esto se vuelve a hacer la misma cuenta del servidor, y el tipo del día, el
 * cumplimiento y los totales cambian mientras se escribe.
 */
export function liveTargets<R extends { day: string; targetCents: number | null }>(
  rows: readonly R[],
  typed: Readonly<Record<string, number | null>>,
  pending: PendingTargets,
): R[] {
  return rows.map((row) => ({
    ...row,
    targetCents:
      row.day in typed ? (typed[row.day] ?? null) : savedTarget(row.targetCents, pending[row.day]),
  }))
}

/** De lo que se quiere guardar, lo que cambia algo. */
export function changedTargets<T extends { day: string; targetCents: number | null }>(
  items: readonly T[],
  savedOf: (day: string) => number | null,
): T[] {
  return items.filter((item) => savedOf(item.day) !== item.targetCents)
}

// ─── Lo que se hace desde un renglón ─────────────────────────────────────────

export type RowAction = 'view' | 'load' | 'none'

/**
 * «Ver cierre» si el día lo tiene; «Cargar cierre» si ya llegó y falta, para quien carga. Antes del
 * arranque de los libros y en lo que todavía no llegó no hay nada que hacer. Quien solo mira no
 * carga: ve «Ver cierre» y nada más.
 */
export function rowAction(state: MonthDayState | undefined, canWrite: boolean): RowAction {
  if (state === 'loaded') return 'view'
  if ((state === 'missing' || state === 'today') && canWrite) return 'load'
  return 'none'
}

/**
 * El cierre que toca cargar en este mes: el primero que falta o, si no falta ninguno, el de hoy. Su
 * «Cargar cierre» es el botón lleno del renglón; los demás van en contorno.
 */
export function nextCloseDay(
  days: ReadonlyArray<{ day: string }>,
  states: Readonly<Record<string, MonthDayState>>,
): string | null {
  const missing = days.find((d) => states[d.day] === 'missing')
  if (missing) return missing.day
  return days.find((d) => states[d.day] === 'today')?.day ?? null
}

/** Dónde se carga el cierre de un día. */
export function closeHref(base: string, day: string): string {
  return hrefWith(`${base}/ventas/cierre`, { fecha: day })
}

export type PlanillaLink = {
  /** `/<bar>/administracion`. */
  base: string
  /** El `?tab=` de la URL, si vino por `proyeccion` o `caja`. */
  tab: 'proyeccion' | 'caja' | null
  /** El `?mes=` de la URL, si hay. */
  month: string | null
  /** El `?detalle=` que corresponde al interruptor. */
  detail: string | null
}

/** La planilla con una noche abierta (`?dia=`), o cerrada si `day` es `null`. */
export function planillaHref(link: PlanillaLink, day: string | null): string {
  return hrefWith(`${link.base}/ventas`, {
    tab: link.tab,
    mes: link.month,
    detalle: link.detail,
    dia: day,
  })
}

/**
 * La noche que se abre con `?dia=`: solo un día de este mes que tenga su cierre. Un `?dia=` viejo o de
 * un día sin cierre no abre nada (en ese renglón está «Cargar cierre»).
 */
export function openNight(
  requested: string | null,
  days: ReadonlyArray<{ date: string; state: MonthDayState }>,
): string | null {
  if (!requested) return null
  return days.find((d) => d.date === requested && d.state === 'loaded')?.date ?? null
}

// ─── Los números ─────────────────────────────────────────────────────────────

/**
 * «Objetivo del mes · Vendido · Falta vender». Lo que no se sabe va con «—», nunca con un «$ 0» que
 * afirme algo: un mes sin objetivos no tiene objetivo cero. Con el objetivo pasado, el tercer número
 * cambia de nombre: una «falta» en cero esconde cuánto se pasó.
 */
export function planillaTotals(
  summary: ProjectionSummary,
  opts: { hasCloses: boolean },
): TotalizerItem[] {
  const { hasTargets, monthState } = summary
  const toDate =
    monthState === 'current' && hasTargets && summary.targetToDateCents > 0
      ? `Objetivo a hoy ${formatCentsShort(summary.targetToDateCents)}`
      : undefined
  const remaining: TotalizerItem = !hasTargets
    ? { label: 'Falta vender', cents: null }
    : summary.surplusCents > 0
      ? { label: 'Arriba del objetivo', cents: summary.surplusCents, tone: 'ok' }
      : {
          label: monthState === 'past' ? 'Faltó vender' : 'Falta vender',
          cents: summary.remainingCents,
        }
  return [
    {
      label: 'Objetivo del mes',
      cents: hasTargets ? summary.monthTargetCents : null,
      hint: toDate,
    },
    { label: 'Vendido', cents: opts.hasCloses ? summary.soldCents : null, tone: 'ok' },
    remaining,
  ]
}

/** El cumplimiento de un renglón: el número, sin palabras; el verde o el rojo lo pone la pantalla. */
export function compliancePercent(compliance: Compliance): {
  text: string
  good: boolean
} | null {
  if (compliance.kind !== 'value') return null
  return { text: `${compliance.percent}${NBSP}%`, good: compliance.side !== 'below' }
}

// ─── Ventas contra caja ──────────────────────────────────────────────────────

/** La columna «Diferencia» en palabras, nunca con un menos pelado; `null` si no hay nada que decir. */
export function cashCheckText(cash: CashCheck): string | null {
  switch (cash.kind) {
    case 'compared':
      return cashDiffText(cash.diffCents)
    case 'missing_count':
      return 'Falta cargar'
    case 'missing_close':
      return 'Falta el cierre'
    default:
      return null
  }
}

/** Lo que falta para poder comparar, una oración por motivo. */
export function cashPending(cash: Pick<CashTotals, 'missingCountDays' | 'missingCloseDays'>) {
  const out: string[] = []
  if (cash.missingCountDays > 0) {
    out.push(
      cash.missingCountDays === 1
        ? 'A 1 día con cierre le falta cargar lo que entró.'
        : `A ${cash.missingCountDays} días con cierre les falta cargar lo que entró.`,
    )
  }
  if (cash.missingCloseDays > 0) {
    out.push(
      cash.missingCloseDays === 1
        ? 'A 1 día con lo que entró le falta el cierre.'
        : `A ${cash.missingCloseDays} días con lo que entró les falta el cierre.`,
    )
  }
  return out
}

/**
 * Cómo viene «Ventas contra caja», que afirma: «En 8 noches anotadas, faltan $ 12.400». A quien solo
 * mira (`reader`) no se le dice «anotaste»: no carga.
 */
export function cashTitle(
  cash: Pick<CashTotals, 'comparedDays' | 'diffCents'>,
  opts: { reader?: boolean } = {},
): string {
  if (cash.comparedDays <= 0) {
    return opts.reader
      ? 'Todavía no se anotó lo que entró ninguna noche'
      : 'Todavía no anotaste lo que entró ninguna noche'
  }
  const nights =
    cash.comparedDays === 1 ? 'En 1 noche anotada' : `En ${cash.comparedDays} noches anotadas`
  if (cash.diffCents === 0) return `${nights}, coincide`
  const abs = Math.abs(cash.diffCents)
  const amount = abs % 100 === 0 ? formatCentsShort(abs) : formatCents(abs)
  return cash.diffCents < 0 ? `${nights}, faltan ${amount}` : `${nights}, sobran ${amount}`
}

// ─── Las comisiones ──────────────────────────────────────────────────────────

export type CommissionGaps = { names: string[]; sentence: string }

/** Cuántos nombres se dicen antes de pasar a «y N más». */
const MAX_GAP_NAMES = 4

/**
 * Los medios que pagan después (tarjetas y apps) cuyo pagador no tiene la comisión cargada: mientras
 * tanto se cuentan enteros en lo vendido. `null` si no falta ninguna.
 */
export function commissionGaps(
  catalog: Pick<PostingCatalog, 'methods' | 'parties'>,
): CommissionGaps | null {
  const parties = new Map(catalog.parties.map((p) => [p.id, p]))
  const names: string[] = []
  for (const method of catalog.methods) {
    if (!method.active || method.kind !== 'receivable' || !method.partyId) continue
    const party = parties.get(method.partyId)
    if (!party || party.rates.commissionBp !== null) continue
    if (!names.includes(method.name)) names.push(method.name)
  }
  if (names.length === 0) return null
  const shown =
    names.length > MAX_GAP_NAMES
      ? `${names.slice(0, MAX_GAP_NAMES - 1).join(', ')} y ${names.length - (MAX_GAP_NAMES - 1)} más`
      : joinNames(names)
  const sentence =
    names.length === 1
      ? `1 medio no tiene la comisión cargada (${shown}): por ahora se cuenta entero.`
      : `${names.length} medios no tienen la comisión cargada (${shown}): por ahora se cuentan enteros.`
  return { names, sentence }
}

// ─── La noche ────────────────────────────────────────────────────────────────

/**
 * La oración de la noche abierta: el puente entre lo que se cargó esa noche y el número de la planilla.
 * Sin comisión estimada no hay nada que explicar.
 */
export function nightSentence(input: { loadedCents: number; netCents: number }): string | null {
  const commission = input.loadedCents - input.netCents
  if (!Number.isFinite(commission) || commission <= 0) return null
  return `Sacando lo que se quedan las tarjetas y las apps (unos ${formatCentsShort(commission)}, estimado), cuenta ${formatCentsShort(input.netCents)} para el mes: es el número de la planilla.`
}

type Pace = Extract<Compliance, { kind: 'value' }>

/**
 * La pastilla de la noche contra su objetivo: dice UNA cosa («16 % abajo del objetivo»). «84 % · 16 %
 * abajo» eran dos porcentajes pegados que sumaban cien y no decían de qué.
 */
export function nightPaceText(pace: Pace): string {
  if (pace.side === 'on') return 'Justo en el objetivo'
  return `${pace.gapPercent}${NBSP}% ${pace.side === 'above' ? 'arriba' : 'abajo'} del objetivo`
}
