/**
 * La proyección de ventas (pedido de los socios, 12/10/2026): su planilla, un
 * renglón por día con el objetivo contra lo vendido, y al lado «ventas contra
 * caja». Puro: la base (`acc_report_sales_projection`) trae por día el
 * objetivo, lo vendido por canal, la comisión estimada y lo que entró; las
 * cuentas se hacen acá y las prueba `administracion-proyeccion.test.ts`.
 *
 * Las fórmulas, deducidas de los números de su planilla:
 * - **Venta bar** = lo vendido que no es delivery (salón + canal Eventos).
 * - **Venta real** = venta bar − comisiones del posnet.
 * - **Venta neta** = venta real + venta delivery − comisión delivery.
 * - **Cumplimiento** = venta neta / objetivo.
 * - **Diferencia de caja** = lo que entró − venta bar (el delivery se acredita
 *   en otro momento y no entra en la comparación).
 *
 * Las comisiones son ESTIMADAS (medio × porcentaje de Ajustes): la real sale de
 * las acreditaciones, en «Neto por medio».
 */

import { formatWeekdayDayMonth } from '@/lib/dates'
import { formatCents, formatCentsShort } from '@/lib/money'

/** Una fila de `acc_report_sales_projection`, en centavos. */
export type ProjectionSourceDay = {
  day: string
  /** `null` o 0: el día no tiene objetivo. */
  targetCents: number | null
  /** «Evento y acciones» de la planilla, escrito a mano. */
  note: string | null
  /** Cierres del día vigentes de ese día (0 = no se cargó). */
  closes: number
  salonCents: number
  deliveryCents: number
  eventsCents: number
  salonCommissionCents: number
  deliveryCommissionCents: number
  eventsCommissionCents: number
  /** Σ de lo que entró en las cajas; `null` si ese día no se cargó. */
  cashCountedCents: number | null
}

export type DayMoment = 'past' | 'today' | 'future'

export type Compliance =
  /** Todavía no pasó: solo se muestra el objetivo. */
  | { kind: 'future' }
  | { kind: 'no_target' }
  /** El día de hoy, sin el cierre cargado todavía. */
  | { kind: 'in_progress' }
  /** Ya pasó y no tiene cierre: no se sabe cuánto se vendió. */
  | { kind: 'no_close' }
  | { kind: 'value'; percent: number; side: 'above' | 'below' | 'on'; gapPercent: number }

export type CashCheck =
  /** Todavía no pasó, o no hay nada cargado de ninguna de las dos puntas. */
  | { kind: 'none' }
  /** Hay cierre y falta cargar lo que entró. */
  | { kind: 'missing_count' }
  /** Se cargó lo que entró y falta el cierre. */
  | { kind: 'missing_close' }
  /** Las dos puntas: `diffCents` = entró − venta real del salón (negativo: falta plata). */
  | { kind: 'compared'; diffCents: number }

export type ProjectionDay = {
  day: string
  moment: DayMoment
  hasClose: boolean
  targetCents: number | null
  note: string | null
  barCents: number
  deliveryCents: number
  deliveryCommissionCents: number
  posnetCommissionCents: number
  realCents: number
  netCents: number
  compliance: Compliance
  /** Σ de los objetivos hasta este día. */
  targetAccumCents: number
  /** Σ de la venta neta hasta este día. */
  netAccumCents: number
  cashCountedCents: number | null
  cash: CashCheck
}

export type ProjectionTotals = {
  targetCents: number
  barCents: number
  deliveryCents: number
  deliveryCommissionCents: number
  posnetCommissionCents: number
  realCents: number
  netCents: number
  /** Lo vendido por el canal Eventos (va adentro de la venta bar). */
  eventsCents: number
}

export type MonthState = 'past' | 'current' | 'future'

