// Copy compartido entre el builder (cliente) y las páginas (servidor).
// Cada condición se describe como una FRASE en español llano, no como
// campo/operador/valor. Sin 'use client' ni 'server-only': es puro.

import type { AudienceBuilderOptions } from '@/lib/audiences/queries'
import type {
  AudienceCondition,
  AudienceFilter,
  ConditionField,
  ConditionOp,
} from '@/lib/audiences/schemas'

export type ValueKind =
  | 'number'
  | 'pesos'
  | 'month'
  | 'tier'
  | 'tag'
  | 'event'
  | 'channel'
  | 'source'
  | 'boolean'

// `verb` es lo que ve el dueño en el selector y arranca la oración
// ("Vino…", "Gastó…"); `ops` son conectores en español; `suffix` la cierra.
export type FieldConfig = {
  verb: string
  group: string
  suffix?: string
  ops: { op: ConditionOp; label: string }[]
  value: ValueKind
  placeholder?: string
}

export const FIELD_SENTENCE: Record<ConditionField, FieldConfig> = {
  visits_count: {
    verb: 'Vino',
    group: 'Sus visitas',
    suffix: 'veces',
    ops: [
      { op: 'gte', label: 'al menos' },
      { op: 'gt', label: 'más de' },
      { op: 'eq', label: 'exactamente' },
      { op: 'lte', label: 'como mucho' },
      { op: 'lt', label: 'menos de' },
    ],
    value: 'number',
    placeholder: '2',
  },
  days_since_last_visit: {
    verb: 'No viene desde hace',
    group: 'Sus visitas',
    suffix: 'días',
    ops: [
      { op: 'gte', label: 'más de' },
      { op: 'lte', label: 'menos de' },
      { op: 'eq', label: 'exactamente' },
    ],
    value: 'number',
    placeholder: '30',
  },
  total_spent_cents: {
    verb: 'Gastó en total',
    group: 'Sus visitas',
    ops: [
      { op: 'gte', label: 'al menos' },
      { op: 'gt', label: 'más de' },
      { op: 'lte', label: 'como mucho' },
      { op: 'lt', label: 'menos de' },
    ],
    value: 'pesos',
  },
  attended_event_id: {
    verb: 'Fue al evento',
    group: 'Sus visitas',
    ops: [{ op: 'eq', label: '' }],
    value: 'event',
  },
  opt_in_marketing: {
    verb: 'Acepta recibir promos por WhatsApp',
    group: 'WhatsApp',
    ops: [
      { op: 'is_true', label: 'sí' },
      { op: 'is_false', label: 'no' },
    ],
    value: 'boolean',
  },
  points_balance: {
    verb: 'Tiene disponibles',
    group: 'Club de puntos',
    suffix: 'puntos',
    ops: [
      { op: 'gte', label: 'al menos' },
      { op: 'gt', label: 'más de' },
      { op: 'lte', label: 'como mucho' },
      { op: 'lt', label: 'menos de' },
    ],
    value: 'number',
    placeholder: '100',
  },
  lifetime_points: {
    verb: 'Acumuló en total',
    group: 'Club de puntos',
    suffix: 'puntos',
    ops: [
      { op: 'gte', label: 'al menos' },
      { op: 'gt', label: 'más de' },
      { op: 'lte', label: 'como mucho' },
      { op: 'lt', label: 'menos de' },
    ],
    value: 'number',
    placeholder: '500',
  },
  current_tier_id: {
    verb: 'Es del nivel',
    group: 'Club de puntos',
    ops: [{ op: 'eq', label: '' }],
    value: 'tier',
  },
  birth_month: {
    verb: 'Cumple años en',
    group: 'Quién es',
    ops: [{ op: 'eq', label: '' }],
    value: 'month',
  },
  created_days_ago: {
    verb: 'Se sumó hace',
    group: 'Quién es',
    suffix: 'días',
    ops: [
      { op: 'lte', label: 'menos de' },
      { op: 'gte', label: 'más de' },
      { op: 'eq', label: 'exactamente' },
    ],
    value: 'number',
    placeholder: '7',
  },
  has_tag: {
    verb: 'Tiene la etiqueta',
    group: 'Quién es',
    ops: [{ op: 'eq', label: '' }],
    value: 'tag',
  },
  acquisition_channel: {
    verb: 'Llegó por',
    group: 'Quién es',
    ops: [{ op: 'eq', label: '' }],
    value: 'channel',
  },
  source: {
    verb: 'Se registró por',
    group: 'Quién es',
    ops: [{ op: 'eq', label: '' }],
    value: 'source',
  },
}

