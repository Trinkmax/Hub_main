import type { StatusMap } from '@/components/ui/status-badge'
import type { TemplateStatus } from '@/types/database'

/**
 * Traducciones y helpers de presentación de plantillas, compartidos entre la
 * lista (server) y los diálogos (client). Solo copy y mapeos — acá no viven
 * contratos: el `name` técnico que viaja a Meta nunca se transforma al enviar.
 */

/**
 * Estado de una plantilla para `StatusBadge`. La `description` es la
 * explicación corta para el dueño: la tarjeta la muestra debajo del mensaje
 * (y el badge la lleva como `title`). Vive acá hasta que exista
 * `lib/meta/status-meta.ts` (el lote no toca `lib/`).
 */
export const TEMPLATE_STATUS: StatusMap<TemplateStatus> = {
  approved: {
    label: 'Aprobada',
    tone: 'success',
  },
  pending: {
    label: 'En revisión',
    tone: 'warning',
    description: 'WhatsApp la está revisando. Suele tardar entre unos minutos y 24 horas.',
  },
  rejected: {
    label: 'Rechazada',
    tone: 'danger',
    description: 'WhatsApp no la aprobó. Ajustá el texto y creá una versión nueva.',
  },
  draft: {
    label: 'Borrador',
    tone: 'neutral',
    description: 'Todavía no se mandó a revisión de WhatsApp.',
  },
  disabled: {
    label: 'Pausada',
    tone: 'neutral',
    description: 'WhatsApp la pausó y por ahora no se puede usar.',
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

/**
 * El texto de una plantilla de VERIFICACIÓN lo escribe Meta (no el bar) y
 * nuestra copia local puede no traerlo hasta el próximo sync. Es siempre el
 * mismo por idioma, así que el preview lo muestra igual.
 */
export function authenticationPreview(
  language: string,
  codeExpirationMinutes: number | null,
): { body: string; footer: string | null } {
  const spanish = language.toLowerCase().startsWith('es')
  const body = spanish
    ? '*{{1}}* es tu código de verificación. Por tu seguridad, no lo compartas.'
    : '*{{1}}* is your verification code. For your security, do not share this code.'
  const footer =
    codeExpirationMinutes === null
      ? null
      : spanish
        ? `Este código caduca en ${codeExpirationMinutes} minutos.`
        : `This code expires in ${codeExpirationMinutes} minutes.`
  return { body, footer }
}
