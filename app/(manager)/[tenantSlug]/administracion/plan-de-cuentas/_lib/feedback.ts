/**
 * Qué se le dice a la persona cuando la base no deja guardar algo del plan de cuentas (#16): cada
 * error en su campo, y las reglas de desactivar y de las cuentas del sistema explicadas en criollo.
 * Puro: lo usan la hoja, los diálogos y los tests.
 */

import type { AccFailureState } from '@/lib/accounting/action-state'
import { ACCOUNT_TYPE_OF, type ChartAccount } from './tree'

export function failureKey(state: AccFailureState): string | null {
  return typeof state.detail?.key === 'string' ? state.detail.key : null
}

/** El error de cada campo y lo que va en el aviso de arriba de los botones. */
export type FormFeedback = { fields: Record<string, string>; message: string | null }

const FIELD_OF_KEY: Readonly<Record<string, string>> = {
  code_taken: 'code',
  code_invalid: 'code',
  code_parent_mismatch: 'code',
  account_name_invalid: 'name',
  account_description_invalid: 'description',
  account_type_mismatch: 'type',
  parent_is_postable: 'parentId',
  account_move_cycle: 'parentId',
  account_level_too_deep: 'parentId',
  account_root_must_be_group: 'parentId',
  account_not_found: 'parentId',
}

/** Textos más claros que el del catálogo cuando se sabe dónde se mostraron. */
const PLAIN: Readonly<Record<string, string>> = {
  account_not_found: 'Ese grupo ya no existe: recargá la página y elegilo de nuevo.',
  account_has_movements:
    'La cuenta ya tiene movimientos: podés cambiarle el nombre, el código o el grupo, pero no el tipo ni si lleva proveedor o cliente.',
  system_account_locked:
    'La usa el sistema para armar asientos: podés renombrarla, cambiarle el código o moverla, pero no desactivarla ni cambiarle si lleva proveedor o cliente.',
  account_has_children: 'Tiene cuentas adentro: no puede pasar a ser imputable.',
}

/**
 * Un error de `saveAccount` → cada campo con su error (solo los que el formulario muestra en
 * `shown`); lo demás va en el aviso.
 */
export function formFeedback(state: AccFailureState, shown: readonly string[]): FormFeedback {
  const key = failureKey(state)
  const fields: Record<string, string> = {}
  let unplaced = false
  for (const [field, message] of Object.entries(state.fieldErrors ?? {})) {
    if (shown.includes(field)) fields[field] = message
    else unplaced = true
  }
  const message = (key && PLAIN[key]) || state.message
  const target = key ? FIELD_OF_KEY[key] : undefined
  if (target && shown.includes(target) && !fields[target]) fields[target] = message
  const placed = Object.keys(fields).length > 0
  return { fields, message: placed && !unplaced ? null : message }
}

/**
 * Por qué la base no dejó desactivar (las reglas de `acc_accounts_biu`): la usa el sistema, tiene
 * saldo, o la usa algo activo (una caja, un proveedor o cliente, un gasto fijo, o cuentas de adentro).
 */
export function deactivateRefusal(state: AccFailureState, account: ChartAccount): string {
  switch (failureKey(state)) {
    case 'system_account_locked':
      return 'La usa el sistema para armar asientos: no se puede desactivar. Si querés que use otra, cambiala en «Cuentas del sistema».'
    case 'account_has_balance':
      return 'Tiene saldo: pasalo a otra cuenta con un asiento manual y después desactivala.'
    case 'account_in_use':
      if (!account.postable) return 'Tiene cuentas activas adentro: desactivalas primero.'
      if (account.isTreasury) {
        return 'Es la cuenta de una caja o banco activo: desactivá primero la caja en Ajustes › Cajas y cuentas.'
      }
      return 'La usa un proveedor o cliente (como cuenta habitual o de control) o un gasto fijo activo: cambialos primero y después desactivala.'
    default:
      return state.message
  }
}

const SIDE_TEXT = { debit: 'saldo deudor', credit: 'saldo acreedor' } as const

/**
 * Lo que tiene que cumplir la cuenta nueva de una clave del sistema (la misma regla que
 * `acc_remap_system_account`), en criollo.
 */
export function remapRequirement(current: ChartAccount): string {
  return `Tiene que ser una cuenta imputable y activa ${ACCOUNT_TYPE_OF[current.type]}, de ${
    SIDE_TEXT[current.normalSide]
  }, ${current.requiresParty ? 'que lleve' : 'que no lleve'} proveedor o cliente, y que no sea de una caja ni la use el sistema para otra cosa.`
}

/** ¿Sirve `candidate` para la clave que hoy tiene `current`? (Espejo de la base.) */
export function remapCompatible(current: ChartAccount, candidate: ChartAccount): boolean {
  return (
    candidate.id !== current.id &&
    candidate.postable &&
    candidate.active &&
    !candidate.isTreasury &&
    candidate.systemKey === null &&
    candidate.type === current.type &&
    candidate.normalSide === current.normalSide &&
    candidate.requiresParty === current.requiresParty
  )
}

const REMAP_REASONS: Readonly<Record<string, string>> = {
  system: 'Esa cuenta ya la usa el sistema para otra cosa.',
  treasury: 'Esa cuenta es de una caja o banco.',
  postable: 'Esa cuenta es un grupo: elegí una cuenta imputable.',
  inactive: 'Esa cuenta está desactivada.',
  type: 'Esa cuenta es de otro tipo.',
  normal_side: 'Esa cuenta tiene el saldo del otro lado (una es regularizadora y la otra no).',
  requires_party: 'Una lleva proveedor o cliente y la otra no.',
}

/** Por qué la base no dejó pasar la clave a otra cuenta. */
export function remapRefusal(state: AccFailureState): string {
  if (failureKey(state) === 'system_remap_incompatible') {
    const reason = typeof state.detail?.reason === 'string' ? state.detail.reason : null
    const text = reason ? REMAP_REASONS[reason] : undefined
    if (text) return `${text} Elegí otra.`
  }
  return state.message
}
