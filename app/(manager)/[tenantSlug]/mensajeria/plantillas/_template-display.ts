import type { TemplateStatus } from '@/types/database'

/**
 * Traducciones y helpers de presentación de plantillas, compartidos entre la
 * lista (server) y los diálogos (client). Solo copy y mapeos — acá no viven
 * contratos: el `name` técnico que viaja a Meta nunca se transforma al enviar.
 */

export type StatusMeta = {
  label: string
  variant: 'success' | 'warning' | 'destructive' | 'muted'
  /** Explicación corta para el dueño. `null` cuando el badge alcanza. */
  hint: string | null
}

export const STATUS_META: Record<TemplateStatus, StatusMeta> = {
  approved: {
    label: 'Aprobada',
    variant: 'success',
    hint: null,
  },
  pending: {
    label: 'En revisión',
    variant: 'warning',
    hint: 'WhatsApp la está revisando. Suele tardar entre unos minutos y 24 horas.',
  },
  rejected: {
    label: 'Rechazada',
    variant: 'destructive',
    hint: 'WhatsApp no la aprobó. Ajustá el texto y creá una versión nueva.',
  },
  draft: {
    label: 'Borrador',
    variant: 'muted',
    hint: 'Todavía no se mandó a revisión de WhatsApp.',
  },
  disabled: {
    label: 'Pausada',
    variant: 'muted',
    hint: 'WhatsApp la pausó y por ahora no se puede usar.',
  },
}

export const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: 'Promoción',
  UTILITY: 'Aviso',
  AUTHENTICATION: 'Verificación',
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category.toUpperCase()] ?? category
}

const LANGUAGE_LABELS: Record<string, string> = {
  es_AR: 'Español (Argentina)',
  es_MX: 'Español (México)',
  es_ES: 'Español (España)',
  es: 'Español',
  en_US: 'Inglés (EE. UU.)',
  en_GB: 'Inglés (Reino Unido)',
  en: 'Inglés',
  pt_BR: 'Portugués (Brasil)',
  pt_PT: 'Portugués (Portugal)',
}

export function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] ?? code
}

/**
 * `bienvenida_nuevo_cliente` → `Bienvenida nuevo cliente`. Solo para mostrar:
 * el nombre técnico sigue siendo el que identifica la plantilla en Meta.
 */
export function humanizeTemplateName(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim()
  if (!words) return name
  return words.charAt(0).toUpperCase() + words.slice(1)
}
