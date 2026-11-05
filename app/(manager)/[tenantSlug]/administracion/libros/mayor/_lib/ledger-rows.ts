import { compareAccountCode } from '@/components/administracion/account-paths'
import { imputationFlagText } from '@/lib/accounting/reimpute'

/**
 * Las filas del Mayor en palabras (puro): qué dice cada renglón, cuáles van marcados y cuál es la
 * cuenta anterior y la siguiente con movimiento.
 */

type LedgerLine = {
  entryId: string | null
  entryNumber: number | null
  numberIsProvisional: boolean
  entryDate: string | null
  documentId: string | null
  documentLabel: string | null
  description: string | null
  partyName: string | null
  memo: string | null
  debitCents: number
  creditCents: number
  runningBalanceCents: number
  accountId: string | null
  accountCode: string | null
  accountName: string | null
}

export type LedgerViewRow = {
  key: string
  entryId: string | null
  /** `yyyy-MM-dd`. */
  date: string
  number: number | null
  provisional: boolean
  /** «Factura B 0012-00088123»; sin comprobante, `null`. */
  label: string | null
  /** «EPEC», sin repetir lo que ya dice el comprobante. */
  detail: string | null
  debitCents: number
  creditCents: number
  balanceCents: number
  /** «EPEC siempre va a Energía eléctrica. Tocá para reimputar.» */
  flag: string | null
}

/**
 * El detalle de un movimiento sin repetir lo que ya se lee: el comprobante («Pago · Carnicería» con
 * el comprobante «Pago» queda «Carnicería») ni el proveedor si la descripción ya lo nombra.
 */
export function lineDetail(
  row: Pick<LedgerLine, 'documentLabel' | 'description' | 'partyName' | 'memo'> & {
    accountCode?: string | null
    accountName?: string | null
  },
  isGroup: boolean,
): string | null {
  const label = row.documentLabel?.trim()
  // El comprobante ya es el título del renglón: se saca de la descripción, venga adelante
  // («Pago · Carnicería») o atrás («Tostadero Serrano SA · Factura A 0003-00004512»).
  const text = row.description?.trim()
  const description = !label
    ? text
    : text?.startsWith(`${label} · `)
      ? text.slice(label.length + 3)
      : text?.endsWith(` · ${label}`)
        ? text.slice(0, -(label.length + 3))
        : text
  const parts: string[] = []
  for (const raw of [
    // En un grupo, de qué cuenta es: el nombre alcanza («Caja», «Banco Nación»).
    isGroup ? (row.accountName ?? row.accountCode) : null,
    description,
    row.partyName,
    row.memo,
  ]) {
    const part = raw?.trim()
    // La leyenda de la línea suele ser el comprobante otra vez («Factura A 0003-00004512»).
    if (!part || part === label || parts.some((p) => p.includes(part))) continue
    parts.push(part)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

type FlagLike = {
  documentId: string
  accountId: string
  partyName: string | null
  usualAccountName: string
}

/** Las líneas del Mayor listas para dibujar. La clave no cambia cuando otra fila se va. */
export function ledgerViewRows(
  lines: readonly LedgerLine[],
  opts: {
    fallbackDate: string
    isGroup: boolean
    flags: readonly FlagLike[]
    /** El primer día de un mes abierto (`null`: ninguno cerrado). */
    firstOpenDate: string | null
  },
): LedgerViewRow[] {
  const flagOf = new Map(opts.flags.map((f) => [`${f.documentId}:${f.accountId}`, f]))
  const seen = new Map<string, number>()
  return lines.map((row) => {
    const signature = `${row.entryId ?? 'linea'}:${row.accountId ?? ''}:${row.debitCents}:${row.creditCents}`
    const occurrence = seen.get(signature) ?? 0
    seen.set(signature, occurrence + 1)
    const date = row.entryDate ?? opts.fallbackDate
    const flag = row.documentId ? flagOf.get(`${row.documentId}:${row.accountId ?? ''}`) : undefined
    return {
      key: `${signature}:${occurrence}`,
      entryId: row.entryId,
      date,
      number: row.entryNumber,
      provisional: row.numberIsProvisional,
      label: row.documentLabel?.trim() || null,
      detail: lineDetail(row, opts.isGroup),
      debitCents: row.debitCents,
      creditCents: row.creditCents,
      balanceCents: row.runningBalanceCents,
      flag: flag
        ? imputationFlagText(flag, {
            open: opts.firstOpenDate === null || date >= opts.firstOpenDate,
          })
        : null,
    }
  })
}

type TrialLike = {
  accountId: string
  code: string
  name: string
  postable: boolean
  isVirtual: boolean
  periodDebitCents: number
  periodCreditCents: number
}

export type LedgerStop = { accountId: string; code: string; name: string }

/** Las cuentas imputables con movimiento en el período, en orden de código: las paradas de ‹ ›. */
export function accountsWithMovement(rows: readonly TrialLike[]): LedgerStop[] {
  return rows
    .filter(
      (r) => r.postable && !r.isVirtual && (r.periodDebitCents !== 0 || r.periodCreditCents !== 0),
    )
    .map((r) => ({ accountId: r.accountId, code: r.code, name: r.name }))
    .sort((a, b) => compareAccountCode(a.code, b.code))
}

/**
 * La anterior y la siguiente con movimiento. Se mide por código: la cuenta que se está mirando puede
 * no tener movimiento, o ser un grupo.
 */
export function adjacentAccounts(
  stops: readonly LedgerStop[],
  currentCode: string | null,
): { prev: LedgerStop | null; next: LedgerStop | null } {
  if (currentCode === null) return { prev: null, next: stops[0] ?? null }
  let prev: LedgerStop | null = null
  let next: LedgerStop | null = null
  for (const stop of stops) {
    const order = compareAccountCode(stop.code, currentCode)
    if (order < 0) prev = stop
    else if (order > 0 && !next) next = stop
  }
  return { prev, next }
}
