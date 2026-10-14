/**
 * Lo puro de la hoja «Otra entrada o salida» (el vale de caja): las
 * situaciones entre las que se elige («Un socio sacó plata»), el par
 * `direction` + `shortcut` que escribe cada una, y los textos del vale. Sin
 * React; lo prueba `tests/lib/administracion-hojas-cajas.test.ts`.
 *
 * Antes se elegía en dos pasos («¿Entró o salió?» y «¿Por qué?»). Ahora es una
 * sola pregunta, pero cada situación escribe EXACTAMENTE uno de los pares que
 * ya existían: no se inventa ninguna combinación nueva.
 */

import type { SheetTreasury } from '../cajas-ventas/types'

export type MoveDirection = 'in' | 'out'
export type MoveMotive =
  | 'partner_withdrawal'
  | 'partner_contribution'
  | 'mp_yield'
  | 'loan_received'
  | 'deposit_received'
  | 'other'

export type Situation = {
  /** `direction:shortcut`: único. */
  key: string
  direction: MoveDirection
  motive: MoveMotive
  /** La píldora: «Un socio sacó plata». */
  label: string
  /** El renglón «Qué» del vale: «Retiro de un socio». */
  what: string
}

export type SituationGroup = { direction: MoveDirection; label: string; items: Situation[] }

/** La cuenta que sugiere cada motivo (E.5.12); con «otra», la elige la persona. */
export const MOTIVE_ACCOUNT: Readonly<Partial<Record<MoveMotive, string>>> = {
  partner_withdrawal: 'partners_current',
  partner_contribution: 'partners_current',
  mp_yield: 'interest_income',
  loan_received: 'bank_loans',
  deposit_received: 'customer_deposits',
}

function situation(
  direction: MoveDirection,
  motive: MoveMotive,
  label: string,
  what: string,
): Situation {
  return { key: `${direction}:${motive}`, direction, motive, label, what }
}

/**
 * Las situaciones del bar, en dos grupos. «Un cliente dejó una seña» existe
 * solo si está el partícipe de señas; «Rindió…» solo si el bar tiene una
 * billetera (con varias no se nombra ninguna: se elige después).
 */
export function situationGroups(input: {
  treasuries: readonly Pick<SheetTreasury, 'kind' | 'name'>[]
  hasDeposits: boolean
}): SituationGroup[] {
  const wallets = input.treasuries.filter((t) => t.kind === 'wallet')
  const only = wallets.length === 1 ? wallets[0] : undefined
  const walletName = only ? only.name : 'una billetera'
  return [
    {
      direction: 'out',
      label: 'Salió plata',
      items: [
        situation('out', 'partner_withdrawal', 'Un socio sacó plata', 'Retiro de un socio'),
        situation('out', 'other', 'Otra salida', 'Otra salida'),
      ],
    },
    {
      direction: 'in',
      label: 'Entró plata',
      items: [
        situation('in', 'partner_contribution', 'Un socio puso plata', 'Aporte de un socio'),
        ...(input.hasDeposits
          ? [situation('in', 'deposit_received', 'Un cliente dejó una seña', 'Seña de un cliente')]
          : []),
        ...(wallets.length > 0
          ? [situation('in', 'mp_yield', `Rindió ${walletName}`, `Rindió ${walletName}`)]
          : []),
        situation('in', 'loan_received', 'Entró un préstamo', 'Préstamo recibido'),
        situation('in', 'other', 'Otra entrada', 'Otra entrada'),
      ],
    },
  ]
}

/** Las situaciones, en una sola lista. */
export function situations(input: Parameters<typeof situationGroups>[0]): Situation[] {
  return situationGroups(input).flatMap((g) => g.items)
}

/**
 * ¿Sigue valiendo este motivo con esta caja? «Rindió…» es de una billetera:
 * vale mientras la caja elegida sea una billetera (o todavía no se haya
 * elegido: ahí la hoja ofrece solo billeteras). El resto vale siempre que
 * exista como situación.
 */
export function motiveStillValid(
  direction: MoveDirection | null,
  motive: MoveMotive | null,
  treasuryKind: SheetTreasury['kind'] | null,
  available: readonly Situation[],
): boolean {
  if (direction === null || motive === null) return true
  if (!available.some((s) => s.direction === direction && s.motive === motive)) return false
  if (motive === 'mp_yield') return treasuryKind === null || treasuryKind === 'wallet'
  return true
}

/**
 * A qué caja pasa la hoja al elegir «Rindió…»: la única billetera del bar; con
 * varias, ninguna (se elige entre las billeteras); si ya había una billetera
 * elegida, se queda. Con cualquier otra situación, la caja no cambia.
 */
export function treasuryForSituation(
  picked: Situation,
  current: Pick<SheetTreasury, 'id' | 'kind'> | null | undefined,
  treasuries: readonly Pick<SheetTreasury, 'id' | 'kind'>[],
): string | null {
  if (picked.motive !== 'mp_yield') return current?.id ?? null
  if (current?.kind === 'wallet') return current.id
  const wallets = treasuries.filter((t) => t.kind === 'wallet')
  return wallets.length === 1 ? (wallets[0]?.id ?? null) : null
}

