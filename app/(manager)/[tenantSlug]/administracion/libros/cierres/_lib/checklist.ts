import { isCloseWarningKey } from '@/lib/accounting/close-warnings'
import { CLOSE_WARNING_COPY } from '@/lib/accounting/errors'
import { addDays, formatDayMonth, formatIsoDay, formatMonthLabel } from '@/lib/dates'
import { formatCents } from '@/lib/money'

/**
 * El checklist del cierre en palabras (H.15, F.13): cada bloqueo, aviso o
 * dato con su texto, un detalle que lo ubica («Faltan los cierres del 04/10 y
 * 11/10») y el link para resolverlo. Puro: lo prueban los tests. Nunca muestra
 * una clave cruda: lo que no se reconoce se dice en general.
 */

export type ChecklistItemLike = {
  key: string
  label: string
  detail: Readonly<Record<string, unknown>>
  amountCents: number | null
  count: number | null
}

export type ChecklistLine = {
  key: string
  text: string
  /** Lo que ubica el aviso (días, cajas, gastos fijos). */
  detail: string | null
  href: string | null
  linkLabel: string | null
}

const MAX_LISTED = 5

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    : []
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim())
  return null
}

/** «04/10, 11/10 y 12/10» (y «y 3 más» si son muchos). */
export function listText(items: readonly string[]): string {
  const shown = items.slice(0, MAX_LISTED)
  const rest = items.length - shown.length
  if (shown.length === 0) return ''
  if (rest > 0) return `${shown.join(', ')} y ${rest} más`
  if (shown.length === 1) return shown[0] ?? ''
  return `${shown.slice(0, -1).join(', ')} y ${shown.at(-1)}`
}

function isRawKey(item: ChecklistItemLike): boolean {
  return !item.label || item.label === item.key
}

/**
 * Un aviso del cierre (C.5.1 paso 4) con su detalle y el link para resolverlo.
 * Si la línea trae su detalle (los días, las cajas, los gastos fijos), el texto
 * es el general del aviso: el `label` del checklist ya los nombra y se leerían
 * dos veces («Faltan los cierres del 03/10 y 04/10» + «Faltan los del 03/10 y
 * 04/10»). Sin detalle, el `label` tal cual.
 */
export function warningLine(item: ChecklistItemLike, base: string): ChecklistLine {
  const line = warningLineRaw(item, base)
  return line.detail !== null && isCloseWarningKey(item.key)
    ? { ...line, text: CLOSE_WARNING_COPY[item.key] }
    : line
}

