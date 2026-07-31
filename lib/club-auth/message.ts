/**
 * Armado del mensaje de recuperación que le llega al socio por WhatsApp.
 *
 * Puro y sin `server-only`: el texto es lo único que el socio ve del sistema de
 * contraseñas, así que se testea sin levantar Supabase ni pegarle a Meta.
 */

/**
 * Plantilla UTILITY para cuando el socio está FUERA de la ventana de 24 h.
 * Configurable por env porque cada bar la crea y la aprueba en su propia cuenta
 * de Meta con el nombre que quiera.
 */
const DEFAULT_OTP_TEMPLATE = 'hub_codigo_recuperacion'

/** Idioma con el que se manda la plantilla si el tenant no la tiene sincronizada. */
export const CLUB_OTP_TEMPLATE_FALLBACK_LANGUAGE = 'es_AR'

export function getClubOtpTemplateName(): string {
  return process.env.CLUB_OTP_TEMPLATE_NAME || DEFAULT_OTP_TEMPLATE
}

/** Nombre para saludar. Sin nombre cargado, saludo neutro (nunca "Hola , "). */
function greeting(firstName: string | null | undefined): string {
  const name = firstName?.trim()
  return name ? `Hola ${name}` : 'Hola'
}

/**
 * Texto libre (dentro de la ventana de 24 h). Sin links: un OTP con link es
 * exactamente la forma de un phishing y entrena mal al socio.
 */
export function buildClubOtpText(opts: {
  firstName: string | null
  tenantName: string
  code: string
}): string {
  return (
    `${greeting(opts.firstName)}, tu código para entrar al club de ${opts.tenantName} es ${opts.code}.\n\n` +
    'Vence en 10 minutos y es de un solo uso. Si no lo pediste vos, ignorá este mensaje ' +
    'y no se lo pases a nadie.'
  )
}

/**
 * Cuántas variables declara el BODY de una plantilla ya aprobada.
 *
 * Existe porque Meta puede empujar el OTP a la categoría AUTHENTICATION, cuyo
 * cuerpo es fijo y tiene UNA sola variable (el código). Mandarle dos la hace
 * fallar con "number of parameters does not match", así que leemos lo que el
 * tenant realmente tiene aprobado en vez de asumir. `null` = no se pudo saber.
 */
export function countTemplateBodyVariables(components: unknown): number | null {
  if (!Array.isArray(components)) return null
  for (const component of components) {
    if (typeof component !== 'object' || component === null) continue
    const record = component as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type.toUpperCase() : null
    if (type !== 'BODY') continue
    if (typeof record.text !== 'string') return null
    return new Set(record.text.match(/\{\{\s*\d+\s*\}\}/g) ?? []).size
  }
  return null
}

/**
 * Variables de la plantilla, en orden: {{1}} nombre, {{2}} código. Con una sola
 * variable (AUTHENTICATION) va sólo el código. Meta rechaza variables vacías,
 * de ahí el fallback del nombre.
 */
export function buildClubOtpTemplateVariables(opts: {
  firstName: string | null
  code: string
  variableCount?: number | null
}): string[] {
  if (opts.variableCount === 1) return [opts.code]
  const name = opts.firstName?.trim()
  return [name && name.length > 0 ? name : 'socio', opts.code]
}

/** Preview que queda en la bandeja del bar. El código NUNCA se persiste. */
export function buildClubOtpConversationPreview(templateName: string | null): string {
  return templateName
    ? `[template:${templateName}] código de recuperación del club`
    : 'Código de recuperación del club (enviado)'
}
