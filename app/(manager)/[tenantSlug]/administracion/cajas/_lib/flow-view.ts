/**
 * «Entró y salió» (la segunda vista de Cajas y bancos): lo que la pantalla
 * afirma con el flujo de caja por mes y categoría, y con la proyección de las
 * próximas semanas. Puro; lo prueba `tests/lib/administracion-cajas-vista.test.ts`.
 *
 * La proyección NO sabe cuánto se va a vender: cuenta la plata de hoy, lo que
 * te deben y lo que debés según sus vencimientos, y los gastos fijos con
 * monto. Por eso nunca dice «te va a faltar»: dice «sin contar lo que vendas,
 * faltarían», y va en ámbar (una estimación no es una alarma).
 */

import type { BalanceAreaPoint } from '@/components/administracion/charts/balance-area'
import type { InOutBucket } from '@/components/administracion/charts/in-out-bars'
import type { RankBarsRow } from '@/components/administracion/charts/rank-bars'
import { sharePercents } from '@/components/administracion/charts/scale'
import type { CashFlowRow, CashProjectionRow } from '@/lib/accounting/queries/treasury'
import {
  capitalizeFirst,
  endOfWeek,
  formatDayMonth,
  isRealIsoDay,
  MONTH_NAMES_SHORT,
  monthName,
  WEEKDAY_NAMES_SHORT,
  weekdayOf,
} from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'

// ─── Las categorías, en palabras de dueño ────────────────────────────────────

type CategoryWords = {
  /** El nombre en una lista. */
  label: string
  /** «De cada $ 100 que salieron, $ 79 …» */
  out: string
  /** «De cada $ 100 que entraron, $ 96 …» */
  in: string
  /** «Todo lo que salió …» */
  allOut: string
  /** «Todo lo que entró …» */
  allIn: string
}

const CATEGORY_WORDS: Readonly<Record<string, CategoryWords>> = {
  sales: {
    label: 'Ventas cobradas',
    out: 'fueron devoluciones de ventas',
    in: 'fueron ventas cobradas',
    allOut: 'fueron devoluciones de ventas',
    allIn: 'fue por ventas cobradas',
  },
  suppliers: {
    label: 'Proveedores',
    out: 'fueron a proveedores',
    in: 'vinieron de proveedores',
    allOut: 'fue a proveedores',
    allIn: 'vino de proveedores',
  },
  payroll: {
    label: 'Sueldos',
    out: 'fueron a sueldos',
    in: 'vinieron de sueldos',
    allOut: 'fue a sueldos',
    allIn: 'vino de sueldos',
  },
  taxes: {
    label: 'Impuestos',
    out: 'fueron a impuestos',
    in: 'vinieron de impuestos',
    allOut: 'fue a impuestos',
    allIn: 'vino de impuestos',
  },
  bank: {
    label: 'Banco y comisiones',
    out: 'se los quedó el banco',
    in: 'vinieron del banco',
    allOut: 'se lo quedó el banco',
    allIn: 'vino del banco',
  },
  partners: {
    label: 'Socios',
    out: 'se los llevaron los socios',
    in: 'los pusieron los socios',
    allOut: 'se lo llevaron los socios',
    allIn: 'lo pusieron los socios',
  },
  other: {
    label: 'Otros',
    out: 'fueron a otras cosas',
    in: 'vinieron de otras cosas',
    allOut: 'fue a otras cosas',
    allIn: 'vino de otras cosas',
  },
}

/** El orden en que se listan cuando empatan (el del reporte). */
const CATEGORY_ORDER = ['sales', 'suppliers', 'taxes', 'payroll', 'bank', 'partners', 'other']

function wordsOf(category: string, fallbackLabel: string): CategoryWords {
  return (
    CATEGORY_WORDS[category] ?? {
      label: fallbackLabel,
      out: `fueron a ${fallbackLabel.toLowerCase()}`,
      in: `vinieron de ${fallbackLabel.toLowerCase()}`,
      allOut: `fue a ${fallbackLabel.toLowerCase()}`,
      allIn: `vino de ${fallbackLabel.toLowerCase()}`,
    }
  )
}

/** El nombre de una categoría del flujo para el dueño («Proveedores», no «Pagos a proveedores»). */
export function flowCategoryLabel(category: string, fallbackLabel: string): string {
  return wordsOf(category, fallbackLabel).label
}

// ─── Entró y salió, mes por mes ──────────────────────────────────────────────

export type FlowSide = {
  /** El título que afirma; `null` si no hay nada de ese lado. */
  title: string | null
  /** Una fila por categoría, de mayor a menor. */
  rows: RankBarsRow[]
  totalCents: number
}

