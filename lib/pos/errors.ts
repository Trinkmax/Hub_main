/**
 * De los códigos que tiran las RPC `pos_*` a una frase que el mozo entiende y
 * puede resolver. Lo que no está en la lista cae en un mensaje genérico (y el
 * código queda en el log del servidor, sin datos del cliente).
 */
const MESSAGES: Record<string, string> = {
  unauthenticated: 'Se cerró tu sesión. Volvé a entrar.',
  forbidden: 'No tenés permiso para hacer esto.',
  pos_disabled: 'El punto de venta no está prendido en este bar.',
  table_not_found: 'Esa mesa ya no existe o está desactivada.',
  table_busy: 'Esa mesa ya está ocupada.',
  party_size_invalid: 'Decime cuántos son (entre 1 y 100).',
  reservation_not_found: 'No encontré esa reserva.',
  reservation_not_available: 'Esa reserva está cancelada o cerrada.',
  reservation_already_seated: 'Esa reserva ya está sentada en otra mesa.',
  customer_not_found: 'No encontré ese socio.',
  session_not_found: 'Esa mesa ya no está abierta.',
  session_not_open: 'Esa mesa ya se cerró.',
  empty_order: 'El pedido está vacío.',
  order_too_long: 'El pedido es demasiado largo: mandalo en dos partes.',
  item_not_available: 'Ese producto ya no está en la carta.',
  item_sold_out: 'Se agotó.',
  option_not_available: 'Una aclaración ya no está disponible.',
  invalid_quantity: 'Revisá las cantidades.',
  too_many_options: 'Son demasiadas aclaraciones para un solo producto.',
  ticket_not_found: 'No encontré esa tanda.',
  ticket_cancelled: 'Esa tanda está cancelada.',
  ticket_not_in_kitchen: 'Esa tanda todavía no salió a cocina.',
  item_not_found: 'No encontré ese producto en la mesa.',
  item_already_paid: 'Ese producto ya está cobrado: no se puede dar de baja.',
  needs_approval: 'Esa baja la tiene que dar el encargado.',
  reason_required: 'Contame por qué se da de baja.',
  branch_not_found: 'No encontré esa sucursal.',
  invalid_status: 'No se puede pasar a ese estado.',
  table_has_payments: 'Esa mesa ya tiene cobros: no se libera, se termina de cobrar.',
  table_has_consumption: 'Esa mesa tiene productos cargados: dalos de baja o cobrala.',
  pos_session_has_payments: 'Esa mesa tiene cobros: se cierra desde su cuenta.',
  pos_session_needs_bill: 'Esa mesa se cobra desde su cuenta, en el punto de venta.',
  pos_session_has_consumption: 'Esa mesa tiene consumo sin cobrar: se cierra desde su cuenta.',
  range_invalid: 'Ese rango de fechas no se puede pedir.',
}

export type PosError = { code: string; message: string; detail: string | null }

/** `detail` trae, cuando hay, el nombre del producto que falló (lo arma la base). */
export function toPosError(error: { message?: string; details?: string | null } | null): PosError {
  const raw = error?.message ?? ''
  const code = Object.keys(MESSAGES).find((key) => raw.includes(key)) ?? 'unknown'
  const detail = error?.details?.trim() || null
  const base = MESSAGES[code] ?? 'No se pudo completar. Probá de nuevo.'
  const message =
    detail &&
    (code === 'item_sold_out' || code === 'item_not_available' || code === 'option_not_available')
      ? code === 'item_sold_out'
        ? `${detail} se agotó.`
        : `${detail}: ${base.charAt(0).toLowerCase()}${base.slice(1)}`
      : base
  return { code, message, detail }
}
