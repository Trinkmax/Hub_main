/**
 * El borde de los ajustes del punto de venta: lo que el navegador le puede mandar al servidor.
 * Los topes son los de la tabla `pos_settings`.
 */

import { z } from 'zod'
import type { PayMethod } from '@/lib/pos/cash/types'
import { MINUTE_BOUNDS, type MinuteKey } from './alerts'
import { MAX_TIP_PRESETS } from './patch'
import { SURCHARGE_MAX_BP } from './percent'
import { APPROVER_ROLES, type ApproverRole, type SettingChange } from './types'

/** El tope de la base para el alias y el titular. */
export const ALIAS_MAX = 60
export const HOLDER_MAX = 80

/**
 * Un alias de cuenta (de 6 a 20 letras, números, puntos o guiones, como lo pide el banco) o
 * un CBU/CVU (22 números). Es lo que se le muestra al cliente para que transfiera.
 */
const ALIAS = /^[A-Za-z0-9.-]{6,20}$/
const CBU = /^\d{22}$/

export function readAlias(
  text: string | null,
): { ok: true; alias: string | null } | { ok: false; message: string } {
  const clean = (text ?? '').replace(/\s+/g, '')
  if (clean === '') return { ok: true, alias: null }
  if (ALIAS.test(clean) || CBU.test(clean)) return { ok: true, alias: clean }
  return {
    ok: false,
    message:
      'Un alias lleva de 6 a 20 letras, números, puntos o guiones. Un CBU o CVU, 22 números.',
  }
}

export function readHolder(
  text: string | null,
): { ok: true; holder: string | null } | { ok: false; message: string } {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  if (clean === '') return { ok: true, holder: null }
  if (clean.length > HOLDER_MAX) {
    return { ok: false, message: `El titular entra en ${HOLDER_MAX} letras.` }
  }
  return { ok: true, holder: clean }
}

const minutes = (key: MinuteKey) =>
  z.number().int().min(MINUTE_BOUNDS[key].min).max(MINUTE_BOUNDS[key].max)

// Lo que la persona veía (`expected`) se compara con lo que hay en la base, así que solo se le
// pide la forma: puede ser un valor viejo que hoy ya no pasaría las reglas.
const seenInt = z.number().int().min(0).max(10_000_000)
const seenText = z.string().max(400).nullable()

const methods = {
  cash: z.boolean(),
  transfer: z.boolean(),
  qr: z.boolean(),
  debit: z.boolean(),
  credit: z.boolean(),
  other: z.boolean(),
} satisfies Record<PayMethod, z.ZodBoolean>

const invoiceByMethod = z.object(methods)
/** Una fila vieja puede traer menos medios: lo que falta es «no». */
const seenInvoiceByMethod = z.object(methods).partial()

const isApprover = (role: string): role is ApproverRole =>
  (APPROVER_ROLES as ReadonlyArray<string>).includes(role)

const alias = z
  .string()
  .max(ALIAS_MAX * 2)
  .nullable()
  .transform((value, ctx) => {
    const read = readAlias(value)
    if (!read.ok) {
      ctx.addIssue({ code: 'custom', message: read.message })
      return z.NEVER
    }
    return read.alias
  })

const holder = z
  .string()
  .max(HOLDER_MAX * 4)
  .nullable()
  .transform((value, ctx) => {
    const read = readHolder(value)
    if (!read.ok) {
      ctx.addIssue({ code: 'custom', message: read.message })
      return z.NEVER
    }
    return read.holder
  })

const minuteChange = <K extends MinuteKey>(key: K) =>
  z.object({ key: z.literal(key), value: minutes(key), expected: seenInt })

const change = z.discriminatedUnion('key', [
  minuteChange('orderWarnMinutes'),
  minuteChange('kitchenWarnMinutes'),
  minuteChange('kitchenLateMinutes'),
  minuteChange('readyWarnMinutes'),
  minuteChange('billWarnMinutes'),
  z.object({
    key: z.literal('creditSurchargeBp'),
    value: z.number().int().min(0).max(SURCHARGE_MAX_BP),
    expected: seenInt,
  }),
  z.object({
    key: z.literal('invoiceByMethod'),
    value: invoiceByMethod,
    expected: seenInvoiceByMethod,
  }),
  z.object({
    key: z.literal('tipPresetsPct'),
    value: z.array(z.number().int().min(1).max(50)).max(MAX_TIP_PRESETS),
    expected: z.array(seenInt).max(32),
  }),
  z.object({
    key: z.literal('approverRoles'),
    value: z.array(z.enum(APPROVER_ROLES)).min(1).max(APPROVER_ROLES.length),
    expected: z.array(z.string().max(40)).max(16),
  }),
  z.object({ key: z.literal('discountNeedsApproval'), value: z.boolean(), expected: z.boolean() }),
  z.object({ key: z.literal('voidNeedsApproval'), value: z.boolean(), expected: z.boolean() }),
  z.object({ key: z.literal('transferAlias'), value: alias, expected: seenText }),
  z.object({ key: z.literal('transferHolder'), value: holder, expected: seenText }),
  z.object({
    key: z.literal('billDenominations'),
    value: z.array(z.number().int().min(1).max(1_000_000)).min(1).max(24),
    expected: z.array(seenInt).max(64),
  }),
])

export const saveSettingsSchema = z
  .object({ changes: z.array(change).min(1).max(4) })
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    for (const [index, entry] of value.changes.entries()) {
      if (seen.has(entry.key)) {
        ctx.addIssue({ code: 'custom', path: ['changes', index], message: 'Ajuste repetido.' })
      }
      seen.add(entry.key)
    }
  })

export type SaveSettingsInput = z.input<typeof saveSettingsSchema>

export type ParsedSettings =
  | { ok: true; changes: SettingChange[] }
  /** `message`: el motivo, si es de los que se le pueden decir a la persona. */
  | { ok: false; message: string | null }

/** Valida lo que mandó la pantalla y lo deja con la forma de los ajustes. */
export function parseSettingChanges(input: unknown): ParsedSettings {
  const parsed = saveSettingsSchema.safeParse(input)
  if (!parsed.success) {
    const shown = parsed.error.issues.find(
      (issue) => issue.code === 'custom' && issue.message !== 'Ajuste repetido.',
    )
    return { ok: false, message: shown?.message ?? null }
  }
  const changes = parsed.data.changes.map((entry): SettingChange => {
    switch (entry.key) {
      case 'invoiceByMethod':
        return {
          key: entry.key,
          value: entry.value,
          expected: {
            cash: entry.expected.cash ?? false,
            transfer: entry.expected.transfer ?? false,
            qr: entry.expected.qr ?? false,
            debit: entry.expected.debit ?? false,
            credit: entry.expected.credit ?? false,
            other: entry.expected.other ?? false,
          },
        }
      case 'approverRoles':
        return {
          key: entry.key,
          value: entry.value,
          expected: entry.expected.filter(isApprover),
        }
      default:
        return entry
    }
  })
  return { ok: true, changes }
}
