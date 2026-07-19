import {
  Clock,
  GitBranch,
  type LucideIcon,
  MessageSquareText,
  Tag as TagIcon,
  Zap,
} from 'lucide-react'
import type { FlowTriggerConfig } from '@/lib/flows/schemas'

// Metadatos compartidos entre el editor de grafo y el builder legacy:
// mismas etiquetas, mismos iconos y mismos colores por tipo de paso,
// para que la paleta y los nodos del canvas se asocien de un vistazo.
// IMPORTANTE: las claves ('trigger', 'send_template', …) son el contrato
// con el backend y NO se traducen — solo lo visible.

export type StepKind = 'trigger' | 'send_template' | 'wait' | 'condition' | 'add_tag'

export const KIND_LABEL: Record<StepKind, string> = {
  trigger: 'Disparador',
  send_template: 'Mandar mensaje',
  wait: 'Esperar',
  condition: 'Si se cumple…',
  add_tag: 'Poner etiqueta',
}

export const KIND_HINT: Record<StepKind, string> = {
  trigger: 'Cuándo arranca',
  send_template: 'Un mensaje aprobado de WhatsApp',
  wait: 'Un rato, horas o días',
  condition: 'Sigue por Sí o por No',
  add_tag: 'Marca al cliente',
}

export const KIND_ICON: Record<StepKind, LucideIcon> = {
  trigger: Zap,
  send_template: MessageSquareText,
  wait: Clock,
  condition: GitBranch,
  add_tag: TagIcon,
}

// Chip de color por tipo de paso. El verde de WhatsApp usa los tokens
// --wa-* que solo existen dentro del frame de mensajería — este módulo
// siempre se renderiza ahí (no portaliza a <body>).
export const KIND_CHIP_CLASS: Record<StepKind, string> = {
  trigger: 'border-primary/30 bg-primary/10 text-primary',
  send_template: 'border-(--wa-accent-soft) bg-(--wa-accent-soft) text-(--wa-accent-deep)',
  wait: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  condition: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  add_tag: 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400',
}

// ─── Canales ─────────────────────────────────────────────────────────────────

// Nombre visible del tipo de canal cuando el canal no tiene display_name.
// Nunca mostrar el string crudo 'whatsapp'/'instagram' al dueño.
export const CHANNEL_TYPE_LABEL: Record<'whatsapp' | 'instagram', string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
}

// ─── Disparadores ────────────────────────────────────────────────────────────

export const TRIGGER_TYPE_LABEL: Record<FlowTriggerConfig['type'], string> = {
  customer_inactive: 'Hace tiempo que no viene',
  birthday: 'Cumple años',
  after_visit: 'Después de una visita',
  event_starting: 'Se acerca un evento',
  tag_added: 'Le ponés una etiqueta',
}

export function triggerSummary(
  cfg: FlowTriggerConfig,
  tags?: Array<{ id: string; name: string }>,
): string {
  switch (cfg.type) {
    case 'after_visit':
      return 'Después de una visita'
    case 'birthday': {
      const d = cfg.offset_days ?? 0
      if (d === 0) return 'El día del cumpleaños'
      const abs = Math.abs(d)
      const unit = abs === 1 ? 'día' : 'días'
      return d < 0 ? `${abs} ${unit} antes del cumpleaños` : `${abs} ${unit} después del cumpleaños`
    }
    case 'customer_inactive':
      return cfg.days === 1 ? 'Hace 1 día que no viene' : `Hace ${cfg.days} días que no viene`
    case 'event_starting':
      return cfg.hours_before === 1
        ? '1 hora antes de un evento'
        : `${cfg.hours_before} horas antes de un evento`
    case 'tag_added': {
      const name = tags?.find((t) => t.id === cfg.tag_id)?.name
      return name ? `Cuando le ponés “${name}”` : 'Cuando le ponés una etiqueta'
    }
  }
}

// ─── Esperar ─────────────────────────────────────────────────────────────────

export type WaitUnit = 'minutes' | 'hours' | 'days'

export const WAIT_UNIT_FACTOR: Record<WaitUnit, number> = { minutes: 1, hours: 60, days: 1440 }

export const WAIT_UNIT_LABEL: Record<WaitUnit, string> = {
  minutes: 'minutos',
  hours: 'horas',
  days: 'días',
}

export const MAX_WAIT_MINUTES = 43_200 // 30 días, tope del backend

export function minutesToParts(minutes: number): { amount: number; unit: WaitUnit } {
  if (minutes >= 1440 && minutes % 1440 === 0) return { amount: minutes / 1440, unit: 'days' }
  if (minutes >= 60 && minutes % 60 === 0) return { amount: minutes / 60, unit: 'hours' }
  return { amount: minutes, unit: 'minutes' }
}

export function waitSummary(minutes: number): string {
  const { amount, unit } = minutesToParts(minutes)
  const label =
    unit === 'days'
      ? amount === 1
        ? 'día'
        : 'días'
      : unit === 'hours'
        ? amount === 1
          ? 'hora'
          : 'horas'
        : amount === 1
          ? 'minuto'
          : 'minutos'
  return `${amount} ${label}`
}

// ─── Condición ───────────────────────────────────────────────────────────────

export type ConditionFieldKind = 'boolean' | 'number' | 'money'

// Campos del cliente que el motor sabe evaluar (ver lib/flows/runtime.ts).
// El valor es el contrato que viaja al backend; la etiqueta es lo visible.
export const CONDITION_FIELDS: Array<{
  value: string
  label: string
  kind: ConditionFieldKind
}> = [
  { value: 'customer.opt_in_marketing', label: 'Acepta recibir promos', kind: 'boolean' },
  { value: 'customer.total_visits', label: 'Cantidad de visitas', kind: 'number' },
  { value: 'customer.points_balance', label: 'Puntos que tiene', kind: 'number' },
  { value: 'customer.total_spent_cents', label: 'Plata gastada en total', kind: 'money' },
]

export const OP_LABEL: Record<string, string> = {
  eq: 'es exactamente',
  neq: 'es distinto de',
  gt: 'es más de',
  gte: 'es como mínimo',
  lt: 'es menos de',
  lte: 'es como máximo',
  is_true: 'es Sí',
  is_false: 'es No',
}

export function opsForFieldKind(kind: ConditionFieldKind | 'custom'): string[] {
  if (kind === 'boolean') return ['is_true', 'is_false']
  if (kind === 'number' || kind === 'money') return ['gte', 'gt', 'eq', 'neq', 'lte', 'lt']
  return ['is_true', 'is_false', 'eq', 'neq', 'gte', 'gt', 'lte', 'lt']
}

const arsFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

export function formatPesosFromCents(cents: number): string {
  return arsFormatter.format(cents / 100)
}

export function conditionSummary(field: string, op: string, value: unknown): string {
  if (!field) return 'Elegí qué mirar del cliente'
  const meta = CONDITION_FIELDS.find((f) => f.value === field)
  const label = meta?.label ?? field
  if (op === 'is_true') return `${label}: Sí`
  if (op === 'is_false') return `${label}: No`
  let shown = '…'
  if (value !== undefined && value !== null && value !== '') {
    const num = Number(value)
    shown =
      meta?.kind === 'money' && Number.isFinite(num) ? formatPesosFromCents(num) : String(value)
  }
  return `${label} ${OP_LABEL[op] ?? op} ${shown}`
}
