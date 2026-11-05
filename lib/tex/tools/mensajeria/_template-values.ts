import {
  categoryLabel,
  languageLabel,
  STATUS_META,
} from '@/app/(manager)/[tenantSlug]/mensajeria/plantillas/_template-display'
import { humanizeTemplateName } from '@/lib/bandeja/template-view'
import {
  templateBodyParamCount,
  VARIABLE_SOURCES,
  type VariableSourceKey,
  variableLabel,
} from '@/lib/broadcasts/variables'
import { parseMetaComponents } from '@/lib/meta/template-components'
import type { ChannelType, TemplateStatus } from '@/types/database'
import { matchByName, type NameMatch } from '../actions/_gastos-values'
import { dateTimeText, safeText } from './_common'

/** Las plantillas, puras: con las mismas palabras de Mensajería › Plantillas. */

const BODY_MAX = 300
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type TemplateRow = {
  id: string
  name: string
  language: string
  category: string
  status: TemplateStatus
  channel_id: string
  components: unknown
  variable_hints: unknown
  last_synced_at: string | null
}

/** Como la nombra el bar: `bienvenida_hub` → `Bienvenida hub`. El nombre técnico es el que va a Meta. */
export function templateTitle(template: Pick<TemplateRow, 'name'>): string {
  return humanizeTemplateName(template.name)
}

/** El nombre técnico o el del bar, sin diferencia: la gente no sabe de guiones bajos. */
export function matchTemplate<T extends Pick<TemplateRow, 'id' | 'name'>>(
  rows: readonly T[],
  wanted: string,
): NameMatch<T> {
  const key = UUID_RE.test(wanted.trim()) ? wanted : wanted.replace(/[_-]+/g, ' ')
  const match = matchByName(
    rows.map((row) => ({ id: row.id, name: templateTitle(row), row })),
    key,
  )
  return match.ok ? { ok: true, value: match.value.row } : match
}

/** `variable_hints` (`{"1":"first_name"}`): lo que no es una fuente conocida se ignora, como el form. */
export function parseHints(raw: unknown): Record<string, VariableSourceKey> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, VariableSourceKey> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && VARIABLE_SOURCES.includes(value as VariableSourceKey)) {
      out[key] = value as VariableSourceKey
    }
  }
  return out
}

/** Sus huecos `{{n}}` y qué lleva cada uno, si la plantilla lo recuerda. */
export function templateHoles(
  template: Pick<TemplateRow, 'components' | 'variable_hints'>,
): Array<{ numero: number; dato: string }> {
  const hints = parseHints(template.variable_hints)
  return Array.from({ length: templateBodyParamCount(template.components) }, (_, index) => {
    const numero = index + 1
    const hint = hints[String(numero)]
    return { numero, dato: hint ? variableLabel(hint) : 'sin definir' }
  })
}

/** Por qué no se puede usar para un mensaje a un cliente. `null`: se puede. */
export function templateUseProblem(
  template: Pick<TemplateRow, 'name' | 'status' | 'category'>,
): string | null {
  const title = templateTitle(template)
  if (template.status !== 'approved') {
    const meta = STATUS_META[template.status]
    return `«${title}» está ${meta.label.toLowerCase()}: solo salen las aprobadas.${meta.hint ? ` ${meta.hint}` : ''}`
  }
  if (template.category.toUpperCase() === 'AUTHENTICATION') {
    return `«${title}» es de Verificación: es la que manda los códigos del club, no sirve para esto.`
  }
  return null
}

export function templateData(template: TemplateRow) {
  const parts = parseMetaComponents(template.components)
  const holes = templateHoles(template)
  const meta = STATUS_META[template.status]
  return {
    id: template.id,
    nombre: templateTitle(template),
    estado: meta.label,
    categoria: categoryLabel(template.category),
    idioma: languageLabel(template.language),
    ...(parts.body ? { texto: safeText(parts.body, BODY_MAX) } : {}),
    ...(holes.length > 0 ? { huecos: holes } : {}),
    ...(parts.buttons.length > 0 ? { botones: parts.buttons } : {}),
    ...(meta.hint ? { aclaracion: meta.hint } : {}),
    ...(template.last_synced_at ? { actualizada: dateTimeText(template.last_synced_at) } : {}),
  }
}

export type ChannelLike = { type: ChannelType; status: string } | null

/** Por qué no sale nada por este canal. `null`: sale. */
export function channelProblem(
  channel: ChannelLike,
  only: ChannelType | null = null,
): string | null {
  if (!channel) {
    return 'No encontré el canal: se revisa en Mensajería › Canales (ir_a a mensajeria.canales).'
  }
  const word = channel.type === 'whatsapp' ? 'WhatsApp' : 'Instagram'
  if (only && channel.type !== only) {
    return `Eso solo sale por ${only === 'whatsapp' ? 'WhatsApp' : 'Instagram'}, y este chat es de ${word}.`
  }
  if (channel.status !== 'connected') {
    return `${word} no está conectado, así que no sale nada. Se arregla en Mensajería › Canales (ir_a a mensajeria.canales).`
  }
  return null
}
