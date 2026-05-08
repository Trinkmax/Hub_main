import type { MessageStatus } from '@/types/database'

export type MetaApiErrorPayload = {
  message?: string
  type?: string
  code?: number
  error_subcode?: number
  error_data?: { details?: string }
  fbtrace_id?: string
}

export class MetaApiError extends Error {
  readonly code: number | null
  readonly subcode: number | null
  readonly status: number
  readonly fbtraceId: string | null

  constructor(status: number, payload: MetaApiErrorPayload) {
    super(payload.message ?? `Meta API error ${status}`)
    this.code = payload.code ?? null
    this.subcode = payload.error_subcode ?? null
    this.status = status
    this.fbtraceId = payload.fbtrace_id ?? null
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
