import { formatDayMonth } from '@/lib/dates/format'
import { formatCents } from '@/lib/money/format'
import { CLOSE_WARNING_COPY } from './errors'
import { CLOSE_WARNING_KEYS, type CloseWarningKey } from './types'

/**
 * Los avisos del cierre de mes (C.5.1 paso 4) en palabras, con sus números.
 * Puro: lo usan el checklist (`acc_report_close_checklist` → `warnings`) y el
 * error `close_warnings` de `acc_close_period` (`detail.warnings`), que traen
 * las mismas claves y los mismos datos (#10, parte 2):
 *
 * - `missing_daily_closes` `{count, dates: ['yyyy-MM-dd'…]}`
 * - `receivables_overdue` `{count, amount_cents}`
 * - `treasury_negative` `{count, treasuries: [{treasury_id, name, balance_cents}]}` (Debe − Haber)
 * - `treasuries_not_reconciled` `{count, treasuries: [{treasury_id, name, last_checked_on}]}`
 * - `vat_pending_documentation` `{count, amount_cents}`
 * - `recurring_not_loaded` `{count, items: [{recurring_id, name, due_date, amount_cents}]}`
 * - `tickets_without_vendor` `{count, amount_cents}`
 * - `sas_cuit_missing` (sin datos)
 *
 * Sin datos (o con datos que no se entienden), el texto general de
 * `CLOSE_WARNING_COPY`. Nunca un signo menos pelado: una caja en negativo
 * «quedó en descubierto por $ X».
 */

type Rec = Readonly<Record<string, unknown>>

export function isCloseWarningKey(value: unknown): value is CloseWarningKey {
  return typeof value === 'string' && (CLOSE_WARNING_KEYS as readonly string[]).includes(value)
}

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim())
  return null
}

function records(value: unknown): Rec[] {
  return Array.isArray(value)
    ? value.filter((v): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v))
    : []
}

/** Los nombres de una lista de la base (`[{name, …}]`), sin vacíos. */
function namesOf(value: unknown): string[] {
  return records(value)
    .map((row) => (typeof row.name === 'string' ? row.name.trim() : ''))
    .filter((name) => name !== '')
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** `['03/10', '04/10', '11/10']` → «03/10, 04/10 y 11/10». */
function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`
}

/** El texto de un aviso del cierre con sus números; sin datos, el general. */
export function closeWarningText(key: CloseWarningKey, detail: Rec = {}): string {
  const count = num(detail.count)
  const amount = num(detail.amount_cents)
  switch (key) {
    case 'missing_daily_closes': {
      const days = (Array.isArray(detail.dates) ? detail.dates : [])
        .map((d) => (typeof d === 'string' ? formatDayMonth(d.slice(0, 10)) : ''))
        .filter((d) => d !== '')
      const n = count ?? days.length
      if (n <= 0) break
      if (n === 1 && days[0]) return `Falta el cierre del día del ${days[0]}.`
      if (days.length === n && n <= 4) return `Faltan los cierres del día del ${joinList(days)}.`
      return days[0]
        ? `Faltan ${n} cierres del día (el primero, del ${days[0]}).`
        : `Faltan ${n} cierres del día.`
    }
    case 'receivables_overdue':
      if (count !== null && count > 0 && amount !== null) {
        return `Hay ${plural(count, 'acreditación atrasada', 'acreditaciones atrasadas')} de tarjetas, billeteras o plataformas por ${formatCents(Math.abs(amount))}.`
      }
      break
    case 'treasury_negative': {
      const list = records(detail.treasuries)
      const names = namesOf(detail.treasuries)
      const balance = list.length === 1 ? num(list[0]?.balance_cents) : null
      if (names.length === 1 && balance !== null && balance !== 0) {
        return `${names[0]} quedó en descubierto por ${formatCents(Math.abs(balance))} al último día del mes.`
      }
      if (names.length === 1) return `${names[0]} quedó en descubierto al último día del mes.`
      if (names.length > 1) {
        return `${joinList(names)} quedaron en descubierto al último día del mes.`
      }
      break
    }
    case 'treasuries_not_reconciled': {
      const names = namesOf(detail.treasuries)
      if (names.length > 0) return `Sin «Ajustar saldo» en el mes: ${joinList(names)}.`
      break
    }
    case 'vat_pending_documentation':
      if (amount !== null && amount !== 0) {
        return `Hay ${formatCents(Math.abs(amount))} de IVA de comisiones a documentar con más de 45 días: falta la factura.`
      }
      break
    case 'recurring_not_loaded': {
      const names = namesOf(detail.items)
      if (names.length > 0 && names.length <= 4) {
        return `Gastos fijos del mes sin cargar: ${joinList(names)}.`
      }
      if (names.length > 4) return `Hay ${names.length} gastos fijos del mes sin cargar.`
      break
    }
    case 'tickets_without_vendor':
      if (count !== null && count > 0) {
        const money = amount !== null && amount !== 0 ? ` (${formatCents(Math.abs(amount))})` : ''
        return `Hay ${plural(count, 'tique', 'tiques')} sin comercio${money}: no entran al Libro IVA.`
      }
      break
    case 'sas_cuit_missing':
      break
  }
  return CLOSE_WARNING_COPY[key]
}
