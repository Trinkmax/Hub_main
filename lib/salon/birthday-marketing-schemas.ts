import { z } from 'zod'
import type { BirthdayMarketingRow } from './birthdays-report'
import {
  canonicalInput,
  type NumberKind,
  type ParsedNumber,
  parseLocaleNumber,
  shortName,
} from './event-marketing'
import { MARKETING_FIELD_MESSAGES } from './event-marketing-schemas'

/**
 * Bordes de la pauta de cumpleaños (`birthday_marketing`, una fila por mes).
 *
 * Mismo contrato que la pauta de eventos: el form parsea lo tipeado con
 * `parseLocaleNumber` y manda NÚMEROS en unidades (US$ 175,26 → `175.26`); la
 * conversión a centavos vive acá (`toBirthdayMarketingDbFields`) y en ningún
 * otro lado. El form corre este mismo schema, así un error del server cae en el
 * mismo campo y con las mismas palabras.
 *
 * Los topes copian los CHECK de la migración `20260923120000`.
 */

export type BirthdayMarketingField = 'adSpendUsd' | 'messages' | 'reach' | 'notes'

export const BIRTHDAY_MARKETING_LIMITS = {
  adSpendUsdMax: 100_000,
  messagesMax: 1_000_000,
  reachMax: 100_000_000,
  notesMax: 280,
} as const

const M = MARKETING_FIELD_MESSAGES
const L = BIRTHDAY_MARKETING_LIMITS

export const BIRTHDAY_MARKETING_MESSAGES = {
  // A diferencia de la pauta de eventos, acá no hay «no tuvo pauta»: un mes sin
  // campaña de cumpleaños simplemente no se carga.
  spendMissing: 'Poné cuánto se gastó. Si ese mes no hubo pauta de cumpleaños, no la cargues.',
  unreadable: M.unreadable,
  negative: M.negative,
  withDecimals: M.withDecimals,
  spendTooHigh: 'Revisá el monto: más de US$ 100.000 no parece la pauta de un mes.',
  countOutOfRange: M.countOutOfRange,
  notesTooLong: M.notesTooLong,
  month: 'Ese mes no existe. Recargá la página.',
  baseline: 'Recargá la página y probá de nuevo.',
} as const

const B = BIRTHDAY_MARKETING_MESSAGES

const YM_RE = /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/
/** `timestamptz` tal como lo devuelve PostgREST: viaja a un `.eq('updated_at', …)`. */
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/

const ymField = z.string(B.month).regex(YM_RE, B.month)
const baselineField = z.string(B.baseline).max(40, B.baseline).regex(TIMESTAMP_RE, B.baseline)

function countField(max: number) {
  return z
    .number(B.unreadable)
    .nonnegative(B.negative)
    .int(B.withDecimals)
    .max(max, B.countOutOfRange)
}

export const saveBirthdayMarketingSchema = z
  .object({
    ym: ymField,
    // Tiene que redondear a 1 centavo como mínimo: el CHECK de la DB arranca
    // en 1, y un 0 disfrazado de pauta daría un cierre sin costo.
    adSpendUsd: z
      .number(B.unreadable)
      .nonnegative(B.negative)
      .max(L.adSpendUsdMax, B.spendTooHigh)
      .refine((v) => Math.round(v * 100) >= 1, B.spendMissing),
    messages: countField(L.messagesMax).nullish(),
    reach: countField(L.reachMax).nullish(),
    notes: z
      .string('La nota tiene que ser texto.')
      .trim()
      .max(L.notesMax, B.notesTooLong)
      .nullish(),
    /** `null` = alta; con valor = edición sobre esa versión (chequeo de stale). */
    expectedUpdatedAt: baselineField.nullish(),
  })
  .transform((v) => ({
    ym: v.ym,
    adSpendUsd: v.adSpendUsd,
    messages: v.messages ?? null,
    reach: v.reach ?? null,
    notes: v.notes ? v.notes : null,
    expectedUpdatedAt: v.expectedUpdatedAt ?? null,
  }))

