/**
 * Formas de lo que devuelven las RPC de cobro y caja (migración `pos_cobro_y_caja`).
 * Son el contrato entre la base y las pantallas: si cambia una RPC, cambia acá.
 *
 * Toda la plata viaja en CENTAVOS enteros; la pantalla muestra pesos (`formatCentsShort`).
 */

export type PayMethod = 'cash' | 'transfer' | 'qr' | 'debit' | 'credit' | 'other'

/** En el orden en que se muestran siempre: en la cuenta, en la caja y en el resumen. */
export const PAY_METHODS: ReadonlyArray<PayMethod> = [
  'cash',
  'transfer',
  'qr',
  'debit',
  'credit',
  'other',
]

export const METHOD_LABEL: Readonly<Record<PayMethod, string>> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  qr: 'QR',
  debit: 'Débito',
  credit: 'Crédito',
  other: 'Otro',
}

export function isPayMethod(value: unknown): value is PayMethod {
  return typeof value === 'string' && (PAY_METHODS as ReadonlyArray<string>).includes(value)
}

/** Qué medios se facturan si nadie dice otra cosa (`pos_settings.invoice_by_method`). */
export type InvoiceByMethod = Partial<Record<PayMethod, boolean>>

/** Los números de la cuenta de una mesa (`private.pos_bill`). */
export type BillNumbers = {
  /** Consumo: renglones vivos de tandas vivas. */
  subtotal_cents: number
  discount_cents: number
  /** Lo que se usa de la seña de la reserva (nunca más que la cuenta). */
  deposit_cents: number
  /** Consumo − descuentos − seña. */
  due_cents: number
  /** Suma de lo que bajaron de la cuenta los cobros vigentes (sin recargo ni propina). */
  paid_cents: number
  /** Lo que falta. Nunca negativo. */
  remaining_cents: number
  /** Si quedó cobrado de más (una baja o un descuento después de cobrar). */
  overpaid_cents: number
  surcharge_cents: number
  tip_cents: number
}

export type PaymentEdit = {
  field: 'method' | 'invoice' | 'surcharge_cents'
  old_value: string
  new_value: string
  note: string | null
  by_name: string
  at: string
  /** Se corrigió con el turno ya cerrado (solo un dueño). */
  after_close: boolean
}

export type Payment = {
  id: string
  session_id: string
  shift_id: string | null
  created_at: string
  method: PayMethod
  /** Lo que este cobro baja de la cuenta. */
  amount_cents: number
  surcharge_cents: number
  tip_cents: number
  /** Efectivo: con cuánto pagó. `null` = pagó justo. */
  tendered_cents: number | null
  change_cents: number
  /** Lo que se le cobró de verdad: monto + recargo + propina. */
  total_cents: number
  invoice: boolean
  payer_label: string | null
  /** División por producto: renglones cubiertos; repetido = varias unidades. */
  item_ids: string[]
  reference: string | null
  status: 'ok' | 'voided'
  voided_at: string | null
  voided_by_name: string | null
  void_reason: string | null
  is_practice: boolean
  created_by_name: string
  edits: PaymentEdit[]
}

export type BillLine = {
  id: string
  ticket_id: string
  course: number
  menu_item_id: string
  name: string
  quantity: number
  unit_price_cents: number
  line_total_cents: number
  modifiers: { id: string; label: string; group: string; delta_cents: number }[]
  notes: string | null
  /** Unidades de este renglón que ya cubrió algún cobro por producto. */
  paid_units: number
}

export type BillVoid = {
  id: string
  name: string
  quantity: number
  amount_cents: number
  reason: string | null
  at: string
  by_name: string
}

export type DiscountKind = 'percent' | 'amount'

export type BillDiscount = {
  id: string
  kind: DiscountKind
  /** Porcentaje: puntos básicos (1000 = 10 %). Monto: centavos. */
  value: number
  reason: string
  /** Cuánto baja hoy de la cuenta (el porcentaje sigue al consumo). */
  amount_cents: number
  by_name: string
  approved_by_name: string | null
  at: string
  mine: boolean
}

export type ApprovalKind = 'discount' | 'void_item'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export type DiscountPayload = { kind: DiscountKind; value: number; reason: string }
export type VoidItemPayload = {
  item_id: string
  reason: string
  name: string
  quantity: number
  amount_cents: number
}

export type PendingApproval = {
  id: string
  kind: ApprovalKind
  summary: string
  payload: DiscountPayload | VoidItemPayload
  requested_by_name: string
  requested_at: string
  mine: boolean
}

/** Un turno donde puede entrar un cobro. Si hay más de uno, la pantalla pregunta en qué caja. */
export type OpenShiftRef = {
  id: string
  register_id: string
  register: string
  label: string | null
  opened_at: string
  opened_by_name: string
}

