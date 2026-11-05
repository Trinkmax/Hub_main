import {
  CHANNEL_OPTIONS,
  FIELD_SENTENCE,
  type FieldConfig,
  MONTHS,
  SOURCE_OPTIONS,
  summarizeFilter,
} from '@/app/(manager)/[tenantSlug]/mensajeria/audiencias/_components/condition-copy'
import type { AudienceBuilderOptions, AudienceListRow } from '@/lib/audiences/queries'
import {
  type AudienceCondition,
  type AudienceFilter,
  audienceFilterSchema,
  type ConditionField,
  type ConditionOp,
} from '@/lib/audiences/schemas'
import { matchByName, noMatchText } from '../actions/_gastos-values'
import { capped, pesosToCents, type TexTicketDraft } from '../types'
import type { AudienceReach } from './_broadcast-values'
import { countText, dateTimeText, safeText } from './_common'

/**
 * Las audiencias, puras: de lo que dice la gente a la condición que entiende el compilador, con las
 * mismas frases del constructor (`condition-copy.ts`). Las cuentas las sigue haciendo la acción.
 */

const LIST_MAX = 30
/** Cuántas se cuentan en vivo en la lista, de la más reciente a la más vieja: cada una son varias consultas. */
export const AUDIENCES_COUNTED_LIVE = 10
const SUMMARY_MAX = 160
export const CONDITIONS_MAX = 12

/** Las condiciones del constructor, en las palabras de la gente. */
export const AUDIENCE_FIELD_OF = {
  veces_que_vino: 'visits_count',
  dias_sin_venir: 'days_since_last_visit',
  gasto_total: 'total_spent_cents',
  fue_al_evento: 'attended_event_id',
  acepta_promos: 'opt_in_marketing',
  puntos_disponibles: 'points_balance',
  puntos_acumulados: 'lifetime_points',
  nivel: 'current_tier_id',
  mes_de_cumpleanos: 'birth_month',
  dias_desde_que_se_sumo: 'created_days_ago',
  etiqueta: 'has_tag',
  llego_por: 'acquisition_channel',
  se_registro_por: 'source',
} as const satisfies Record<string, ConditionField>

export type AudienceFieldWord = keyof typeof AUDIENCE_FIELD_OF

export const AUDIENCE_FIELD_WORDS = Object.keys(AUDIENCE_FIELD_OF) as [
  AudienceFieldWord,
  ...AudienceFieldWord[],
]

const COMPARISON_LABEL = {
  al_menos: 'al menos',
  mas_de: 'más de',
  exactamente: 'exactamente',
  como_mucho: 'como mucho',
  menos_de: 'menos de',
} as const

export type AudienceComparison = keyof typeof COMPARISON_LABEL

export const AUDIENCE_COMPARISONS = Object.keys(COMPARISON_LABEL) as [
  AudienceComparison,
  ...AudienceComparison[],
]

export type AudienceConditionInput = {
  campo: AudienceFieldWord
  comparacion?: AudienceComparison
  valor?: number | string | boolean
}

type Built = { ok: true; condition: AudienceCondition } | { ok: false; message: string }

const bad = (message: string): Built => ({ ok: false, message })

function normalized(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

/** El operador según la misma frase que ve el dueño: «no viene desde hace más de 30 días» es `gte`. */
function opOf(
  input: AudienceConditionInput,
  cfg: FieldConfig,
): { ok: true; op: ConditionOp } | { ok: false; message: string } {
  const options = cfg.ops.map((option) => option.label).join(', ')
  if (!input.comparacion) {
    return { ok: false, message: `«${cfg.verb}» necesita comparacion: ${options}.` }
  }
  const wanted = COMPARISON_LABEL[input.comparacion]
  const found = cfg.ops.find((option) => option.label === wanted)
  return found
    ? { ok: true, op: found.op }
    : { ok: false, message: `«${cfg.verb}» se compara con: ${options}.` }
}

function pickFrom(
  rows: ReadonlyArray<{ id: string; name: string }>,
  wanted: string,
  what: string,
): { ok: true; id: string } | { ok: false; message: string } {
  if (rows.length === 0) return { ok: false, message: `El bar no tiene ${what} para elegir.` }
  const match = matchByName(rows, wanted)
  return match.ok
    ? { ok: true, id: match.value.id }
    : { ok: false, message: noMatchText(match, wanted) }
}

function optionValue(
  options: ReadonlyArray<{ value: string; label: string }>,
  wanted: string,
): string | null {
  const key = normalized(wanted)
  return (
    options.find((o) => o.value === wanted)?.value ??
    options.find((o) => normalized(o.label).includes(key))?.value ??
    null
  )
}

/** Una condición, con los ids resueltos y la plata en centavos. Lo que no se entiende vuelve a Tex. */
export function audienceCondition(
  input: AudienceConditionInput,
  options: AudienceBuilderOptions,
): Built {
  const field = AUDIENCE_FIELD_OF[input.campo]
  const cfg = FIELD_SENTENCE[field] as FieldConfig
  const condition = (op: ConditionOp, value: unknown): Built => ({
    ok: true,
    condition: { kind: 'condition', field, op, value },
  })
  const raw = input.valor

  switch (cfg.value) {
    case 'boolean':
      return raw === false ? condition('is_false', null) : condition('is_true', null)
    case 'number':
    case 'pesos': {
      const op = opOf(input, cfg)
      if (!op.ok) return bad(op.message)
      const number = typeof raw === 'string' ? Number(raw) : raw
      if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) {
        return bad(`«${cfg.verb}» necesita un número en valor.`)
      }
      if (cfg.value === 'pesos') return condition(op.op, pesosToCents(number))
      return Number.isInteger(number)
        ? condition(op.op, number)
        : bad(`«${cfg.verb}» necesita un número entero.`)
    }
    case 'month': {
      const asNumber = Number(raw)
      const month = Number.isInteger(asNumber)
        ? asNumber
        : MONTHS.findIndex((name) => name === normalized(String(raw ?? ''))) + 1
      return Number.isInteger(month) && month >= 1 && month <= 12
        ? condition('eq', month)
        : bad('El mes de cumpleaños va del 1 al 12, o su nombre.')
    }
    case 'tier':
    case 'tag':
    case 'event': {
      if (typeof raw !== 'string' || !raw.trim()) {
        return bad(`«${cfg.verb}» necesita el nombre en valor.`)
      }
      const picked =
        cfg.value === 'tier'
          ? pickFrom(options.tiers, raw, 'niveles del club')
          : cfg.value === 'tag'
            ? pickFrom(options.tags, raw, 'etiquetas de clientes')
            : pickFrom(options.events, raw, 'eventos en el calendario')
      return picked.ok ? condition('eq', picked.id) : bad(picked.message)
    }
    case 'channel':
    case 'source': {
      const list = cfg.value === 'channel' ? CHANNEL_OPTIONS : SOURCE_OPTIONS
      const value = optionValue(list, String(raw ?? ''))
      return value
        ? condition('eq', value)
        : bad(`«${cfg.verb}» puede ser: ${list.map((o) => o.label).join(', ')}.`)
    }
  }
}