export type SaveBirthdayMarketingInput = {
  ym: string
  adSpendUsd: number
  messages: number | null
  reach: number | null
  notes: string | null
  expectedUpdatedAt: string | null
}

export type SaveBirthdayMarketingValues = z.output<typeof saveBirthdayMarketingSchema>

export const deleteBirthdayMarketingSchema = z.object({
  ym: ymField,
  expectedUpdatedAt: baselineField,
})

const FIELDS: ReadonlySet<string> = new Set<BirthdayMarketingField>([
  'adSpendUsd',
  'messages',
  'reach',
  'notes',
])

/** Un mensaje por campo: el primero que tiró zod. Lo que no es un campo va aparte. */
export function birthdayMarketingFieldErrors(error: {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>
}): Partial<Record<BirthdayMarketingField, string>> {
  const out: Partial<Record<BirthdayMarketingField, string>> = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key !== 'string' || !FIELDS.has(key)) continue
    const field = key as BirthdayMarketingField
    if (out[field] === undefined) out[field] = issue.message
  }
  return out
}

/** `YYYY-MM` → el `date` de la columna `month` (primer día del mes). */
export function monthColumn(ym: string): string {
  return `${ym}-01`
}

/** Unidades → columnas. Único lugar donde se multiplica por 100. */
export function toBirthdayMarketingDbFields(values: SaveBirthdayMarketingValues) {
  return {
    ad_spend_usd_cents: Math.round(values.adSpendUsd * 100),
    messages: values.messages,
    reach: values.reach,
    notes: values.notes,
  }
}

export const BIRTHDAY_MARKETING_DB_SELECT =
  'month, ad_spend_usd_cents, messages, reach, notes, updated_at, updated_by'

