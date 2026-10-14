/**
 * «Lo que llegó»: de cada $ 100 que cobró un medio, cuánto te llegó y cuánto
 * se quedó en el camino. Puro: recibe las filas de `getNetByMethod` y arma los
 * renglones del dibujo, el título que afirma y la oración. Lo prueba
 * `administracion-ventas-cobrar.test.ts`.
 *
 * La base de cada barra es lo que YA se liquidó de ese medio (lo que llegó más
 * lo que descontaron); lo que sigue en camino va aparte, porque todavía nadie
 * sabe cuánto le van a descontar.
 */

import type { NetByMethodRow } from '@/lib/accounting/queries/books'
import { CHANNEL_LABELS } from '@/lib/accounting/queries/labels'
import { formatCents, formatCentsShort } from '@/lib/money'

export type NetSegmentKey = 'arrived' | 'commission' | 'withholdings' | 'other'

export const NET_SEGMENT_LABELS: Readonly<Record<NetSegmentKey, string>> = {
  arrived: 'Te llegó',
  commission: 'Comisión y su IVA',
  withholdings: 'Retenciones',
  other: 'Otros y sin explicar',
}

export type NetSegment = { key: NetSegmentKey; cents: number; percent: number }

export type NetRowView = {
  id: string
  name: string
  /** «Salón», «Delivery». */
  channelLabel: string
  soldCents: number
  creditedCents: number
  pendingCents: number
  /** Lo que ya se liquidó: lo que llegó más todo lo que descontaron. */
  settledCents: number
  /** Los tramos de la barra, sobre lo liquidado. Vacío si todavía no se liquidó nada. */
  segments: NetSegment[]
  /** Lo que se queda de cada $ 100, en puntos básicos; `null` si todavía no liquidó. */
  discountBp: number | null
  /**
   * `settled`: ya liquidó algo con descuento · `whole`: llegó todo, sin
   * descuentos (el efectivo) · `pending`: todavía no liquidó nada.
   */
  state: 'settled' | 'whole' | 'pending'
  /** La conclusión del renglón, ya escrita. */
  line: string
}

function hasMovement(row: NetByMethodRow): boolean {
  return row.soldCents !== 0 || row.creditedCents !== 0 || row.pendingCents !== 0
}

/** «$ 69,75»: lo que queda de cada $ 100 con ese descuento. */
export function keptOfHundred(discountBp: number): string {
  return formatCents(Math.max(0, 10_000 - discountBp))
}

function viewOf(row: NetByMethodRow): NetRowView {
  const commission = Math.max(0, row.commissionCents) + Math.max(0, row.commissionVatCents)
  const withholdings = Math.max(0, row.withholdingsCents)
  const other = Math.max(0, row.otherChargesCents) + Math.max(0, row.unexplainedCents)
  const arrived = Math.max(0, row.creditedCents)
  const settled = arrived + commission + withholdings + other
  const parts: Array<[NetSegmentKey, number]> = [
    ['arrived', arrived],
    ['commission', commission],
    ['withholdings', withholdings],
    ['other', other],
  ]
  const segments: NetSegment[] =
    settled > 0
      ? parts
          .filter(([, cents]) => cents > 0)
          .map(([key, cents]) => ({ key, cents, percent: (cents * 100) / settled }))
      : []

  const deducted = commission + withholdings + other
  let state: NetRowView['state']
  let line: string
  if (settled <= 0) {
    state = 'pending'
    line =
      row.pendingCents > 0
        ? `Todavía no te liquidó: ${formatCentsShort(row.pendingCents)} en camino`
        : 'Todavía no te liquidó nada'
  } else if (deducted === 0 || row.discountBp === null || row.discountBp <= 0) {
    state = deducted === 0 ? 'whole' : 'settled'
    line = deducted === 0 ? 'te llega todo' : `te descontaron ${formatCentsShort(deducted)}`
  } else {
    state = 'settled'
    line = `te quedan ${keptOfHundred(row.discountBp)} de cada $ 100`
  }
  return {
    id: row.methodId,
    name: row.methodName,
    channelLabel: CHANNEL_LABELS[row.channel] ?? row.channel,
    soldCents: row.soldCents,
    creditedCents: row.creditedCents,
    pendingCents: row.pendingCents,
    settledCents: settled,
    segments,
    discountBp: settled > 0 ? (row.discountBp ?? 0) : null,
    state,
    line,
  }
}