export const FIELD_ORDER: { group: string; fields: ConditionField[] }[] = [
  {
    group: 'Sus visitas',
    fields: ['visits_count', 'days_since_last_visit', 'total_spent_cents', 'attended_event_id'],
  },
  { group: 'WhatsApp', fields: ['opt_in_marketing'] },
  { group: 'Club de puntos', fields: ['points_balance', 'lifetime_points', 'current_tier_id'] },
  {
    group: 'Quién es',
    fields: ['birth_month', 'created_days_ago', 'has_tag', 'acquisition_channel', 'source'],
  },
]

export const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

// Los `value` son contrato con el compilador — solo cambia el label visible.
export const CHANNEL_OPTIONS = [
  { value: 'walkin', label: 'consumir en el local' },
  { value: 'reservation', label: 'una reserva' },
  { value: 'import', label: 'una lista importada' },
]

export const SOURCE_OPTIONS = [
  { value: 'qr', label: 'el QR de la mesa' },
  { value: 'manual', label: 'carga del staff' },
  { value: 'import', label: 'una lista importada' },
]

function lowerFirst(text: string): string {
  return text.charAt(0).toLocaleLowerCase('es-AR') + text.slice(1)
}

function valueLabel(
  condition: AudienceCondition,
  cfg: FieldConfig,
  options: AudienceBuilderOptions,
): string {
  const raw = condition.value
  if (raw === null || raw === undefined || raw === '') return '…'
  switch (cfg.value) {
    case 'pesos': {
      const cents = Number(raw)
      if (!Number.isFinite(cents)) return '…'
      return `$ ${Math.round(cents / 100).toLocaleString('es-AR')}`
    }
    case 'month': {
      const idx = Number(raw)
      return MONTHS[idx - 1] ?? '…'
    }
    case 'tier':
      return options.tiers.find((t) => t.id === raw)?.name ?? 'un nivel'
    case 'tag':
      return options.tags.find((t) => t.id === raw)?.name ?? 'una etiqueta'
    case 'event':
      return options.events.find((e) => e.id === raw)?.name ?? 'un evento'
    case 'channel':
      return CHANNEL_OPTIONS.find((o) => o.value === raw)?.label ?? String(raw)
    case 'source':
      return SOURCE_OPTIONS.find((o) => o.value === raw)?.label ?? String(raw)
    default:
      return String(raw)
  }
}

/** "Vino al menos 2 veces", "No acepta recibir promos por WhatsApp", "Es del nivel Oro". */
export function describeCondition(
  condition: AudienceCondition,
  options: AudienceBuilderOptions,
): string {
  const cfg = FIELD_SENTENCE[condition.field] as FieldConfig | undefined
  if (!cfg) return ''
  if (cfg.value === 'boolean') {
    return condition.op === 'is_false' ? `No ${lowerFirst(cfg.verb)}` : cfg.verb
  }
  const opLabel = cfg.ops.find((o) => o.op === condition.op)?.label ?? ''
  return [cfg.verb, opLabel, valueLabel(condition, cfg, options), cfg.suffix]
    .filter(Boolean)
    .join(' ')
}

function flattenConditions(filter: AudienceFilter): AudienceCondition[] {
  if (filter.kind === 'condition') return [filter]
  if (filter.kind === 'group') return filter.nodes.flatMap(flattenConditions)
  return []
}

function hasStaticList(filter: AudienceFilter): boolean {
  if (filter.kind === 'static_list') return true
  if (filter.kind === 'group') return filter.nodes.some(hasStaticList)
  return false
}

const MAX_SUMMARY_PARTS = 3

/**
 * Resume el filtro completo en UNA frase legible para el dueño:
 * "Vino al menos 2 veces y no viene desde hace más de 30 días".
 */
export function summarizeFilter(filter: AudienceFilter, options: AudienceBuilderOptions): string {
  const conditions = flattenConditions(filter)
  const parts = conditions.map((c) => describeCondition(c, options)).filter(Boolean)
  if (hasStaticList(filter)) parts.push('Está en una lista fija de clientes')
  if (parts.length === 0) return 'Todos tus clientes, sin condiciones.'

  const op = filter.kind === 'group' ? filter.op : 'AND'
  const joiner = op === 'AND' ? ' y ' : ' o '
  const sentences = parts.map((p, i) => (i === 0 ? p : lowerFirst(p)))
  if (sentences.length <= MAX_SUMMARY_PARTS) return sentences.join(joiner)

  const rest = sentences.length - MAX_SUMMARY_PARTS
  return `${sentences.slice(0, MAX_SUMMARY_PARTS).join(joiner)}${joiner}${rest} ${
    rest === 1 ? 'condición más' : 'condiciones más'
  }`
}