export type FlowView = {
  /** En el período no entró ni salió plata. */
  isEmpty: boolean
  /** Un tramo por mes, en orden. */
  months: InOutBucket[]
  inCents: number
  outCents: number
  title: string
  sentence: string
  /** «En qué se fue». */
  out: FlowSide
  /** «De dónde vino». Con una sola categoría, la pantalla lo dice en una oración. */
  in: FlowSide
}

function monthLabel(month: string, withYear: boolean): string {
  const name = monthName(Number(month.slice(5, 7)))
  return withYear ? `${name} de ${month.slice(0, 4)}` : name
}

function side(
  totals: ReadonlyMap<string, { cents: number; label: string }>,
  direction: 'in' | 'out',
): FlowSide {
  const entries = [...totals.entries()]
    .filter(([, v]) => v.cents > 0)
    .sort(
      ([a, va], [b, vb]) =>
        vb.cents - va.cents || CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b),
    )
  const totalCents = entries.reduce((sum, [, v]) => sum + v.cents, 0)
  const rows: RankBarsRow[] = entries.map(([category, v]) => ({
    key: category,
    label: wordsOf(category, v.label).label,
    cents: v.cents,
  }))
  const top = entries[0]
  if (!top || totalCents <= 0) return { title: null, rows, totalCents }
  const [category, value] = top
  const words = wordsOf(category, value.label)
  if (entries.length === 1) {
    return {
      title:
        direction === 'out'
          ? `Todo lo que salió ${words.allOut}`
          : `Todo lo que entró ${words.allIn}`,
      rows,
      totalCents,
    }
  }
  // El mismo reparto que dibujan las barras de abajo (enteros que suman 100):
  // el título no puede decir «$ 79» al lado de una barra que dice «80 %».
  const rounded = sharePercents(entries.map(([, v]) => v.cents))[0] ?? 0
  // Si la primera se lleva todo menos monedas, se dice «casi todo».
  if (rounded >= 100) {
    return {
      title:
        direction === 'out'
          ? `Casi todo lo que salió ${words.allOut}`
          : `Casi todo lo que entró ${words.allIn}`,
      rows,
      totalCents,
    }
  }
  const of100 = Math.max(1, rounded)
  return {
    title:
      direction === 'out'
        ? `De cada $ 100 que salieron, $ ${of100} ${words.out}`
        : `De cada $ 100 que entraron, $ ${of100} ${words.in}`,
    rows,
    totalCents,
  }
}

/**
 * Lo que muestra «Entró y salió»: el dibujo por mes, el título, la oración y
 * los dos repartos por categoría. Mover plata entre cajas no cuenta (la base
 * ya lo deja afuera).
 */
export function flowView(rows: readonly CashFlowRow[]): FlowView {
  const byMonth = new Map<string, { inCents: number; outCents: number }>()
  const ins = new Map<string, { cents: number; label: string }>()
  const outs = new Map<string, { cents: number; label: string }>()
  for (const row of rows) {
    const inflow = Math.max(0, row.inflowCents)
    const outflow = Math.max(0, row.outflowCents)
    if (inflow === 0 && outflow === 0) continue
    if (isRealIsoDay(row.month)) {
      const month = byMonth.get(row.month) ?? { inCents: 0, outCents: 0 }
      month.inCents += inflow
      month.outCents += outflow
      byMonth.set(row.month, month)
    }
    const into = ins.get(row.category) ?? { cents: 0, label: row.categoryLabel }
    into.cents += inflow
    ins.set(row.category, into)
    const out = outs.get(row.category) ?? { cents: 0, label: row.categoryLabel }
    out.cents += outflow
    outs.set(row.category, out)
  }

  const keys = [...byMonth.keys()].sort()
  const first = keys[0]
  const last = keys.at(-1)
  const manyYears =
    first !== undefined && last !== undefined && first.slice(0, 4) !== last.slice(0, 4)
  const months: InOutBucket[] = keys.map((key) => {
    const month = byMonth.get(key) ?? { inCents: 0, outCents: 0 }
    const short = MONTH_NAMES_SHORT[Number(key.slice(5, 7)) - 1] ?? ''
    return {
      key,
      label: capitalizeFirst(monthLabel(key, manyYears)),
      shortLabel: capitalizeFirst(manyYears ? `${short} ${key.slice(2, 4)}` : short),
      inCents: month.inCents,
      outCents: month.outCents,
    }
  })
  const inCents = months.reduce((sum, m) => sum + m.inCents, 0)
  const outCents = months.reduce((sum, m) => sum + m.outCents, 0)
  const net = inCents - outCents

  if (first === undefined || last === undefined) {
    return {
      isEmpty: true,
      months: [],
      inCents: 0,
      outCents: 0,
      title: 'Todavía no entró ni salió plata de las cajas',
      sentence: 'En este período no entró ni salió plata de las cajas.',
      out: { title: null, rows: [], totalCents: 0 },
      in: { title: null, rows: [], totalCents: 0 },
    }
  }

  const when =
    first === last
      ? `En ${monthLabel(first, false)}`
      : `De ${monthLabel(first, manyYears)} a ${monthLabel(last, manyYears)}`
  const result =
    net > 0
      ? `hay ${formatCentsShort(net)} más en las cajas`
      : net < 0
        ? `hay ${formatCentsShort(-net)} menos`
        : 'quedó lo mismo'
  return {
    isEmpty: false,
    months,
    inCents,
    outCents,
    title:
      net > 0
        ? 'Entró más plata de la que salió'
        : net < 0
          ? 'Salió más plata de la que entró'
          : 'Entró y salió la misma plata',
    sentence: `${when} entró ${formatCentsShort(inCents)} y salió ${formatCentsShort(outCents)}: ${result}.`,
    out: side(outs, 'out'),
    in: side(ins, 'in'),
  }
}