/**
 * Los renglones de «De cada $ 100»: solo los medios con movimiento, del más
 * caro al más barato; los que todavía no liquidaron nada, al final.
 */
export function netRows(rows: readonly NetByMethodRow[]): NetRowView[] {
  return rows
    .filter(hasMovement)
    .map(viewOf)
    .sort((a, b) => {
      const ap = a.state === 'pending' ? 1 : 0
      const bp = b.state === 'pending' ? 1 : 0
      if (ap !== bp) return ap - bp
      return (
        (b.discountBp ?? 0) - (a.discountBp ?? 0) ||
        b.soldCents - a.soldCents ||
        a.name.localeCompare(b.name, 'es')
      )
    })
}

export type NetTotals = {
  soldCents: number
  creditedCents: number
  /** Comisiones, su IVA, retenciones, otros cargos y lo sin explicar. */
  deductedCents: number
  pendingCents: number
}

export function netTotals(rows: readonly NetByMethodRow[]): NetTotals {
  const out: NetTotals = { soldCents: 0, creditedCents: 0, deductedCents: 0, pendingCents: 0 }
  for (const row of rows) {
    out.soldCents += row.soldCents
    out.creditedCents += row.creditedCents
    out.deductedCents +=
      Math.max(0, row.commissionCents) +
      Math.max(0, row.commissionVatCents) +
      Math.max(0, row.withholdingsCents) +
      Math.max(0, row.otherChargesCents) +
      Math.max(0, row.unexplainedCents)
    out.pendingCents += Math.max(0, row.pendingCents)
  }
  return out
}

/**
 * El título que afirma. `period` va con su preposición: «en octubre», «en ese
 * período».
 */
export function netTitle(rows: readonly NetRowView[], period: string): string {
  const settled = rows.filter((r) => r.state !== 'pending')
  if (settled.length === 0) return `Todavía no te liquidaron nada ${period}`
  const worst = settled.find((r) => (r.discountBp ?? 0) > 0)
  if (worst?.discountBp) {
    return `${worst.name} es el que más te cuesta: se queda con ${formatCents(worst.discountBp)} de cada $ 100`
  }
  const pending = rows.some((r) => r.pendingCents > 0)
  return pending
    ? `Lo que ya te llegó ${period} vino sin descuentos`
    : `${capitalize(period)} te llegó todo lo que vendiste`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * La oración, con cada cifra por separado: no se afirma que sumen (una
 * liquidación puede ser de ventas de otro período).
 */
export function netSentence(totals: NetTotals): string {
  const sold = `Vendiste ${formatCentsShort(totals.soldCents)}.`
  const clauses: string[] = []
  if (totals.creditedCents > 0) {
    clauses.push(`ya te llegaron ${formatCentsShort(totals.creditedCents)}`)
  }
  if (totals.deductedCents > 0) {
    clauses.push(
      `te descontaron ${formatCentsShort(totals.deductedCents)} entre comisiones, impuestos y retenciones`,
    )
  }
  if (totals.pendingCents > 0) {
    clauses.push(
      totals.pendingCents === totals.soldCents && clauses.length === 0
        ? 'todo sigue en camino'
        : `${formatCentsShort(totals.pendingCents)} siguen en camino`,
    )
  }
  if (clauses.length === 0) return sold
  const first = clauses[0] ?? ''
  const rest = clauses.slice(1)
  const body =
    rest.length === 0
      ? first
      : rest.length === 1
        ? `${first} y ${rest[0]}`
        : `${first}, ${rest.slice(0, -1).join(', ')}, y ${rest.at(-1)}`
  return `${sold} ${capitalize(body)}.`
}