/** «¿De qué caja salió?» · «¿A qué caja entró?» · «¿Qué caja?» (todavía sin situación). */
export function treasuryQuestion(direction: MoveDirection | null): string {
  if (direction === 'out') return '¿De qué caja salió?'
  if (direction === 'in') return '¿A qué caja entró?'
  return '¿Qué caja?'
}

/** La pregunta de la categoría, cuando hay que elegirla. */
export function accountQuestion(direction: MoveDirection | null): string {
  return direction === 'in' ? '¿De qué es esta plata?' : '¿En qué se fue?'
}

/** Lo que NO va en esta hoja, dicho al elegir «otra». `null` con un motivo conocido. */
export function otherWarning(
  direction: MoveDirection | null,
  motive: MoveMotive | null,
): string | null {
  if (motive !== 'other') return null
  if (direction === 'out') {
    return 'Si fue una compra o un gasto del bar, cargalo como gasto: queda en su categoría y con su papel, tenga factura o no.'
  }
  if (direction === 'in') {
    return 'La plata de las ventas va en el cierre del día. Si te pagó un cliente, una tarjeta o una app, es «Me entró plata».'
  }
  return null
}

const TOTAL_LABEL_NAME_MAX = 22

/** El rótulo del total del vale: «Salen de Caja» · «Entran a Caja» (el nombre, hasta 22 letras). */
export function voucherTotalLabel(
  direction: MoveDirection | null,
  treasuryName: string | null | undefined,
): string {
  if (direction === null || !treasuryName) return 'Total'
  const name =
    treasuryName.length > TOTAL_LABEL_NAME_MAX
      ? `${treasuryName.slice(0, TOTAL_LABEL_NAME_MAX - 1).trimEnd()}…`
      : treasuryName
  return direction === 'out' ? `Salen de ${name}` : `Entran a ${name}`
}

/** La letra chica del vale. */
export function voucherNote(motive: MoveMotive | null): string {
  if (motive === 'partner_withdrawal' || motive === 'partner_contribution') {
    return 'Queda a nombre del socio: no es un gasto ni una venta del bar.'
  }
  return 'No lleva factura: es plata que entra o sale por fuera de las ventas y las compras.'
}

/** El texto del botón del pie: «Anotar la salida · $ 100.000», o «Anotar» si falta algo. */
export function movementSubmitLabel(
  direction: MoveDirection | null,
  amountText: string | null,
): string {
  if (direction === null || amountText === null) return 'Anotar'
  return `Anotar la ${direction === 'out' ? 'salida' : 'entrada'} · ${amountText}`
}

export type MovementChoice = {
  direction: MoveDirection | null
  motive: MoveMotive | null
  accountId: string | null
  partyId: string | null
}

/**
 * Lo que queda elegido al tocar una situación. Hace, de una vez, los dos pasos
 * que antes eran dos preguntas, con sus mismas reglas:
 *
 * 1. El sentido («¿Entró o salió?»): si el motivo anterior no existe en el
 *    sentido nuevo, se olvidan la cuenta y con quién.
 * 2. El motivo («¿Por qué?»): pone la cuenta que le corresponde (con «otra»,
 *    ninguna: la elige la persona; si el motivo no encuentra su cuenta, queda
 *    la que había) y decide con quién: una seña va siempre al partícipe de
 *    señas; un retiro o un aporte conserva al socio ya elegido; el resto, nadie.
 *
 * Tocar la situación que ya está elegida no cambia nada.
 */
export function applySituation(
  prev: MovementChoice,
  picked: Situation,
  ctx: {
    /** La cuenta que sugiere el motivo elegido (`MOTIVE_ACCOUNT`), si el bar la tiene. */
    suggestedAccountId: string | null
    /** El partícipe de señas, si existe. */
    depositsPartyId: string | null
    /** Quien estaba elegido es un socio. */
    partyIsPartner: boolean
  },
): MovementChoice {
  if (prev.direction === picked.direction && prev.motive === picked.motive) return prev

  const keeps =
    prev.motive === 'other' ||
    (picked.direction === 'in' && prev.motive !== 'partner_withdrawal') ||
    (picked.direction === 'out' && prev.motive === 'partner_withdrawal')
  const forgets = !keeps || prev.motive === null
  let accountId = forgets ? null : prev.accountId
  let partyId = forgets ? null : prev.partyId

  if (ctx.suggestedAccountId || picked.motive === 'other') accountId = ctx.suggestedAccountId
  if (picked.motive === 'deposit_received') partyId = ctx.depositsPartyId
  else if (picked.motive === 'partner_withdrawal' || picked.motive === 'partner_contribution') {
    if (!ctx.partyIsPartner) partyId = null
  } else partyId = null

  return { direction: picked.direction, motive: picked.motive, accountId, partyId }
}
