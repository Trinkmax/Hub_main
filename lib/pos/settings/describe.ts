/**
 * Un cambio de ajustes, dicho en una línea — PURO y testeado
 * (`tests/lib/pos-settings-describe.test.ts`).
 *
 * Es lo que dice el aviso que aparece cuando un ajuste se guarda solo («Recargo de crédito:
 * 10 % → 12 %»), al lado de su «Deshacer». Para deshacer se describe el gesto contrario, así
 * el aviso siempre dice cómo quedó.
 */

import { formatCentsShort } from '@/lib/money'
import { METHOD_LABEL, PAY_METHODS } from '@/lib/pos/cash/types'
import { readyLateOf } from './alerts'
import { formatPercent } from './percent'
import type { ApproverRole, PosSettings, SettingChange } from './types'

/** Como se llama cada rol en Equipo. */
export const APPROVER_LABEL: Readonly<Record<ApproverRole, string>> = {
  owner: 'Dueño',
  cashier: 'Cajero',
  waiter: 'Mozo',
  host: 'Anfitrión',
}

const pesos = (bill: number) => formatCentsShort(bill * 100)

function listed(items: ReadonlyArray<string>): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

/** Lo que entró y lo que salió de una lista. */
function diff<T>(before: ReadonlyArray<T>, after: ReadonlyArray<T>) {
  return {
    added: after.filter((value) => !before.includes(value)),
    removed: before.filter((value) => !after.includes(value)),
  }
}

function describeOne(change: SettingChange, after: PosSettings): string {
  switch (change.key) {
    case 'orderWarnMinutes':
      return `Sin pedido: avisa a los ${change.value} min`
    case 'kitchenWarnMinutes':
    case 'kitchenLateMinutes':
      return `Esperando la comida: avisa a los ${after.kitchenWarnMinutes} min, roja a los ${after.kitchenLateMinutes}`
    case 'readyWarnMinutes':
      return `Comida lista: roja a los ${readyLateOf(change.value)} min`
    case 'billWarnMinutes':
      return `Cuenta pedida: avisa a los ${change.value} min`
    case 'creditSurchargeBp':
      if (change.value === 0) return 'Crédito sin recargo'
      return change.expected === 0
        ? `Recargo de crédito: ${formatPercent(change.value)}`
        : `Recargo de crédito: ${formatPercent(change.expected)} → ${formatPercent(change.value)}`
    case 'invoiceByMethod': {
      const flipped = PAY_METHODS.filter(
        (method) => Boolean(change.value[method]) !== Boolean(change.expected[method]),
      )
      const only = flipped.length === 1 ? flipped[0] : undefined
      if (!only) return 'Cambió qué se factura'
      return `${METHOD_LABEL[only]}: ${change.value[only] ? 'se factura' : 'no se factura'}`
    }
    case 'tipPresetsPct':
      return change.value.length === 0
        ? 'Sin propinas sugeridas'
        : `Propinas sugeridas: ${listed([...change.value].sort((a, b) => a - b).map((pct) => formatPercent(pct * 100)))}`
    case 'approverRoles': {
      const { added, removed } = diff(change.expected, change.value)
      const [gained] = added
      const [lost] = removed
      if (gained && added.length + removed.length === 1) {
        return `${APPROVER_LABEL[gained]}: ahora da el OK`
      }
      if (lost && added.length + removed.length === 1)
        return `${APPROVER_LABEL[lost]}: ya no da el OK`
      return 'Cambió quién da el OK'
    }
    case 'discountNeedsApproval':
      return change.value ? 'Los descuentos piden el OK' : 'Los descuentos ya no piden el OK'
    case 'voidNeedsApproval':
      return change.value ? 'Las bajas piden el OK' : 'Las bajas ya no piden el OK'
    case 'transferAlias':
      return change.value ? `Alias: ${change.value}` : 'Alias borrado'
    case 'transferHolder':
      return change.value ? `Titular: ${change.value}` : 'Titular borrado'
    case 'billDenominations': {
      const { added, removed } = diff(change.expected, change.value)
      const [gained] = added
      const [lost] = removed
      if (gained !== undefined && added.length + removed.length === 1) {
        return `${pesos(gained)} se cuenta en la caja`
      }
      if (lost !== undefined && added.length + removed.length === 1) {
        return `${pesos(lost)} ya no se cuenta en la caja`
      }
      return 'Cambiaron los billetes de la caja'
    }
  }
}

/**
 * Un gesto en una línea. `after` son los ajustes como quedan (los dos tiempos de «esperando
 * la comida» se dicen juntos aunque se haya movido uno).
 */
export function describeChanges(changes: ReadonlyArray<SettingChange>, after: PosSettings): string {
  const [first] = changes
  if (!first) return 'Sin cambios'
  const kitchen = changes.find(
    (change) => change.key === 'kitchenWarnMinutes' || change.key === 'kitchenLateMinutes',
  )
  if (kitchen) return describeOne(kitchen, after)
  return changes.length === 1 ? describeOne(first, after) : 'Se guardaron los ajustes'
}