export type ProjectionSummary = {
  monthState: MonthState
  /** Algún día del período tiene objetivo. */
  hasTargets: boolean
  /** «Vas vendiendo»: Σ de la venta neta del período. */
  soldCents: number
  monthTargetCents: number
  /** Hasta qué día cuenta «Objetivo a hoy»: el último día terminado (`null`: ninguno). */
  throughDay: string | null
  /** «Objetivo a hoy»: Σ de los objetivos hasta `throughDay`. */
  targetToDateCents: number
  /** Lo vendido contra el objetivo a hoy; `null` sin objetivo hasta hoy. */
  pace: Extract<Compliance, { kind: 'value' }> | null
  /** «Te falta vender»: objetivo del mes − vendido (0 si ya se llegó). */
  remainingCents: number
  /** Lo vendido por arriba del objetivo del mes (0 si todavía falta). */
  surplusCents: number
  /** Lo vendido contra el objetivo del mes entero; `null` sin objetivos. */
  monthPercent: number | null
}

export type CashTotals = {
  /** Días con cierre y con lo que entró cargado: los únicos que se comparan. */
  comparedDays: number
  salesCents: number
  countedCents: number
  /** Σ entró − Σ vendido de los días comparados. */
  diffCents: number
  /** Días con cierre a los que les falta cargar lo que entró. */
  missingCountDays: number
  /** Días con lo que entró cargado y sin cierre. */
  missingCloseDays: number
}

export type Projection = {
  days: ProjectionDay[]
  totals: ProjectionTotals
  summary: ProjectionSummary
  cash: CashTotals
}

/** `net` contra `target` (> 0), en porcentaje entero. */
export function complianceOf(
  netCents: number,
  targetCents: number,
): Extract<Compliance, { kind: 'value' }> {
  const percent = Math.round((netCents * 100) / targetCents)
  const side = percent > 100 ? 'above' : percent < 100 ? 'below' : 'on'
  return { kind: 'value', percent, side, gapPercent: Math.abs(percent - 100) }
}

/** Tiene objetivo: cargado y mayor a cero (un objetivo en cero no se puede cumplir ni incumplir). */
function hasTarget(targetCents: number | null): targetCents is number {
  return targetCents !== null && targetCents > 0
}

function momentOf(day: string, serviceDay: string): DayMoment {
  return day > serviceDay ? 'future' : day === serviceDay ? 'today' : 'past'
}

/**
 * Arma la proyección de un período (un mes) a partir de las filas de la base.
 * `serviceDay` es el día de servicio del bar (antes de las 5:00 es ayer): lo
 * que viene después es futuro y solo muestra el objetivo.
 */
