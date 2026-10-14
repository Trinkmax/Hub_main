/**
 * «Mercado Pago contra tus cierres»: con lo que trae un reporte de Mercado Pago
 * ya subido, cuánto cobró cada día contra lo que se anotó en el cierre de ese
 * día, y de lo cobrado cuánto quedó después de comisiones e impuestos.
 *
 * Por qué existe: es el paso a paso del bar sin punto de venta. El archivo dice
 * qué días falta anotar el cierre, y la diferencia de un día salta a la vista
 * en un dibujo (en una tabla hay que restar).
 *
 * Un día sin cierre NO es cero: se marca como que falta. Puro (sin React): sale
 * de los `summary.detail` de las hojas de cobro (`mp_collection`).
 */

import { capitalizeFirst, formatWeekdayDayMonth, isRealIsoDay } from '@/lib/dates'
import type { ProposalStatus, ProposalSummary } from '@/lib/imports/server/types'
import { formatCents, formatCentsShort } from '@/lib/money'

/** Con más hojas que estas el reporte no se lee de una vez y el panel no se dibuja. */
export const MP_INSIGHTS_LIMIT = 500
/** Desde cuánto una diferencia con el cierre se nombra (centavos): $ 1.000. */
export const MP_DIFF_TOLERANCE_CENTS = 100_000

export type MpProposal = {
  status: ProposalStatus
  summary: Pick<ProposalSummary, 'kind' | 'date' | 'detail' | 'notes'>
}

export type MpDay = {
  /** `yyyy-MM-dd`. */
  date: string
  /** «mié 08/10». */
  label: string
  /** Lo que cobró Mercado Pago ese día (bruto). */
  collectedCents: number
  /** Lo anotado en el cierre de ese día; `null` si falta el cierre. */
  closeCents: number | null
  /** Cobrado menos cierre; `null` si falta el cierre. */
  diffCents: number | null
}

function num(detail: ProposalSummary['detail'], key: string): number {
  const v = detail?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? Math.abs(v) : 0
}

/** Las hojas de cobro que traen plata (una salteada sin detalle no cuenta). */
function collections(proposals: readonly MpProposal[]): MpProposal[] {
  return proposals.filter(
    (p) =>
      p.summary.kind === 'mp_collection' &&
      isRealIsoDay(p.summary.date) &&
      num(p.summary.detail, 'gross_cents') > 0,
  )
}

/** Un día por columna: lo que cobró Mercado Pago y lo que dice el cierre de ese día. */
export function mpDays(proposals: readonly MpProposal[]): MpDay[] {
  const byDay = new Map<string, { collected: number; close: number; withClose: number }>()
  for (const p of collections(proposals)) {
    const day = byDay.get(p.summary.date) ?? { collected: 0, close: 0, withClose: 0 }
    day.collected += num(p.summary.detail, 'gross_cents')
    if (!(p.summary.notes ?? []).includes('missing_close')) {
      day.close += num(p.summary.detail, 'close_cents')
      day.withClose++
    }
    byDay.set(p.summary.date, day)
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, d]) => ({
      date,
      label: formatWeekdayDayMonth(date),
      collectedCents: d.collected,
      closeCents: d.withClose > 0 ? d.close : null,
      diffCents: d.withClose > 0 ? d.collected - d.close : null,
    }))
}

export type MpDaysSummary = {
  /** El título del dibujo: afirma. */
  title: string
  /** Días en que coincide (diferencia de hasta $ 1.000). */
  matched: number
  /** Días con una diferencia mayor. */
  off: number
  /** Días a los que les falta el cierre. */
  missing: MpDay[]
}

function daysWord(n: number): string {
  return n === 1 ? '1 día' : `${n} días`
}

export function mpDaysSummary(days: readonly MpDay[]): MpDaysSummary {
  const missing = days.filter((d) => d.closeCents === null)
  const off = days.filter(
    (d) => d.diffCents !== null && Math.abs(d.diffCents) > MP_DIFF_TOLERANCE_CENTS,
  ).length
  const matched = days.length - missing.length - off
  const title =
    days.length === 0
      ? 'Este reporte no trae cobros'
      : missing.length === days.length
        ? days.length === 1
          ? `Falta el cierre del ${days[0]?.label ?? 'día de este reporte'}`
          : `Falta el cierre de los ${days.length} días de este reporte`
        : off > 0
          ? `En ${daysWord(off)} la diferencia pasa de ${formatCentsShort(MP_DIFF_TOLERANCE_CENTS)}`
          : missing.length > 0
            ? `Mercado Pago coincide con tus cierres en ${matched} de ${daysWord(days.length)}`
            : days.length === 1
              ? 'Mercado Pago coincide con tu cierre de ese día'
              : `Mercado Pago coincide con tus cierres en los ${days.length} días`
  return { title, matched, off, missing }
}

export type MpCutPart = {
  key: 'net' | 'commission' | 'commission_vat' | 'retained' | 'bank_tax' | 'other'
  label: string
  cents: number
}

export type MpCut = {
  grossCents: number
  netCents: number
  /** Las partes de lo cobrado, la primera lo que quedó. Solo las que tienen plata. */
  parts: MpCutPart[]
  /** De cada $ 100 cobrados, cuánto quedó (en centavos); `null` sin cobros. */
  perHundredCents: number | null
  title: string
  sentence: string
}

/**
 * De lo que cobraste por Mercado Pago, cuánto te quedó y en qué se fue el
 * resto. Lo que no se puede nombrar va a «Otros descuentos»: las partes siempre
 * suman lo cobrado.
 */
export function mpCut(proposals: readonly MpProposal[]): MpCut | null {
  const rows = collections(proposals)
  if (rows.length === 0) return null
  const sum = (key: string) => rows.reduce((acc, p) => acc + num(p.summary.detail, key), 0)
  const gross = sum('gross_cents')
  const net = Math.min(sum('net_cents'), gross)
  const commission = sum('commission_cents')
  const commissionVat = sum('commission_vat_cents')
  const retained = sum('sirtac_cents') + sum('sircupa_cents')
  const bankTax = sum('ley25413_cents')
  const other = Math.max(0, gross - net - commission - commissionVat - retained - bankTax)
  const all: MpCutPart[] = [
    { key: 'net', label: 'Te depositaron', cents: net },
    { key: 'commission', label: 'Comisión', cents: commission },
    { key: 'commission_vat', label: 'IVA de la comisión', cents: commissionVat },
    { key: 'retained', label: 'Retenciones de Ingresos Brutos', cents: retained },
    { key: 'bank_tax', label: 'Impuesto al cheque', cents: bankTax },
    { key: 'other', label: 'Otros descuentos', cents: other },
  ]
  const perHundred = gross > 0 ? Math.round((net * 10_000) / gross) : null
  return {
    grossCents: gross,
    netCents: net,
    parts: all.filter((p) => p.cents > 0),
    perHundredCents: perHundred,
    title:
      perHundred === null
        ? 'Lo que cobraste por Mercado Pago'
        : `De cada ${formatCentsShort(10_000)} que cobraste por Mercado Pago, te quedaron ${formatCents(perHundred)}`,
    sentence: `Cobraste ${formatCentsShort(gross)} y te depositaron ${formatCentsShort(net)}. La diferencia son comisiones, su IVA e impuestos.`,
  }
}

/** «Mié 08/10», para la píldora «Falta el cierre: …». */
export function mpDayTitle(day: MpDay): string {
  return capitalizeFirst(day.label)
}
