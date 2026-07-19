/**
 * Helpers puros para mostrar plantillas de WhatsApp en la UI del chat.
 * Sin dependencias de server — se usan también en Client Components.
 */

export type TemplateLite = {
  id: string
  name: string
  language: string
  category: string
  components: unknown
}

/** Texto del componente BODY de un template de Meta, o null si no existe. */
export function getTemplateBodyText(components: unknown): string | null {
  if (!Array.isArray(components)) return null
  for (const c of components) {
    if (c && typeof c === 'object' && (c as Record<string, unknown>).type === 'BODY') {
      const text = (c as { text?: unknown }).text
      return typeof text === 'string' ? text : null
    }
  }
  return null
}

/** Cantidad de variables {{n}} en el BODY del template. */
export function countBodyVariables(components: unknown): number {
  const text = getTemplateBodyText(components)
  if (!text) return 0
  const matches = text.match(/\{\{\d+\}\}/g)
  return matches ? matches.length : 0
}

/** Reemplaza {{1}}, {{2}}… por los valores cargados (deja el marcador si falta). */
export function fillTemplateBody(body: string, variables: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (match, n: string) => {
    const value = variables[Number(n) - 1]
    return value && value.trim() !== '' ? value : match
  })
}

/**
 * Los mensajes salientes de plantilla se guardan como `[template:NOMBRE] v1 | v2`.
 * Devuelve nombre y variables, o null si el contenido no es una plantilla.
 */
export function parseTemplateContent(
  content: string,
): { name: string; variables: string[] } | null {
  const match = content.match(/^\[template:([^\]]+)\]\s*(.*)$/s)
  if (!match) return null
  const name = match[1] ?? ''
  const rest = (match[2] ?? '').trim()
  const variables = rest === '' ? [] : rest.split(' | ').map((v) => v.trim())
  return { name, variables }
}

/** `bienvenida_hub_v2` → `Bienvenida hub v2` (para dueños, sin snake_case). */
export function humanizeTemplateName(name: string): string {
  const clean = name.replace(/[_-]+/g, ' ').trim()
  if (clean === '') return name
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

/** Categorías de Meta traducidas a español llano. */
export const TEMPLATE_CATEGORY_LABEL: Record<string, string> = {
  MARKETING: 'Promoción',
  UTILITY: 'Aviso',
  AUTHENTICATION: 'Verificación',
}

/**
 * Cuerpo final de un mensaje de plantilla ya enviado, listo para mostrar en el
 * hilo como si fuera texto normal. Null si no se puede resolver el template.
 */
export function renderSentTemplate(
  content: string,
  templates: TemplateLite[],
): { name: string; body: string | null } | null {
  const parsed = parseTemplateContent(content)
  if (!parsed) return null
  const template = templates.find((t) => t.name === parsed.name)
  const bodyText = template ? getTemplateBodyText(template.components) : null
  return {
    name: parsed.name,
    body: bodyText ? fillTemplateBody(bodyText, parsed.variables) : null,
  }
}