export function buildProjection(
  rows: readonly ProjectionSourceDay[],
  opts: { serviceDay: string },
): Projection {
  const { serviceDay } = opts
  const sorted = [...rows].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  const totals: ProjectionTotals = {
    targetCents: 0,
    barCents: 0,
    deliveryCents: 0,
    deliveryCommissionCents: 0,
    posnetCommissionCents: 0,
    realCents: 0,
    netCents: 0,
    eventsCents: 0,
  }
  const cash: CashTotals = {
    comparedDays: 0,
    salesCents: 0,
    countedCents: 0,
    diffCents: 0,
    missingCountDays: 0,
    missingCloseDays: 0,
  }

  const days = sorted.map((row): ProjectionDay => {
    const moment = momentOf(row.day, serviceDay)
    const hasClose = row.closes > 0
    const barCents = row.salonCents + row.eventsCents
    const posnetCommissionCents = row.salonCommissionCents + row.eventsCommissionCents
    const realCents = barCents - posnetCommissionCents
    const netCents = realCents + row.deliveryCents - row.deliveryCommissionCents
    const targetCents = hasTarget(row.targetCents) ? row.targetCents : null

    totals.targetCents += targetCents ?? 0
    totals.barCents += barCents
    totals.deliveryCents += row.deliveryCents
    totals.deliveryCommissionCents += row.deliveryCommissionCents
    totals.posnetCommissionCents += posnetCommissionCents
    totals.realCents += realCents
    totals.netCents += netCents
    totals.eventsCents += row.eventsCents

    let compliance: Compliance
    if (moment === 'future') compliance = { kind: 'future' }
    else if (targetCents === null) compliance = { kind: 'no_target' }
    else if (!hasClose) compliance = { kind: moment === 'today' ? 'in_progress' : 'no_close' }
    else compliance = complianceOf(netCents, targetCents)

    let check: CashCheck = { kind: 'none' }
    if (moment !== 'future') {
      if (hasClose && row.cashCountedCents !== null) {
        // Como en su planilla («Sistema» contra «Entra real»): se compara contra la venta
        // real, la del salón sin las comisiones del posnet, que es lo que llega a la caja.
        const diffCents = row.cashCountedCents - realCents
        check = { kind: 'compared', diffCents }
        cash.comparedDays += 1
        cash.salesCents += realCents
        cash.countedCents += row.cashCountedCents
        cash.diffCents += diffCents
      } else if (hasClose) {
        check = { kind: 'missing_count' }
        cash.missingCountDays += 1
      } else if (row.cashCountedCents !== null) {
        check = { kind: 'missing_close' }
        cash.missingCloseDays += 1
      }
    }

    return {
      day: row.day,
      moment,
      hasClose,
      targetCents,
      note: row.note,
      barCents,
      deliveryCents: row.deliveryCents,
      deliveryCommissionCents: row.deliveryCommissionCents,
      posnetCommissionCents,
      realCents,
      netCents,
      compliance,
      targetAccumCents: totals.targetCents,
      netAccumCents: totals.netCents,
      cashCountedCents: row.cashCountedCents,
      cash: check,
    }
  })

  const first = days[0]?.day ?? null
  const last = days.at(-1)?.day ?? null
  const monthState: MonthState =
    last !== null && last < serviceDay
      ? 'past'
      : first !== null && first > serviceDay
        ? 'future'
        : 'current'

  // «A hoy» llega hasta el último día terminado: el de hoy entra recién cuando tiene su cierre
  // (si no, el objetivo de hoy contaría contra una venta que todavía no se cargó).
  let throughDay: string | null = null
  if (monthState === 'past') throughDay = last
  else if (monthState === 'current') {
    const done = days.filter((d) => d.moment === 'past' || (d.moment === 'today' && d.hasClose))
    throughDay = done.at(-1)?.day ?? null
  }
  let targetToDateCents = 0
  for (const d of days) {
    if (throughDay !== null && d.day <= throughDay) targetToDateCents = d.targetAccumCents
  }

  const hasTargets = totals.targetCents > 0
  const summary: ProjectionSummary = {
    monthState,
    hasTargets,
    soldCents: totals.netCents,
    monthTargetCents: totals.targetCents,
    throughDay,
    targetToDateCents,
    pace: targetToDateCents > 0 ? complianceOf(totals.netCents, targetToDateCents) : null,
    remainingCents: hasTargets ? Math.max(0, totals.targetCents - totals.netCents) : 0,
    surplusCents: hasTargets ? Math.max(0, totals.netCents - totals.targetCents) : 0,
    monthPercent: hasTargets ? Math.round((totals.netCents * 100) / totals.targetCents) : null,
  }

  return { days, totals, summary, cash }
}

// ─── Textos ──────────────────────────────────────────────────────────────────

/**
 * El cumplimiento en palabras y número, nunca solo con color: «80 % · 20 %
 * abajo», «120 % · 20 % arriba», «Sin objetivo». `null` para un día futuro (no
 * se muestra nada).
 */