/** Lo que devuelve `pos_bill`: todo lo que necesita la pantalla de cobro. */
export type Bill = {
  now: string
  session: {
    id: string
    status: 'open' | 'paid' | 'merged' | 'abandoned'
    branch_id: string
    table_id: string | null
    table_label: string | null
    alias: string | null
    party_size: number | null
    kind: 'table' | 'quick' | 'delivery'
    is_practice: boolean
    opened_at: string
    bill_requested_at: string | null
    paid_at: string | null
  }
  bill: BillNumbers
  lines: BillLine[]
  voids: BillVoid[]
  discounts: BillDiscount[]
  payments: Payment[]
  reservation: {
    id: string
    name: string
    status: string
    /** La seña entera de la reserva (lo que se usa está en `bill.deposit_cents`). */
    deposit_cents: number
    guests: number
  } | null
  customer: {
    id: string
    first_name: string
    last_name: string
    points_balance: number
    tier: string | null
    tier_color: string | null
  } | null
  closed: {
    at: string
    by_name: string
    points_awarded: number
    points_failed: boolean
  } | null
  pending_approvals: PendingApproval[]
  shifts: OpenShiftRef[]
  settings: {
    /** Recargo de crédito en puntos básicos (1000 = 10 %). */
    credit_surcharge_bp: number
    invoice_by_method: InvoiceByMethod
    tip_presets_pct: number[]
    /** Billetes en uso, en pesos, de mayor a menor. */
    bill_denominations: number[]
    transfer_alias: string | null
    transfer_holder: string | null
  }
  can: {
    role: string
    /** Puede dar el OK a pedidos de otros (y entonces aplica directo los suyos). */
    approve: boolean
    discount_direct: boolean
    void_direct: boolean
    void_payment: boolean
    /** Cerrar una mesa a la que no se le cobró nada (la seña o un descuento cubrían todo). */
    close_without_payment: boolean
  }
}

/** Los puntos que sumó el socio de la mesa al cerrarla. */
export type PointsAwarded = {
  customer_id: string
  first_name: string
  awarded: number
  balance: number
  /** El motor de puntos falló: la mesa se cobró igual y hay que avisarle al dueño. */
  failed: boolean
}

/** Cómo quedó la mesa después de un cobro, un descuento o un cierre. */
export type SessionResult = {
  bill: BillNumbers
  closed: boolean
  points: PointsAwarded | null
}

export type PayResult = SessionResult & { payment: Payment; duplicate: boolean }
export type CloseTableResult = SessionResult & { duplicate: boolean }
export type VoidPaymentResult = SessionResult & { payment: Payment; duplicate: boolean }
export type EditPaymentResult = { payment: Payment; changed: boolean }
export type DiscountResult = SessionResult & {
  /** `false` = quedó como pedido, esperando el OK. */
  applied: boolean
  discount_id: string | null
  approval_id: string | null
  /** Era un reintento: el descuento (o el pedido) ya estaba y no se repitió. */
  duplicate: boolean
}
export type RemoveDiscountResult = SessionResult & { removed: boolean; duplicate: boolean }
export type RequestVoidResult = { applied: boolean; approval_id: string | null; duplicate: boolean }
export type DecideApprovalResult = {
  approval_id: string
  status: ApprovalStatus
  kind: ApprovalKind
  duplicate: boolean
}

export type InboxApproval = {
  id: string
  kind: ApprovalKind
  status: ApprovalStatus
  summary: string
  payload?: DiscountPayload | VoidItemPayload
  session_id: string
  table_label: string | null
  alias: string | null
  requested_by_name: string
  requested_at: string
  decided_by_name?: string | null
  decided_at?: string | null
  decision_note?: string | null
  mine: boolean
}

export type ApprovalsInbox = {
  now: string
  can_decide: boolean
  pending: InboxApproval[]
  /** Lo decidido en las últimas 12 horas (para que quien pidió vea qué le contestaron). */
  recent: InboxApproval[]
}

// ─── Caja ────────────────────────────────────────────────────────────────────

export type MethodTotal = {
  method: PayMethod
  count: number
  amount_cents: number
  surcharge_cents: number
  tip_cents: number
  /** Lo que entró por ese medio: monto + recargo + propina. */
  total_cents: number
}

export type CashMovement = {
  id: string
  kind: 'in' | 'out'
  amount_cents: number
  reason: string
  photo_path: string | null
  by_name: string
  at: string
  voided_at: string | null
  voided_by_name: string | null
  void_reason: string | null
}

export type SummaryDiscount = {
  session_id: string
  table_label: string | null
  kind: DiscountKind
  value: number
  amount_cents: number
  reason: string
  by_name: string
  approved_by_name: string | null
  at: string
}

/** Una seña que se descontó de una cuenta: plata que no pasó por la caja esa noche. */
export type SummaryDeposit = {
  session_id: string
  table_label: string | null
  /** A nombre de quién estaba la reserva. */
  name: string | null
  amount_cents: number
  by_name: string
  at: string
}

export type SummaryItemVoid = {
  session_id: string
  table_label: string | null
  name: string
  quantity: number
  amount_cents: number
  reason: string | null
  /** Cocina ya lo había empezado: es mercadería que se perdió. */
  started: boolean
  by_name: string
  at: string
}