// ─── Las próximas 4 semanas ──────────────────────────────────────────────────

export const PROJECTION_SENTENCE =
  'Estimado. Cuenta la plata que hay hoy, lo que te deben y lo que debés según sus vencimientos, y los gastos fijos que tienen monto. No cuenta lo que vas a vender.'

export type ProjectionWeek = {
  key: string
  /** «Esta semana (hasta el dom 18/10)» · «Semana del 19/10». */
  label: string
  inCents: number
  outCents: number
  /** Cómo quedaría al terminar esa semana. Negativo: faltaría. */
  balanceCents: number
  short: boolean
}

export type ProjectionView =
  | {
      /** Todavía no se sabe cuánta plata hay: no se estima nada sobre un cero que no es un dato. */
      kind: 'unknown'
      title: string
    }
  | {
      /** No hay nada que venza ni que entre en las próximas semanas. */
      kind: 'nothing'
      title: string
    }
  | {
      kind: 'weeks'
      title: string
      sentence: string
      /** Hoy + el último día de cada semana. */
      points: BalanceAreaPoint[]
      weeks: ProjectionWeek[]
      /** Alguna semana quedaría en negativo. */
      short: boolean
    }

function weekdayShort(day: string): string {
  return WEEKDAY_NAMES_SHORT[weekdayOf(day)] ?? ''
}

/**
 * La proyección, lista para dibujar. `rows` son las semanas que devuelve la
 * base (la primera va de hoy al domingo; las demás arrancan en lunes).
 * `availableCents` es la plata de hoy (la misma «Plata disponible» de la
 * billetera) y `known` dice si ese número es un dato.
 */
export function projectionView(
  rows: readonly CashProjectionRow[],
  availableCents: number,
  opts: { today: string; known: boolean },
): ProjectionView {
  if (!opts.known) {
    return {
      kind: 'unknown',
      title: 'Para estimar si te alcanza, primero decime cuánta plata hay.',
    }
  }
  const valid = rows.filter((r) => isRealIsoDay(r.weekStart))
  if (valid.length === 0 || valid.every((r) => r.inCents === 0 && r.outCents === 0)) {
    return { kind: 'nothing', title: 'No hay nada que venza en las próximas 4 semanas.' }
  }

  const weeks: ProjectionWeek[] = valid.map((r, index) => {
    const end = endOfWeek(r.weekStart)
    return {
      key: r.weekStart,
      label:
        index === 0
          ? `Esta semana (hasta el ${weekdayShort(end)} ${formatDayMonth(end)})`
          : `Semana del ${formatDayMonth(r.weekStart)}`,
      inCents: Math.max(0, r.inCents),
      outCents: Math.max(0, r.outCents),
      balanceCents: r.projectedBalanceCents,
      short: r.projectedBalanceCents < 0,
    }
  })
  const firstShort = weeks.findIndex((w) => w.short)
  const shortWeek = firstShort >= 0 ? weeks[firstShort] : undefined
  const count = weeks.length
  const title = shortWeek
    ? `Sin contar lo que vendas, ${
        firstShort === 0 ? 'esta semana' : `la semana del ${formatDayMonth(shortWeek.key)}`
      } faltarían ${formatCentsShort(-shortWeek.balanceCents)}`
    : `Con lo que hay hoy alcanza para lo que vence en ${
        count === 1 ? 'esta semana' : `las próximas ${count} semanas`
      }`

  return {
    kind: 'weeks',
    title,
    sentence: PROJECTION_SENTENCE,
    points: [
      { date: opts.today, cents: availableCents },
      // Un domingo, la primera «semana» termina hoy mismo: ese punto ya es el de hoy.
      ...valid
        .map((r) => ({ date: endOfWeek(r.weekStart), cents: r.projectedBalanceCents }))
        .filter((p) => p.date > opts.today),
    ],
    weeks,
    short: shortWeek !== undefined,
  }
}