export function complianceText(compliance: Compliance): string | null {
  switch (compliance.kind) {
    case 'future':
      return null
    case 'no_target':
      return 'Sin objetivo'
    case 'in_progress':
      return 'En curso'
    case 'no_close':
      return 'Sin cierre'
    case 'value':
      if (compliance.side === 'on') return '100 % · justo el objetivo'
      return `${compliance.percent} % · ${compliance.gapPercent} % ${
        compliance.side === 'above' ? 'arriba' : 'abajo'
      }`
  }
}

/**
 * La diferencia de caja en palabras, nunca con un menos pelado: «Coincide»,
 * «Faltan $ 1.000» (entró menos de lo vendido) o «Sobran $ 500».
 */
export function cashDiffText(diffCents: number): string {
  if (diffCents === 0) return 'Coincide'
  const abs = Math.abs(diffCents)
  // Sin centavos si es redondo; con centavos si no (una diferencia de 50 centavos no es «$ 1»).
  const amount = abs % 100 === 0 ? formatCentsShort(abs) : formatCents(abs)
  return diffCents < 0 ? `Faltan ${amount}` : `Sobran ${amount}`
}

/** Una cifra con su título y su aclaración (las tres de arriba de la proyección y las del Resumen). */
export type ProjectionFigure = { label: string; value: string; hint: string }

/**
 * Las tres cifras del mes: «Vas vendiendo», «Objetivo a hoy» y «Te falta
 * vender». Las usan la pantalla de la proyección y el Resumen, así dicen lo
 * mismo en los dos lados. En un mes terminado hablan en pasado.
 */
export function projectionFigures(summary: ProjectionSummary): {
  sold: ProjectionFigure
  target: ProjectionFigure
  remaining: ProjectionFigure
} {
  const past = summary.monthState === 'past'
  const sold: ProjectionFigure = {
    label: past ? 'Vendiste' : 'Vas vendiendo',
    value: formatCentsShort(summary.soldCents),
    hint: 'Venta neta: sin las comisiones estimadas.',
  }

  if (!summary.hasTargets) {
    return {
      sold,
      target: {
        label: past ? 'Objetivo del mes' : 'Objetivo a hoy',
        value: '—',
        hint: 'Este mes no tiene objetivos cargados.',
      },
      remaining: {
        label: past ? 'Te faltó vender' : 'Te falta vender',
        value: '—',
        hint: 'Aparece cuando el mes tiene objetivos.',
      },
    }
  }

  let target: ProjectionFigure
  if (past) {
    target = {
      label: 'Objetivo del mes',
      value: formatCentsShort(summary.monthTargetCents),
      hint: summary.pace ? (complianceText(summary.pace) ?? '') : '',
    }
  } else if (summary.throughDay === null) {
    target = {
      label: 'Objetivo a hoy',
      value: formatCentsShort(0),
      hint:
        summary.monthState === 'future'
          ? 'El mes todavía no empezó.'
          : 'Todavía no terminó ningún día del mes.',
    }
  } else {
    const until = `Hasta el ${formatWeekdayDayMonth(summary.throughDay)}`
    const pace = summary.pace
    target = {
      label: 'Objetivo a hoy',
      value: formatCentsShort(summary.targetToDateCents),
      hint: !pace
        ? `${until}: sin objetivo todavía.`
        : pace.side === 'on'
          ? `${until}: vas justo en el objetivo.`
          : `${until}: vas ${pace.gapPercent} % ${pace.side === 'above' ? 'arriba' : 'abajo'}.`,
    }
  }

  const monthTarget = formatCentsShort(summary.monthTargetCents)
  const remaining: ProjectionFigure =
    summary.remainingCents === 0
      ? {
          label: 'Objetivo cumplido',
          value: formatCentsShort(summary.surplusCents),
          hint: `Por arriba del objetivo del mes (${monthTarget}).`,
        }
      : {
          label: past ? 'Te faltó vender' : 'Te falta vender',
          value: formatCentsShort(summary.remainingCents),
          hint: `Para llegar al objetivo del mes (${monthTarget}).`,
        }

  return { sold, target, remaining }
}