function warningLineRaw(item: ChecklistItemLike, base: string): ChecklistLine {
  const d = item.detail
  const text = isRawKey(item) ? 'Hay algo para revisar antes de cerrar.' : item.label
  const count = item.count ?? num(d.count)
  const amount = item.amountCents ?? num(d.amount_cents)
  switch (item.key) {
    case 'missing_daily_closes': {
      const dates = strings(d.dates).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))
      return {
        key: item.key,
        text,
        detail: dates.length > 0 ? `Faltan los del ${listText(dates.map(formatDayMonth))}.` : null,
        href: dates[0] ? `${base}/ventas/cierre?fecha=${dates[0]}` : `${base}/ventas/cierre`,
        linkLabel: 'Cargar',
      }
    }
    case 'receivables_overdue':
      return {
        key: item.key,
        text,
        detail:
          count !== null && amount !== null
            ? `${count === 1 ? '1 partida' : `${count} partidas`} por ${formatCents(amount)}.`
            : null,
        href: `${base}/ventas?tab=clientes`,
        linkLabel: 'Ver',
      }
    case 'treasury_negative': {
      const list = records(d.treasuries).map((t) => {
        const name = typeof t.name === 'string' ? t.name : 'Caja'
        const balance = num(t.balance_cents)
        return balance === null ? name : `${name} (descubierto ${formatCents(Math.abs(balance))})`
      })
      return {
        key: item.key,
        text,
        detail: list.length > 0 ? `${listText(list)}.` : null,
        href: `${base}/cajas`,
        linkLabel: 'Ver cajas',
      }
    }
    case 'treasuries_not_reconciled': {
      const names = records(d.treasuries)
        .map((t) => (typeof t.name === 'string' ? t.name : null))
        .filter((n): n is string => n !== null)
      return {
        key: item.key,
        text,
        detail: names.length > 0 ? `Sin ajustar: ${listText(names)}.` : null,
        href: `${base}/cajas`,
        linkLabel: 'Ajustar saldos',
      }
    }
    case 'vat_pending_documentation':
      return {
        key: item.key,
        text,
        detail: amount !== null ? `${formatCents(amount)} sin la factura de la comisión.` : null,
        href: `${base}/compras/nueva`,
        linkLabel: 'Cargar la factura',
      }
    case 'recurring_not_loaded': {
      const names = records(d.items).map((r) => {
        const name = typeof r.name === 'string' ? r.name : 'Gasto fijo'
        const due = typeof r.due_date === 'string' ? r.due_date.slice(0, 10) : null
        return due ? `${name} (vence ${formatDayMonth(due)})` : name
      })
      return {
        key: item.key,
        text,
        detail: names.length > 0 ? `${listText(names)}.` : null,
        href: `${base}/compras?tab=gastos-fijos`,
        linkLabel: 'Ver gastos fijos',
      }
    }
    case 'tickets_without_vendor':
      return {
        key: item.key,
        text,
        detail:
          count !== null && amount !== null
            ? `${count === 1 ? '1 tique' : `${count} tiques`} por ${formatCents(amount)}.`
            : null,
        href: `${base}/compras?tab=comprobantes`,
        linkLabel: 'Ver',
      }
    case 'sas_cuit_missing':
      return {
        key: item.key,
        text,
        detail: null,
        href: `${base}/ajustes?tab=sas`,
        linkLabel: 'Completar',
      }
    default:
      return { key: item.key, text, detail: null, href: null, linkLabel: null }
  }
}

/** Lo que no deja cerrar (orden, mes sin terminar, apertura pendiente). */
export function blockerLine(
  item: ChecklistItemLike,
  base: string,
  month: { first: string; endsOn: string | null },
): ChecklistLine {
  switch (item.key) {
    case 'month_not_finished': {
      const from = month.endsOn ? addDays(month.endsOn, 1) : null
      return {
        key: item.key,
        text: from
          ? `${formatMonthLabel(month.first)} todavía no terminó: se puede cerrar desde el ${formatIsoDay(from)}.`
          : `${formatMonthLabel(month.first)} todavía no terminó.`,
        detail: null,
        href: null,
        linkLabel: null,
      }
    }
    case 'opening_pending':
      return {
        key: item.key,
        text: isRawKey(item)
          ? 'Antes de cerrar el primer mes, cargá los saldos iniciales o elegí «Arrancar en cero».'
          : item.label,
        detail: null,
        href: `${base}/configurar`,
        linkLabel: 'Cargar saldos iniciales',
      }
    default:
      return {
        key: item.key,
        text: isRawKey(item) ? 'Hay algo que no deja cerrar este mes todavía.' : item.label,
        detail: null,
        href: null,
        linkLabel: null,
      }
  }
}

/** Datos para tener en cuenta (no frenan el cierre). `null` si no se reconoce. */
export function infoLine(item: ChecklistItemLike): ChecklistLine | null {
  if (item.key === 'opening_equity_unassigned' || item.key === 'opening_unassigned') {
    const amount = item.amountCents ?? num(item.detail.amount_cents)
    return {
      key: item.key,
      text:
        amount !== null && amount !== 0
          ? `Hay ${formatCents(Math.abs(amount))} de patrimonio inicial sin asignar: lo revisa la contadora.`
          : 'Hay patrimonio inicial sin asignar: lo revisa la contadora.',
      detail: null,
      href: null,
      linkLabel: null,
    }
  }
  if (isRawKey(item)) return null
  return { key: item.key, text: item.label, detail: null, href: null, linkLabel: null }
}
