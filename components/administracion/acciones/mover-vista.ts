/**
 * Lo puro de la hoja «Mover plata»: los atajos («Depositar el efectivo»), cómo
 * arranca la hoja según la caja que vino en la URL, y el «hoy → queda» de las
 * dos cajas del pase. Sin React; lo prueba `tests/lib/administracion-hojas-cajas.test.ts`.
 *
 * Nada de esto cambia lo que se guarda: la hoja manda las dos cajas y el
 * importe que la persona confirma, igual que siempre.
 */

import type { SheetTreasury } from '../cajas-ventas/types'
import {
  type TreasuryAfter,
  type TreasuryAfterWords,
  treasuryAfter,
  treasuryAfterWords,
} from './gasto-papel'

type MoveTreasury = Pick<SheetTreasury, 'id' | 'name' | 'kind'>

export type MoveShortcut = { key: string; label: string; from: string; to: string }

/** Hasta cuántos atajos se muestran. */
export const MOVE_SHORTCUTS_MAX = 4

/**
 * «Lo más común», armado con las cajas que el bar SÍ tiene (la primera de
 * cada tipo, en el orden de Ajustes).
 *
 * Con banco: depositar el efectivo, pasar la billetera al banco, pagar el
 * resumen de la tarjeta y sacar efectivo del banco. Sin banco (un bar con caja
 * y Mercado Pago, nada más): de la caja a la billetera y al revés, y pagar la
 * tarjeta con la billetera.
 */
export function moveShortcuts(treasuries: readonly MoveTreasury[]): MoveShortcut[] {
  const first = (kind: SheetTreasury['kind']) => treasuries.find((t) => t.kind === kind)
  const cash = first('cash')
  const bank = first('bank')
  const wallet = first('wallet')
  const card = first('credit_card')
  const out: MoveShortcut[] = []
  if (bank) {
    if (cash) {
      out.push({ key: 'deposit', label: 'Depositar el efectivo', from: cash.id, to: bank.id })
    }
    if (wallet) {
      out.push({
        key: 'wallet',
        label: `Pasar de ${wallet.name} al banco`,
        from: wallet.id,
        to: bank.id,
      })
    }
    if (card) {
      out.push({
        key: 'card',
        label: 'Pagar el resumen de la tarjeta',
        from: bank.id,
        to: card.id,
      })
    }
    if (cash) {
      out.push({ key: 'withdraw', label: 'Sacar efectivo del banco', from: bank.id, to: cash.id })
    }
  } else {
    if (cash && wallet) {
      out.push(
        {
          key: 'cash-wallet',
          label: `De ${cash.name} a ${wallet.name}`,
          from: cash.id,
          to: wallet.id,
        },
        {
          key: 'wallet-cash',
          label: `De ${wallet.name} a ${cash.name}`,
          from: wallet.id,
          to: cash.id,
        },
      )
    }
    if (wallet && card) {
      out.push({
        key: 'wallet-card',
        label: `Pagar la tarjeta con ${wallet.name}`,
        from: wallet.id,
        to: card.id,
      })
    }
  }
  return out.slice(0, MOVE_SHORTCUTS_MAX)
}

/**
 * Con qué arranca la hoja. La caja que vino en la URL va como ORIGEN, salvo
 * una tarjeta de la empresa, que va como DESTINO (a una tarjeta se le paga: lo
 * otro casi nunca es lo que se quiere). Con dos cajas en total, la otra queda
 * puesta del lado que falta: no hay nada más que elegir.
 */
export function moveInitial(
  treasuries: readonly MoveTreasury[],
  caja: string | null | undefined,
): { fromId: string | null; toId: string | null } {
  const picked = caja ? treasuries.find((t) => t.id === caja) : undefined
  if (!picked) return { fromId: null, toId: null }
  const other =
    treasuries.length === 2 ? (treasuries.find((t) => t.id !== picked.id)?.id ?? null) : null
  if (picked.kind === 'credit_card') return { fromId: other, toId: picked.id }
  return { fromId: picked.id, toId: other }
}

/** Las dos direcciones posibles entre dos cajas, para el bar que tiene solo dos. */
export function movePair(treasuries: readonly MoveTreasury[]): MoveShortcut[] {
  const [a, b] = treasuries
  if (treasuries.length !== 2 || !a || !b) return []
  return [
    { key: `${a.id}>${b.id}`, label: `De ${a.name} a ${b.name}`, from: a.id, to: b.id },
    { key: `${b.id}>${a.id}`, label: `De ${b.name} a ${a.name}`, from: b.id, to: a.id },
  ]
}

export type MoveSide = {
  after: TreasuryAfter
  /** «hoy $ 394.757» → «queda $ 194.757», cada número con su rótulo. `null` sin importe. */
  words: TreasuryAfterWords | null
}

/**
 * Cómo queda cada caja del pase: de la de origen SALE la plata y a la de
 * destino le ENTRA. Mismas palabras que «Nuevo gasto» (`treasuryAfterWords`):
 * «hoy $ X → queda $ Y», «faltan $ Y» si no alcanza, y con la tarjeta de la
 * empresa «hoy debés $ X → vas a deber $ Y».
 */
export function moveAfter(
  from: Pick<SheetTreasury, 'kind' | 'balanceCents' | 'allowNegative'> | null | undefined,
  to: Pick<SheetTreasury, 'kind' | 'balanceCents' | 'allowNegative'> | null | undefined,
  amountCents: number | null,
): { from: MoveSide | null; to: MoveSide | null; short: boolean } {
  const sideOf = (
    treasury: Pick<SheetTreasury, 'kind' | 'balanceCents' | 'allowNegative'> | null | undefined,
    direction: 'out' | 'in',
  ): MoveSide | null => {
    if (!treasury) return null
    const after = treasuryAfter(treasury, amountCents, direction)
    return { after, words: treasuryAfterWords(treasury.kind, after) }
  }
  const fromSide = sideOf(from, 'out')
  return {
    from: fromSide,
    to: sideOf(to, 'in'),
    // El origen no alcanza: el mismo caso que el servidor avisa al guardar.
    short: fromSide?.after.state === 'short',
  }
}

/** La deuda de una tarjeta de la empresa elegida como destino, para «Usar lo que debés». */
export function cardDebtOf(
  to: Pick<SheetTreasury, 'kind' | 'balanceCents'> | null | undefined,
): number | null {
  return to?.kind === 'credit_card' && to.balanceCents > 0 ? to.balanceCents : null
}
