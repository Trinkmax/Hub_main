import { formatCentsShort } from '@/lib/money'
import { type PosError, toPosError } from '@/lib/pos/errors'

/**
 * De los códigos que tiran las RPC de cobro y caja a una frase que quien está
 * cobrando entiende y puede resolver. Lo que no es de acá (mesa que no existe,
 * sin permiso, sesión vencida…) lo traduce `toPosError`, el de siempre.
 */
const MESSAGES: Record<string, string> = {
  // Cobrar
  no_open_shift: 'La caja está cerrada: hay que abrir el turno antes de cobrar.',
  shift_required: 'Hay más de una caja abierta: elegí en cuál entra este cobro.',
  shift_not_open: 'Ese turno ya se cerró.',
  shift_not_found: 'No encontré ese turno.',
  method_invalid: 'Elegí un medio de pago.',
  amount_invalid: 'Revisá el monto.',
  tip_invalid: 'Revisá la propina.',
  idempotency_key_invalid: 'No se pudo completar. Probá de nuevo.',
  amount_exceeds_remaining: 'Es más de lo que falta cobrar.',
  nothing_to_pay: 'Esa mesa ya no debe nada.',
  tendered_too_low: 'Lo que entregó no alcanza para ese monto.',
  items_invalid: 'Alguno de esos productos ya no está en la mesa.',
  items_already_paid: 'Alguno de esos productos ya está cobrado: actualizá la cuenta.',
  // Cerrar la mesa
  bill_not_settled: 'Todavía falta cobrar una parte.',
  bill_overpaid: 'Quedó cobrado de más: anulá un cobro y cobralo de nuevo.',
  nothing_to_charge: 'Esa mesa no tiene consumo: se libera, no se cobra.',
  close_needs_approver: 'La cuenta quedó en cero sin ningún cobro: la mesa la cierra el encargado.',
  // Anular y corregir
  payment_not_found: 'No encontré ese cobro.',
  payment_voided: 'Ese cobro está anulado.',
  table_already_closed: 'La mesa ya se cerró: el cobro se corrige, no se anula.',
  closed_shift_owner_only: 'El turno ya cerró: eso lo corrige un dueño.',
  // Descuentos, bajas y pedidos
  discount_invalid: 'Revisá el descuento.',
  discount_not_found: 'No encontré ese descuento.',
  discount_exceeds_remaining: 'Con ese descuento quedaría cobrado de más.',
  item_already_paid: 'Ese producto ya está cobrado: no se puede dar de baja.',
  approval_not_found: 'No encontré ese pedido.',
  // El de siempre habla de bajas; acá el motivo también es de un descuento, una anulación o un retiro.
  reason_required: 'Contame el motivo.',
  // Caja
  register_not_found: 'No encontré esa caja.',
  register_required: 'Hay más de una caja: elegí cuál abrís.',
  movement_not_found: 'No encontré ese movimiento.',
  movement_kind_invalid: 'Decime si la plata entra o sale.',
  photo_path_invalid: 'No pude guardar la foto. Probá de nuevo.',
  count_invalid: 'Revisá el conteo.',
  count_mismatch: 'El conteo no suma el total: revisá los billetes.',
  leave_float_invalid: 'No podés dejar de cambio más de lo que contaste.',
}

/** Del más largo al más corto. */
const CODES: ReadonlyArray<string> = Object.keys(MESSAGES).sort((a, b) => b.length - a.length)

/** `detail` trae, cuando hay, el monto en centavos que explica el error (lo que falta, lo que sobra). */
export function toCashError(error: { message?: string; details?: string | null } | null): PosError {
  const raw = (error?.message ?? '').trim()
  // Primero el código exacto; si viene envuelto en más texto, el más largo que aparezca (así un
  // código nunca se confunde con otro que lo contenga).
  const code = CODES.includes(raw) ? raw : CODES.find((key) => raw.includes(key))
  if (!code) return toPosError(error)

  const detail = error?.details?.trim() || null
  const base = MESSAGES[code] ?? 'No se pudo completar. Probá de nuevo.'
  const cents = detail && /^\d+$/.test(detail) ? Number(detail) : null
  let message = base
  if (cents !== null && code === 'amount_exceeds_remaining') {
    message = `Es más de lo que falta: quedan ${formatCentsShort(cents)}.`
  } else if (cents !== null && code === 'bill_not_settled') {
    message = `Todavía faltan ${formatCentsShort(cents)}.`
  } else if (cents !== null && code === 'bill_overpaid') {
    message = `Quedaron ${formatCentsShort(cents)} cobrados de más: anulá un cobro y cobralo de nuevo.`
  }
  return { code, message, detail }
}