export type BirthdayMarketingDbRow = {
  month: string
  ad_spend_usd_cents: number | string
  messages: number | string | null
  reach: number | string | null
  notes: string | null
  updated_at: string
  updated_by: string | null
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** DB → dominio. `displayName` es el nombre completo de quien cargó. */
export function toBirthdayMarketingRow(
  raw: BirthdayMarketingDbRow,
  displayName: string | null,
): BirthdayMarketingRow {
  return {
    ym: raw.month.slice(0, 7),
    adSpendUsdCents: toNumberOrNull(raw.ad_spend_usd_cents) ?? 0,
    messages: toNumberOrNull(raw.messages),
    reach: toNumberOrNull(raw.reach),
    notes: raw.notes,
    updatedAt: raw.updated_at,
    updatedByName: shortName(displayName),
  }
}

// ─── El borrador del form ────────────────────────────────────────────────────

/** Lo que hay escrito en cada campo, tal cual. */
export type BirthdayMarketingDraft = {
  adSpendUsd: string
  messages: string
  reach: string
  notes: string
}

export const BIRTHDAY_NUMBER_KINDS: Readonly<
  Record<Exclude<BirthdayMarketingField, 'notes'>, NumberKind>
> = {
  adSpendUsd: 'money',
  messages: 'count',
  reach: 'count',
}

export const BIRTHDAY_FIELD_ORDER: readonly BirthdayMarketingField[] = [
  'adSpendUsd',
  'messages',
  'reach',
  'notes',
]

export const BIRTHDAY_FIELD_LABELS: Readonly<Record<BirthdayMarketingField, string>> = {
  adSpendUsd: 'Gastado',
  messages: 'Mensajes',
  reach: 'Alcance',
  notes: 'Nota',
}

/** Lo guardado, escrito como queda en el input después del blur. */
export function birthdayDraftFromRow(row: BirthdayMarketingRow | null): BirthdayMarketingDraft {
  if (!row) return { adSpendUsd: '', messages: '', reach: '', notes: '' }
  return {
    adSpendUsd: canonicalInput(row.adSpendUsdCents / 100, 'money'),
    messages: row.messages === null ? '' : canonicalInput(row.messages, 'count'),
    reach: row.reach === null ? '' : canonicalInput(row.reach, 'count'),
    notes: row.notes ?? '',
  }
}

function parseMessage(
  field: Exclude<BirthdayMarketingField, 'notes'>,
  reason: Extract<ParsedNumber, { ok: false }>['reason'],
): string | null {
  switch (reason) {
    case 'vacio':
      return field === 'adSpendUsd' ? B.spendMissing : null
    case 'ilegible':
      return B.unreadable
    case 'negativo':
      return B.negative
    case 'con-decimales':
      return B.withDecimals
  }
}

export type BirthdayDraftCheck = {
  fieldErrors: Partial<Record<BirthdayMarketingField, string>>
  /** Lo que se le manda a la acción. `null` mientras haya errores. */
  input: SaveBirthdayMarketingInput | null
  /** Lo último que se pudo leer de cada número, para la vista previa. */
  values: { adSpendUsd: number | null; messages: number | null; reach: number | null }
}

/**
 * Todo lo que se sabe del borrador antes de mandarlo: primero lo que no se
 * puede leer, después el schema del server (rangos y topes con sus palabras).
 */
export function checkBirthdayMarketingDraft(
  draft: BirthdayMarketingDraft,
  ctx: { ym: string; expectedUpdatedAt: string | null },
): BirthdayDraftCheck {
  const fieldErrors: Partial<Record<BirthdayMarketingField, string>> = {}
  const values: BirthdayDraftCheck['values'] = { adSpendUsd: null, messages: null, reach: null }

  for (const field of Object.keys(BIRTHDAY_NUMBER_KINDS) as Array<
    Exclude<BirthdayMarketingField, 'notes'>
  >) {
    const parsed = parseLocaleNumber(draft[field], BIRTHDAY_NUMBER_KINDS[field])
    if (parsed.ok) {
      values[field] = parsed.value
      continue
    }
    const message = parseMessage(field, parsed.reason)
    if (message) fieldErrors[field] = message
  }

  const notes = draft.notes.trim()
  const candidate: SaveBirthdayMarketingInput = {
    ym: ctx.ym,
    // Un «Gastado» que no se lee viaja como un gasto cualquiera solo para que
    // el schema revise el resto: su error ya está puesto y tiene prioridad.
    adSpendUsd: values.adSpendUsd ?? 1,
    messages: values.messages,
    reach: values.reach,
    notes: notes === '' ? null : notes,
    expectedUpdatedAt: ctx.expectedUpdatedAt,
  }

  const parsed = saveBirthdayMarketingSchema.safeParse(candidate)
  if (!parsed.success) {
    const schemaErrors = birthdayMarketingFieldErrors(parsed.error)
    for (const field of BIRTHDAY_FIELD_ORDER) {
      const message = schemaErrors[field]
      if (message && fieldErrors[field] === undefined) fieldErrors[field] = message
    }
  }

  return {
    fieldErrors,
    input: Object.keys(fieldErrors).length === 0 ? candidate : null,
    values,
  }
}

/** `Corregí «Mensajes» para guardar.`, solo con los errores que están a la vista. */
export function blockedBirthdaySaveMessage(
  visibleErrors: Partial<Record<BirthdayMarketingField, string>>,
): string | null {
  const names = BIRTHDAY_FIELD_ORDER.filter((f) => visibleErrors[f]).map(
    (f) => `«${BIRTHDAY_FIELD_LABELS[f]}»`,
  )
  if (names.length === 0) return null
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
  return `Corregí ${list} para guardar.`
}

export type BirthdayMarketingActionState =
  | { ok: true; row: BirthdayMarketingRow | null }
  | {
      ok: false
      code: 'forbidden' | 'invalid' | 'stale' | 'error'
      message: string
      fieldErrors?: Partial<Record<BirthdayMarketingField, string>>
    }

/**
 * Lo que se dice cuando la Server Action ni siquiera contestó. Vive acá porque
 * un archivo `'use server'` solo puede exportar funciones async.
 */
export const BIRTHDAY_MARKETING_UNREACHABLE = {
  save: 'No se pudo guardar la pauta de cumpleaños. Probá de nuevo.',
  delete: 'No se pudo borrar la pauta de cumpleaños. Probá de nuevo.',
} as const
