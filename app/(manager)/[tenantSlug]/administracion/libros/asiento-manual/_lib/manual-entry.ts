import { formatCents } from '@/lib/money'

/**
 * La grilla del asiento manual (H.13), pura: qué línea cuenta, cuánto suma
 * cada lado (en BigInt, como la base) y qué falta antes de mandarlo. Los
 * textos son los de `manualEntrySchema` para que el formulario y el servidor
 * digan lo mismo.
 */

export type InitialLine = {
  accountId: string | null
  debitCents: number | null
  creditCents: number | null
  partyId: string | null
  dueDate: string | null
  memo: string
}

export type EntryLine = InitialLine & { key: string }

export type LineField = 'accountId' | 'debitCents' | 'creditCents' | 'partyId' | 'dueDate' | 'memo'

export function emptyLine(): InitialLine {
  return {
    accountId: null,
    debitCents: null,
    creditCents: null,
    partyId: null,
    dueDate: null,
    memo: '',
  }
}

/** Una línea que tiene algo cargado (las vacías no se mandan). */
export function hasContent(line: InitialLine): boolean {
  return (
    line.accountId !== null ||
    (line.debitCents ?? 0) !== 0 ||
    (line.creditCents ?? 0) !== 0 ||
    line.partyId !== null ||
    line.dueDate !== null ||
    line.memo.trim() !== ''
  )
}

export function entryTotals(lines: readonly InitialLine[]): { debit: bigint; credit: bigint } {
  let debit = 0n
  let credit = 0n
  for (const line of lines) {
    debit += BigInt(Math.trunc(line.debitCents ?? 0))
    credit += BigInt(Math.trunc(line.creditCents ?? 0))
  }
  return { debit, credit }
}

/** «El asiento no cuadra: falta $ 12,40 en el Haber.» (`null` si cuadra). */
export function balanceMessage(debit: bigint, credit: bigint): string | null {
  if (debit === credit) return null
  const gap = debit > credit ? debit - credit : credit - debit
  return `El asiento no cuadra: falta ${formatCents(gap)} en el ${debit > credit ? 'Haber' : 'Debe'}.`
}

export type EntryCheck =
  | { ok: true }
  | {
      ok: false
      /** Por línea (`<key>.<campo>`), `date`, `description` y `lines` (el cuadre o pocas líneas). */
      errors: Record<string, string>
      /** El primero, para el aviso de arriba de los botones. */
      message: string
      /** Lo único que falla es el cuadre: el foco va al pie. */
      onlyBalance: boolean
    }

/** Lo que falta antes de armar el asiento (H.13: no se manda si no cuadra o tiene menos de 2 líneas). */
export function validateEntry(input: {
  lines: readonly EntryLine[]
  date: string | null
  description: string
  requiresParty: (accountId: string | null) => boolean
}): EntryCheck {
  const errors: Record<string, string> = {}
  const order: string[] = []
  const put = (key: string, message: string) => {
    if (key in errors) return
    errors[key] = message
    order.push(message)
  }

  if (!input.date) put('date', 'Elegí una fecha.')
  if (!input.description.trim()) put('description', 'Escribí el concepto del asiento.')

  const content = input.lines.filter(hasContent)
  for (const line of content) {
    const debit = line.debitCents ?? 0
    const credit = line.creditCents ?? 0
    if (!line.accountId) put(`${line.key}.accountId`, 'Elegí la cuenta.')
    if (debit > 0 && credit > 0) {
      put(`${line.key}.creditCents`, 'Cada línea va en el Debe o en el Haber, no en los dos.')
    } else if (debit === 0 && credit === 0) {
      put(`${line.key}.debitCents`, 'Falta el importe de la línea.')
    }
    if (line.accountId && input.requiresParty(line.accountId) && !line.partyId) {
      put(`${line.key}.partyId`, 'Elegí el proveedor o cliente.')
    }
    if (line.dueDate && !line.partyId) {
      put(`${line.key}.dueDate`, 'El vencimiento va solo con un proveedor o cliente.')
    }
  }

  const otherProblems = order.length
  if (content.length < 2) {
    put('lines', 'Un asiento necesita al menos dos líneas.')
  } else {
    const totals = entryTotals(content)
    const unbalanced = balanceMessage(totals.debit, totals.credit)
    if (unbalanced) put('lines', unbalanced)
  }

  if (order.length === 0) return { ok: true }
  return {
    ok: false,
    errors,
    message: order[0] ?? 'Revisá lo marcado en rojo.',
    onlyBalance: otherProblems === 0 && 'lines' in errors,
  }
}
