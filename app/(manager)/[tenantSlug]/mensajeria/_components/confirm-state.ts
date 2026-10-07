import type { ConfirmFormState } from '@/components/ui/confirm-dialog'

/**
 * Las Server Actions de mensajería devuelven `{ ok, message }`; el
 * `ConfirmDialog` del kit (modo `formAction`) espera `{ ok, error }`. Este
 * puente traduce sin tocar las acciones: si sale bien el diálogo se cierra; si
 * falla queda abierto con el motivo adentro, en lugar de un toast que se va.
 */
type MessagingActionResult = { ok: true; message?: string } | { ok: false; message: string }

const GENERIC_ERROR = 'No se pudo completar. Probá de nuevo en un momento.'

export function toConfirmState(
  result: MessagingActionResult,
  errorPrefix?: string,
): ConfirmFormState {
  if (result.ok) return { ok: true }
  const reason = result.message?.trim() || GENERIC_ERROR
  return { ok: false, error: errorPrefix ? `${errorPrefix} ${reason}` : reason }
}
