/**
 * De la fila de `pos_settings` a los ajustes de la pantalla, y de vuelta — PURO y testeado
 * (`tests/lib/pos-settings-row.test.ts`).
 */

import { PAY_METHODS } from '@/lib/pos/cash/types'
import { normalizeBills } from './bills'
import {
  APPROVER_ROLES,
  type ApproverRole,
  DEFAULT_POS_SETTINGS,
  type PosSettings,
  SETTING_COLUMN,
  SETTING_KEYS,
  type SettingKey,
} from './types'

/** Las columnas de los ajustes más la versión de la fila. */
export const SETTINGS_COLUMNS = [
  ...SETTING_KEYS.map((key) => SETTING_COLUMN[key]),
  'updated_at',
].join(', ')

export type SettingsRow = Record<string, unknown>

const isApprover = (role: unknown): role is ApproverRole =>
  typeof role === 'string' && (APPROVER_ROLES as ReadonlyArray<string>).includes(role)

function int(value: unknown, fallback: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : fallback
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * Una fila de `pos_settings` con la forma de la pantalla. Sin fila valen los de fábrica; lo
 * que falte o venga raro cae a su valor de fábrica: una fila a medias nunca deja la pantalla
 * sin ajustes.
 */
export function settingsFromRow(row: SettingsRow | null | undefined): PosSettings {
  const d = DEFAULT_POS_SETTINGS
  if (!row) {
    return {
      ...d,
      invoiceByMethod: { ...d.invoiceByMethod },
      tipPresetsPct: [...d.tipPresetsPct],
      approverRoles: [...d.approverRoles],
      billDenominations: [...d.billDenominations],
    }
  }
  const invoice =
    typeof row.invoice_by_method === 'object' && row.invoice_by_method !== null
      ? (row.invoice_by_method as Record<string, unknown>)
      : null
  const tips = Array.isArray(row.tip_presets_pct)
    ? row.tip_presets_pct.map((pct) => int(pct, 0)).filter((pct) => pct > 0)
    : d.tipPresetsPct
  const approvers = Array.isArray(row.approver_roles) ? row.approver_roles.filter(isApprover) : []
  const bills = Array.isArray(row.bill_denominations)
    ? normalizeBills(row.bill_denominations.map((bill) => int(bill, 0)))
    : []
  return {
    orderWarnMinutes: int(row.order_warn_minutes, d.orderWarnMinutes),
    kitchenWarnMinutes: int(row.kitchen_warn_minutes, d.kitchenWarnMinutes),
    kitchenLateMinutes: int(row.kitchen_late_minutes, d.kitchenLateMinutes),
    readyWarnMinutes: int(row.ready_warn_minutes, d.readyWarnMinutes),
    billWarnMinutes: int(row.bill_warn_minutes, d.billWarnMinutes),
    creditSurchargeBp: Math.max(0, int(row.credit_surcharge_bp, d.creditSurchargeBp)),
    invoiceByMethod: Object.fromEntries(
      PAY_METHODS.map((method) => [
        method,
        invoice ? invoice[method] === true : d.invoiceByMethod[method],
      ]),
    ) as PosSettings['invoiceByMethod'],
    tipPresetsPct: [...new Set(tips)].sort((a, b) => a - b),
    approverRoles: approvers.length > 0 ? approvers : [...d.approverRoles],
    discountNeedsApproval: row.discount_needs_approval !== false,
    voidNeedsApproval: row.void_needs_approval !== false,
    transferAlias: text(row.transfer_alias),
    transferHolder: text(row.transfer_holder),
    billDenominations: bills.length > 0 ? bills : [...d.billDenominations],
  }
}

/** Lo que se escribe en la base: solo las columnas de los ajustes que cambian. */
export function rowPatch(
  keys: ReadonlyArray<SettingKey>,
  next: PosSettings,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const key of keys) patch[SETTING_COLUMN[key]] = next[key]
  return patch
}

/** La fila entera, para crearla la primera vez que el bar cambia un ajuste. */
export function fullRow(next: PosSettings): Record<string, unknown> {
  return rowPatch(SETTING_KEYS, next)
}
