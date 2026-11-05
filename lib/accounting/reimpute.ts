import { z } from 'zod'

/**
 * Reimputar (Silvia, reunión del 29/10: «entrar al asiento que originó ese movimiento y cambiarle el
 * número de cuenta»): qué renglón se puede cambiar, a qué cuenta, y cómo se dice lo que la base marca.
 * Puro y sin `server-only`: lo usan el panel del asiento, las fichas y la acción. La base lo vuelve a
 * decidir en `acc_reimpute_line`; acá solo se decide qué se ofrece.
 */

/** Los renglones de imputación: nunca una caja, una partida de proveedor ni el IVA. */
export const REIMPUTABLE_ROLES = [
  'net',
  'gross',
  'non_taxed',
  'exempt',
  'internal_tax',
  'manual',
  'counterpart',
] as const

const ROLES: ReadonlySet<string> = new Set(REIMPUTABLE_ROLES)

export function isReimputableLine(
  line: { role: string; partyId: string | null; treasuryAccountId: string | null },
  account: { requiresParty: boolean; isTreasury: boolean },
): boolean {
  return (
    ROLES.has(line.role) &&
    line.partyId === null &&
    line.treasuryAccountId === null &&
    !account.requiresParty &&
    !account.isTreasury
  )
}

/** A qué cuentas se puede pasar un renglón (la misma regla de `line_account_invalid`). */
export function isReimputeTarget(account: {
  postable: boolean
  active: boolean
  isTreasury: boolean
  requiresParty: boolean
}): boolean {
  return account.postable && account.active && !account.isTreasury && !account.requiresParty
}

export const REIMPUTE_REASON_MAX = 300

export const reimputeSchema = z.strictObject({
  lineId: z.uuid('Elegí el renglón.'),
  accountId: z.uuid('Elegí la cuenta.'),
  reason: z
    .string('El motivo tiene que ser un texto.')
    .trim()
    .max(REIMPUTE_REASON_MAX, 'El motivo puede tener hasta 300 caracteres.')
    .nullish()
    .transform((value) => (value ? value : null)),
})

export type ReimputeInput = z.input<typeof reimputeSchema>

/** Un renglón cuya cuenta no es la habitual de su proveedor o gasto fijo. */
export type ImputationFlagText = { partyName: string | null; usualAccountName: string }

/** «EPEC siempre va a Energía eléctrica. Tocá para reimputar.» */
export function imputationFlagText(flag: ImputationFlagText, opts: { open: boolean }): string {
  const who = flag.partyName?.trim() || 'Este proveedor'
  const base = `${who} siempre va a ${flag.usualAccountName}.`
  return opts.open ? `${base} Tocá para reimputar.` : `${base} Ese mes está cerrado.`
}

/** «Reimputada a Energía eléctrica. Quedó en el historial.» */
export function reimputedMessage(toName: string): string {
  return `Reimputada a ${toName}. Quedó en el historial.`
}

export const REIMPUTE_CLOSED_MESSAGE =
  'Este mes está cerrado. Reabrilo o hacé un asiento de ajuste.'

// ─── Qué se ofrece en cada comprobante ───────────────────────────────────────

/** Un renglón que se puede reimputar, con lo que hace falta para mostrarlo. */
export type ReimputeTarget = {
  /** El renglón del comprobante (`acc_document_lines.id`): lo que recibe `acc_reimpute_line`. */
  lineId: string
  accountId: string
  accountCode: string
  accountName: string
  side: 'debit' | 'credit'
  amountCents: number
  /** Si la cuenta no es la habitual: cuál es y de quién («EPEC siempre va a Energía eléctrica»). */
  usual: { accountId: string; accountName: string; partyName: string | null } | null
}

type TargetLine = {
  id: string
  role: string
  accountId: string
  accountCode: string
  accountName: string
  side: 'debit' | 'credit'
  amountCents: number
  partyId: string | null
  treasuryAccountId: string | null
}

type TargetAccount = { requiresParty: boolean; isTreasury: boolean }

type TargetFlag = {
  documentLineId: string
  usualAccountId: string
  usualAccountName: string
  partyName: string | null
}

/**
 * Los renglones de un comprobante vigente que se pueden reimputar; los que la base marcó como raros
 * van primero (son los que se vienen a cambiar). Una cuenta que no se encuentra no se ofrece: la base
 * la rechazaría igual.
 */
export function reimputeTargets(
  doc: { status: 'posted' | 'voided'; lines: readonly TargetLine[] },
  accounts: ReadonlyMap<string, TargetAccount>,
  flags: readonly TargetFlag[],
): ReimputeTarget[] {
  if (doc.status !== 'posted') return []
  const flagOf = new Map(flags.map((f) => [f.documentLineId, f]))
  const targets: ReimputeTarget[] = []
  for (const line of doc.lines) {
    const account = accounts.get(line.accountId)
    if (!account || !isReimputableLine(line, account)) continue
    const flag = flagOf.get(line.id)
    targets.push({
      lineId: line.id,
      accountId: line.accountId,
      accountCode: line.accountCode,
      accountName: line.accountName,
      side: line.side,
      amountCents: line.amountCents,
      usual: flag
        ? {
            accountId: flag.usualAccountId,
            accountName: flag.usualAccountName,
            partyName: flag.partyName,
          }
        : null,
    })
  }
  return targets.sort((a, b) => Number(b.usual !== null) - Number(a.usual !== null))
}

/**
 * El plan entero para el buscador de cuentas: los grupos arman la ruta y solo se eligen las que sirven
 * (la misma forma que el buscador del asiento manual).
 */
export function reimputeAccountOptions<
  T extends {
    id: string
    code: string
    name: string
    parentId: string | null
    postable: boolean
    active: boolean
    isTreasury: boolean
    requiresParty: boolean
    description: string | null
  },
>(accounts: readonly T[]) {
  return accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    parentId: a.parentId,
    postable: isReimputeTarget(a),
    active: a.active,
    description: a.description,
  }))
}
