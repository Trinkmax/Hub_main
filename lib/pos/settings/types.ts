/**
 * Los ajustes del punto de venta (`pos_settings`): una fila por bar, que vale para todas sus
 * sucursales. Cuándo avisa una mesa, cómo se cobra, quién da el OK y con qué billetes se
 * cuenta la caja.
 *
 * Mientras el bar no cambió nada, la fila no existe y valen los de fábrica
 * (`DEFAULT_POS_SETTINGS`, los mismos valores por defecto de la tabla).
 */

import { PAY_METHODS, type PayMethod } from '@/lib/pos/cash/types'

/** Quién puede dar el OK a un descuento o una baja. El dueño siempre puede. */
export const APPROVER_ROLES = ['owner', 'cashier', 'waiter', 'host'] as const
export type ApproverRole = (typeof APPROVER_ROLES)[number]

export type PosSettings = {
  /** Sentada sin pedir: desde cuántos minutos la mesa pide atención. */
  orderWarnMinutes: number
  /** Esperando la comida: desde cuándo hay que mirarla… */
  kitchenWarnMinutes: number
  /** …y desde cuándo está demorada. Nunca menos que la anterior. */
  kitchenLateMinutes: number
  /** Comida lista sin llevar. */
  readyWarnMinutes: number
  /** Pidió la cuenta. */
  billWarnMinutes: number
  /** Recargo de crédito en puntos básicos: 1000 = 10 %. */
  creditSurchargeBp: number
  /** Qué medios se facturan si nadie dice otra cosa. */
  invoiceByMethod: Record<PayMethod, boolean>
  /** Propinas sugeridas, en por ciento. */
  tipPresetsPct: number[]
  approverRoles: ApproverRole[]
  discountNeedsApproval: boolean
  voidNeedsApproval: boolean
  transferAlias: string | null
  transferHolder: string | null
  /** Billetes en uso, en pesos, de mayor a menor. */
  billDenominations: number[]
}

export const SETTING_KEYS = [
  'orderWarnMinutes',
  'kitchenWarnMinutes',
  'kitchenLateMinutes',
  'readyWarnMinutes',
  'billWarnMinutes',
  'creditSurchargeBp',
  'invoiceByMethod',
  'tipPresetsPct',
  'approverRoles',
  'discountNeedsApproval',
  'voidNeedsApproval',
  'transferAlias',
  'transferHolder',
  'billDenominations',
] as const satisfies ReadonlyArray<keyof PosSettings>

export type SettingKey = (typeof SETTING_KEYS)[number]

/** La columna de `pos_settings` de cada ajuste. */
export const SETTING_COLUMN: Readonly<Record<SettingKey, string>> = {
  orderWarnMinutes: 'order_warn_minutes',
  kitchenWarnMinutes: 'kitchen_warn_minutes',
  kitchenLateMinutes: 'kitchen_late_minutes',
  readyWarnMinutes: 'ready_warn_minutes',
  billWarnMinutes: 'bill_warn_minutes',
  creditSurchargeBp: 'credit_surcharge_bp',
  invoiceByMethod: 'invoice_by_method',
  tipPresetsPct: 'tip_presets_pct',
  approverRoles: 'approver_roles',
  discountNeedsApproval: 'discount_needs_approval',
  voidNeedsApproval: 'void_needs_approval',
  transferAlias: 'transfer_alias',
  transferHolder: 'transfer_holder',
  billDenominations: 'bill_denominations',
}

/** Los de fábrica: los mismos valores por defecto de la tabla (migración `pos_salon_en_vivo`). */
export const DEFAULT_POS_SETTINGS: PosSettings = {
  orderWarnMinutes: 6,
  kitchenWarnMinutes: 12,
  kitchenLateMinutes: 20,
  readyWarnMinutes: 2,
  billWarnMinutes: 4,
  creditSurchargeBp: 0,
  invoiceByMethod: {
    cash: false,
    transfer: true,
    qr: true,
    debit: true,
    credit: true,
    other: false,
  },
  tipPresetsPct: [10],
  approverRoles: ['owner', 'cashier'],
  discountNeedsApproval: true,
  voidNeedsApproval: true,
  transferAlias: null,
  transferHolder: null,
  billDenominations: [20000, 10000, 2000, 1000, 500, 200, 100],
}

/** Un cambio pedido: qué ajuste, qué valor nuevo y qué valor veía la persona. */
export type SettingChange = {
  [K in SettingKey]: { key: K; value: PosSettings[K]; expected: PosSettings[K] }
}[SettingKey]

export type SettingsFailure = 'changed' | 'invalid' | 'forbidden' | 'error'

export type SettingsWriteResult =
  | {
      ok: true
      /** Reloj del servidor al terminar de escribir (ms). */
      savedAt: number
      /** Los ajustes como quedaron. */
      settings: PosSettings
    }
  | {
      ok: false
      code: SettingsFailure
      message: string
      /** Con `changed`: los ajustes como están ahora, para mostrar la verdad. */
      current?: PosSettings
    }

/** ¿Dos valores de un mismo ajuste son el mismo? Las listas comparan por contenido. */
export function sameSetting<K extends SettingKey>(
  key: K,
  a: PosSettings[K],
  b: PosSettings[K],
): boolean {
  if (key === 'invoiceByMethod') {
    const left = a as PosSettings['invoiceByMethod']
    const right = b as PosSettings['invoiceByMethod']
    return PAY_METHODS.every((method) => Boolean(left[method]) === Boolean(right[method]))
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    // El orden no cambia lo que significan: los mismos billetes, los mismos roles.
    if (a.length !== b.length) return false
    const left = [...a].map(String).sort()
    const right = [...b].map(String).sort()
    return left.every((value, index) => value === right[index])
  }
  return a === b
}
