/**
 * La lógica pura de `EntryEditor` (kit §3.8; asiento manual de H.13): líneas,
 * «una línea es de un solo lado», lo que frena el envío y el JSON que viaja al
 * server. Sin React, con tests.
 */

import { type BalanceLine, balanceGap } from '@/lib/accounting/balance'
import { accErrorMessage } from '@/lib/accounting/errors'
import type { Side } from '@/lib/accounting/types'
import { formatCents } from '@/lib/money/format'
import type { AccountNode } from './account-tree'
import { hasAmount, SIDE_LABEL } from './entry-balance'
import type { EntryLine } from './entry-preview'
import { defaultLineLabel } from './line-items-model'

export type EntryEditorLine = {
  key: string
  accountId: string | null
  debitCents: number | null
  creditCents: number | null
  /** La leyenda del renglón (`memo` en el server). */
  note?: string
  /** El partícipe, solo en cuentas de control. */
  partyId?: string | null
  /** El vencimiento de la partida, solo en cuentas de control (`'yyyy-MM-dd'`). */
  dueDate?: string | null
}

/** Una línea vacía. */
export function emptyEntryLine(key: string): EntryEditorLine {
  return { key, accountId: null, debitCents: null, creditCents: null, note: '' }
}

/** Las líneas de arranque: `count` vacías con keys fijas (iguales en el server y en el cliente). */
export function initialEntryLines(count = 2): EntryEditorLine[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => emptyEntryLine(`l${i.toString()}`))
}

/**
 * «Una línea es de un solo lado»: escribir un importe en el Debe vacía el
 * Haber de esa línea, y al revés. Un importe vacío (o cero) no toca el otro lado.
 */
export function amountPatch(side: Side, cents: number | null): Partial<EntryEditorLine> {
  if (side === 'debit') {
    return cents !== null && cents > 0
      ? { debitCents: cents, creditCents: null }
      : { debitCents: cents }
  }
  return cents !== null && cents > 0
    ? { creditCents: cents, debitCents: null }
    : { creditCents: cents }
}

/** Al cambiar de cuenta: si la nueva no lleva partícipe, se van el partícipe y el vencimiento. */
export function accountPatch(
  accountId: string | null,
  account: Pick<AccountNode, 'requiresParty'> | null,
): Partial<EntryEditorLine> {
  if (account?.requiresParty) return { accountId }
  return { accountId, partyId: null, dueDate: null }
}

/** ¿La línea está vacía del todo? (no viaja al server). */
export function isBlankEntryLine(line: EntryEditorLine): boolean {
  return (
    line.accountId === null &&
    !hasAmount(line.debitCents) &&
    !hasAmount(line.creditCents) &&
    (line.note ?? '').trim() === '' &&
    !line.partyId
  )
}

/**
 * Lo que frena el envío de un asiento: el mismo texto que devuelve el server
 * (`entry_not_balanced` / `entry_too_few_lines`), o `null` si se puede mandar.
 *
 * - Menos de dos líneas con importe: «Un asiento necesita al menos dos líneas.»
 * - No cuadra: «El asiento no cuadra: falta $ 12,40 en el Haber.»
 */
export function entryBlockMessage(lines: readonly BalanceLine[], minLines = 2): string | null {
  const withAmount = lines.filter((line) => {
    if ('side' in line) return hasAmount(line.amountCents)
    return hasAmount(line.debitCents) || hasAmount(line.creditCents)
  }).length
  if (withAmount < minLines) return accErrorMessage('entry_too_few_lines')
  const gap = balanceGap(lines)
  if (gap === null) return null
  return accErrorMessage('entry_not_balanced', {
    diferencia: formatCents(gap.cents),
    lado: SIDE_LABEL[gap.side],
  })
}

/**
 * Lo que frena el envío del `EntryEditor`, o `null` (los textos son los del server):
 * 1. una línea con cuenta y sin importe: «Falta el importe de la línea 3.»
 * 2. menos de dos líneas con importe: «Un asiento necesita al menos dos líneas.»
 * 3. no cuadra: «El asiento no cuadra: falta $ 12,40 en el Haber.»
 */
export function entryEditorBlockMessage(
  lines: readonly EntryEditorLine[],
  lineLabel: (index: number) => string = defaultLineLabel,
): string | null {
  const missing = lines.findIndex(
    (line) =>
      line.accountId !== null && !hasAmount(line.debitCents) && !hasAmount(line.creditCents),
  )
  if (missing !== -1) {
    const label = lineLabel(missing)
    return `Falta el importe de la ${label.charAt(0).toLowerCase()}${label.slice(1)}.`
  }
  return entryBlockMessage(lines)
}

/** Una línea como la lee `manualLineSchema` (lib/accounting/schemas.ts). */
export type SerializedEntryLine = {
  accountId: string | null
  debitCents: number | null
  creditCents: number | null
  partyId: string | null
  dueDate: string | null
  memo: string | null
}

/** El JSON canónico del `hidden`: sin keys, sin las líneas vacías, `note` → `memo`. */
export function serializeEntryLines(lines: readonly EntryEditorLine[]): SerializedEntryLine[] {
  return lines
    .filter((line) => !isBlankEntryLine(line))
    .map((line) => ({
      accountId: line.accountId,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
      partyId: line.partyId ?? null,
      dueDate: line.dueDate ?? null,
      memo: line.note?.trim() ? line.note.trim() : null,
    }))
}

/**
 * Las líneas como las dibuja `EntryPreview` (solo lectura: rol Contabilidad o
 * período cerrado). Una cuenta que no está en el plan cargado se ve con «?».
 */
export function entryLinesForPreview(
  lines: readonly EntryEditorLine[],
  accountsById: ReadonlyMap<string, AccountNode>,
  partyNames: Readonly<Record<string, string>> = {},
): EntryLine[] {
  return lines
    .filter((line) => !isBlankEntryLine(line))
    .map((line) => {
      const account = line.accountId ? accountsById.get(line.accountId) : undefined
      return {
        id: line.key,
        accountCode: account?.code ?? '?',
        accountName: account?.name ?? 'Cuenta sin elegir',
        debitCents: line.debitCents,
        creditCents: line.creditCents,
        note: line.note ?? null,
        partyName: line.partyId ? (partyNames[line.partyId] ?? null) : null,
        dueDate: line.dueDate ?? null,
      }
    })
}
