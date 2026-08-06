import type { MessageStatus } from '@/types/database'

export type MetaApiErrorPayload = {
  message?: string
  type?: string
  code?: number
  error_subcode?: number
  error_data?: { details?: string }
  /** Textos que Meta marca como mostrables al usuario final. */
  error_user_title?: string
  error_user_msg?: string
  fbtrace_id?: string
}

export class MetaApiError extends Error {
  readonly code: number | null
  readonly subcode: number | null
  readonly status: number
  readonly fbtraceId: string | null
  /**
   * `error_data.details` — la explicación en prosa que manda Meta. Es lo más
   * útil que devuelve la API (la doc recomienda ramificar por `code` + este
   * campo, no por el título, que está deprecado).
   */
  readonly details: string | null
  readonly userMessage: string | null

  constructor(status: number, payload: MetaApiErrorPayload) {
    super(payload.message ?? `Meta API error ${status}`)
    this.code = payload.code ?? null
    this.subcode = payload.error_subcode ?? null
    this.status = status
    this.fbtraceId = payload.fbtrace_id ?? null
    this.details = payload.error_data?.details ?? null
    this.userMessage = payload.error_user_msg ?? null
  }
}

// Mapear errores Meta a estado interno + mensaje legible para el usuario.
// Códigos relevantes (de docs Cloud API): 131026 fuera de ventana 24h,
// 131047 re-engagement message, 131051 unsupported message type,
// 131056 pair rate limit, 190 token expirado.
export function mapMetaErrorToStatus(err: MetaApiError): {
  status: MessageStatus
  reason: string
} {
  const code = err.code
  if (code === 131026) {
    return { status: 'failed', reason: 'Fuera de la ventana de 24 h. Usá un template aprobado.' }
  }
  if (code === 131047) {
    return { status: 'failed', reason: 'Se requiere un template de re-engagement.' }
  }
  if (code === 131051) {
    return { status: 'failed', reason: 'Tipo de mensaje no soportado por el destinatario.' }
  }
  if (code === 131056 || code === 80007) {
    return { status: 'failed', reason: 'Rate limit de Meta. Reintentá en unos minutos.' }
  }
  if (code === 190 || code === 102 || code === 463) {
    return { status: 'failed', reason: 'Token de acceso inválido o expirado. Reconectá el canal.' }
  }
  return { status: 'failed', reason: err.message || `Error Meta ${code ?? err.status}` }
}

/**
 * Traduce a criollo los errores de crear/borrar plantillas de WhatsApp.
 *
 * El alta de plantillas es de las pocas pantallas donde el dueño choca de
 * frente con la API de Meta: hasta ahora le llegaba el mensaje crudo
 * ("(#100) Invalid parameter") y la conclusión razonable era "esto no anda,
 * lo hago desde Meta". Los códigos salen de la doc oficial de errores de la
 * Business Management API; para los que no mapeamos, mostramos el
 * `error_data.details` de Meta, que suele explicar el problema.
 */
const TEMPLATE_ERROR_BY_CODE: Record<number, string> = {
  // Límite de plantillas de la cuenta.
  2388019: 'Llegaste al máximo de plantillas de tu cuenta de WhatsApp. Borrá alguna que no uses.',
  // Plantilla en revisión: no se puede tocar.
  2388039: 'Esta plantilla está en revisión de WhatsApp: hasta que resuelvan no se puede cambiar.',
  2388040: 'Te pasaste del largo permitido en alguno de los textos. Acortalo y probá de nuevo.',
  2388047: 'El encabezado tiene un formato que WhatsApp no acepta (revisá negritas y variables).',
  2388072: 'El cuerpo tiene un formato que WhatsApp no acepta (revisá negritas y variables).',
  2388073:
    'El pie tiene un formato que WhatsApp no acepta. Dejalo como texto simple, sin variables.',
  2388293:
    'Hay demasiadas variables para lo corto que es el mensaje. Escribí más texto fijo o sacá alguna variable.',
  2388299:
    'El mensaje no puede empezar ni terminar con una variable. Poné texto antes y después de {{1}}.',
}

export function humanizeTemplateError(error: unknown): string {
  if (!(error instanceof MetaApiError)) {
    const message = error instanceof Error ? error.message : ''
    return message || 'No pudimos crear la plantilla. Probá de nuevo en un rato.'
  }

  const mapped = error.code !== null ? TEMPLATE_ERROR_BY_CODE[error.code] : undefined
  if (mapped) return mapped

  if (error.code === 190 || error.code === 102 || error.code === 463) {
    return 'Se venció la conexión con WhatsApp. Reconectá el canal en Mensajería → Canales.'
  }
  if (error.code === 4 || error.code === 80007 || error.code === 613) {
    return 'WhatsApp está limitando los pedidos. Esperá unos minutos y probá de nuevo.'
  }
  if (error.code === 200 || error.code === 10 || error.code === 803) {
    return 'Tu cuenta de WhatsApp no tiene permiso para administrar plantillas. Revisá los permisos en Canales.'
  }
  if (/already exists|duplicate/i.test(error.details ?? error.message)) {
    return 'Ya existe una plantilla con ese nombre. Poné otro nombre (por ejemplo, agregale _v2).'
  }

  // Sin mapa: lo que diga Meta, que casi siempre explica el problema.
  const fromMeta = error.userMessage ?? error.details
  if (fromMeta) return `WhatsApp rechazó la plantilla: ${fromMeta}`
  return `WhatsApp rechazó la plantilla${error.code !== null ? ` (error ${error.code})` : ''}. Revisá los textos y probá de nuevo.`
}