export type SummaryPaymentVoid = {
  payment_id: string
  session_id: string
  table_label: string | null
  method: PayMethod
  amount_cents: number
  reason: string | null
  by_name: string | null
  at: string
}

export type SummaryCorrection = {
  payment_id: string
  session_id: string
  table_label: string | null
  amount_cents: number
  field: PaymentEdit['field']
  old_value: string
  new_value: string
  note: string | null
  by_name: string
  at: string
  after_close: boolean
}

/** Los números de un turno (`private.pos_shift_summary`): en vivo, o la foto que quedó al cerrar. */
export type ShiftSummary = {
  by_method: MethodTotal[]
  payments_count: number
  /** Lo que bajó de las cuentas (sin recargos ni propinas). */
  sales_cents: number
  surcharge_cents: number
  tip_cents: number
  collected_cents: number
  invoiced_cents: number
  not_invoiced_cents: number
  opening_float_cents: number
  opening_expected_cents: number | null
  cash_sales_cents: number
  cash_tips_cents: number
  cash_in_cents: number
  cash_out_cents: number
  /** Cambio inicial + cobros en efectivo + ingresos − retiros. La propina no entra. */
  expected_cash_cents: number
  tables: number
  people: number
  /** Consumo − descuentos de las mesas que se cerraron en el turno. */
  consumption_cents: number
  per_person_cents: number | null
  discount_cents: number
  deposit_cents: number
  discounts: SummaryDiscount[]
  deposits: SummaryDeposit[]
  item_voids: SummaryItemVoid[]
  payment_voids: SummaryPaymentVoid[]
  corrections: SummaryCorrection[]
  movements: CashMovement[]
  open_tables: { count: number; pending_cents: number }
  // Solo en la foto del cierre:
  counted_cash_cents?: number
  difference_cents?: number
  leave_float_cents?: number
  withdrawn_cents?: number
  closed_at?: string
}

/** El conteo billete por billete. `value` en pesos; `other_cents` = monedas y lo que no está en la lista. */
export type CountBreakdown = {
  bills: { value: number; count: number }[]
  other_cents?: number
}

export type Shift = {
  id: string
  register_id: string
  register: string
  label: string | null
  status: 'open' | 'closed'
  service_day: string
  is_practice: boolean
  opened_at: string
  opened_by_name: string
  opening_float_cents: number
  opening_expected_cents: number | null
  opening_note: string | null
  closed_at: string | null
  closed_by_name: string | null
  counted_cash_cents: number | null
  count_breakdown: CountBreakdown | null
  /** Lo que tenía que haber AL CERRAR. Si después se corrigió algo, `live` dice otra cosa. */
  expected_cash_cents: number | null
  difference_cents: number | null
  leave_float_cents: number | null
  closing_note: string | null
  summary: ShiftSummary | null
}

export type RegisterRef = {
  id: string
  name: string
  position: number
  open_shift_id: string | null
  /** Lo que dejó el último turno de esta caja: con eso se abre el que sigue. */
  last_closed: {
    shift_id: string
    label: string | null
    closed_at: string
    closed_by_name: string | null
    leave_float_cents: number
  } | null
}

/** Un cobro en la lista del día, con su mesa. */
export type DayPayment = Payment & {
  table_label: string | null
  alias: string | null
  table_closed: boolean
}

/** Lo que devuelve `pos_shift_snapshot`: la pantalla de caja entera. */
export type ShiftSnapshot = {
  now: string
  service_day: string
  practice: boolean
  role: string
  branch: { id: string; name: string; slug: string }
  settings: {
    bill_denominations: number[]
    credit_surcharge_bp: number
    invoice_by_method: InvoiceByMethod
    tip_presets_pct: number[]
  }
  registers: RegisterRef[]
  /** El turno abierto, o el último que se cerró. `null` si la sucursal nunca abrió la caja. */
  shift: Shift | null
  /** Los números del turno recalculados ahora. */
  live: ShiftSummary | null
  payments: DayPayment[]
  pending_approvals: (Omit<InboxApproval, 'status' | 'mine'> & {
    payload: DiscountPayload | VoidItemPayload
  })[]
}

export type OpenShiftResult = {
  shift_id: string
  register_id: string
  already_open: boolean
  opening_float_cents: number
  opening_expected_cents: number | null
}

export type CashMovementResult = { movement_id: string; duplicate: boolean }

export type CloseShiftResult = {
  shift_id: string
  already_closed: boolean
  expected_cash_cents: number
  counted_cash_cents: number
  difference_cents: number
  leave_float_cents: number
  withdrawn_cents: number
  summary: ShiftSummary
}

/** Un turno en el historial (lectura directa de `pos_shifts`, la ven dueño y caja). */
export type ShiftRow = {
  id: string
  register_id: string
  service_day: string
  label: string | null
  status: 'open' | 'closed'
  is_practice: boolean
  opened_at: string
  opened_by_name: string
  opening_float_cents: number
  closed_at: string | null
  closed_by_name: string | null
  counted_cash_cents: number | null
  expected_cash_cents: number | null
  difference_cents: number | null
  leave_float_cents: number | null
}