export type FilterResult = { ok: true; filter: AudienceFilter } | { ok: false; message: string }

/** Las condiciones juntas. Sin ninguna, son todos los clientes: lo mismo que el constructor vacío. */
export function audienceFilter(
  conditions: readonly AudienceConditionInput[],
  matchAny: boolean,
  options: AudienceBuilderOptions,
): FilterResult {
  const nodes: AudienceFilter[] = []
  for (const input of conditions) {
    const built = audienceCondition(input, options)
    if (!built.ok) return { ok: false, message: built.message }
    nodes.push(built.condition)
  }
  return { ok: true, filter: { kind: 'group', op: matchAny ? 'OR' : 'AND', nodes } }
}

/** El constructor no muestra una lista fija y la perdería al guardar: esas se tocan a mano. */
export function hasFixedList(filter: AudienceFilter): boolean {
  if (filter.kind === 'static_list') return true
  return filter.kind === 'group' && filter.nodes.some(hasFixedList)
}

/** Una frase con quién entra. Un filtro con forma rara no puede romper la lista. */
export function filterSentence(raw: unknown, options: AudienceBuilderOptions): string | null {
  const parsed = audienceFilterSchema.safeParse(raw)
  if (!parsed.success) return null
  try {
    return summarizeFilter(parsed.data, options)
  } catch {
    return null
  }
}

/**
 * Una audiencia, contada ahora si se pudo. El número que guarda la pantalla no se recalcula solo: puede
 * estar muy viejo, así que sin conteo se dice qué es y de cuándo.
 */
export function audienceRow(
  row: AudienceListRow,
  options: AudienceBuilderOptions,
  live: AudienceReach | undefined,
) {
  const summary = filterSentence(row.filters, options)
  return {
    id: row.id,
    nombre: row.name,
    ...(live
      ? { clientes: live.total, les_llegaria: live.reach }
      : {
          ultimo_conteo_guardado: row.customer_count_cached,
          ...(row.last_calculated_at ? { contada: dateTimeText(row.last_calculated_at) } : {}),
        }),
    ...(summary ? { quienes: safeText(summary, SUMMARY_MAX) } : {}),
  }
}

export function audiencesData(
  rows: readonly AudienceListRow[],
  options: AudienceBuilderOptions,
  live: ReadonlyMap<string, AudienceReach>,
) {
  const { filas, hay_mas } = capped(
    rows.map((row) => audienceRow(row, options, live.get(row.id))),
    LIST_MAX,
  )
  return {
    cuantas: rows.length,
    nota: 'clientes y les_llegaria están contados ahora; les_llegaria son los que aceptan promos y no están en «No contactar». La pantalla muestra el último conteo guardado, que puede estar viejo.',
    filas,
    hay_mas,
  }
}

export function audienceTicket(input: {
  name: string
  editing: boolean
  sentence: string
  reach: AudienceReach
  scheduledNames: readonly string[]
}): TexTicketDraft {
  const { total, reach } = input.reach
  return {
    kind: 'audiencia',
    title: input.editing ? 'Editar audiencia' : 'Nueva audiencia',
    subtitle: input.name,
    rows: [
      { label: 'Quiénes', value: input.sentence },
      { label: 'Les llegaría una difusión', value: `A ${countText(reach)} de ${countText(total)}` },
    ],
    total: { label: 'Clientes hoy', value: countText(total) },
    entry: [],
    warnings: [
      { key: 'no_send', title: 'Guardarla no le manda nada a nadie.', body: null },
      ...input.scheduledNames.map((name, index) => ({
        key: `scheduled_${index}`,
        title: `La difusión programada «${name}» usa esta lista: le va a llegar a quienes queden con este cambio.`,
        body: null,
      })),
    ],
    confirmLabel: input.editing ? 'Guardar los cambios' : 'Guardar la audiencia',
  }
}
