'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { isFeatureEnabled } from '@/lib/platform/features'
import type { ActionResult } from '@/lib/pos/actions'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  type TenantRole,
  UnauthenticatedError,
} from '@/lib/tenant'
import { percentToBp } from './bill'
import { toCashError } from './errors'
import { getApprovalsInbox, getBill, getShiftSnapshot } from './queries'
import { POS_CASH_ROLES, POS_CHARGE_ROLES } from './roles'
import { countTotal } from './shift'
import type {
  ApprovalsInbox,
  Bill,
  CashMovementResult,
  CloseShiftResult,
  CloseTableResult,
  DecideApprovalResult,
  DiscountResult,
  EditPaymentResult,
  OpenShiftResult,
  PayResult,
  RemoveDiscountResult,
  RequestVoidResult,
  ShiftSnapshot,
  VoidPaymentResult,
} from './types'

/**
 * Acciones de cobro y caja. Mismo orden que el resto del punto de venta:
 *   1. quién sos y si tu rol puede (y si el bar tiene el punto de venta prendido);
 *   2. validar lo que llega (la plata siempre en centavos enteros);
 *   3. una RPC `pos_*`, que vuelve a chequear el rol contra el bar DE LA FILA,
 *      decide lo que no se le puede creer al celular (recargo, lo que falta, si
 *      hace falta aprobación) y avisa en vivo a las demás pantallas;
 *   4. dejar rastro en la auditoría de todo lo que mueve plata;
 *   5. un mensaje que se pueda resolver si algo falla.
 * No revalidan rutas: cada pantalla vuelve a leer cuando le llega el aviso en vivo.
 */

type Denied = { ok: false; message: string; code: string }
type Access = { tenantId: string; role: TenantRole; userId: string; supabase: SupabaseClient }

async function authorize(slug: string, roles: ReadonlyArray<TenantRole>): Promise<Access | Denied> {
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, roles)
    if (!isFeatureEnabled(access.tenant, 'pos') && !access.isPlatformAdmin) {
      return {
        ok: false,
        message: 'El punto de venta no está prendido en este bar.',
        code: 'disabled',
      }
    }
    return {
      tenantId: access.tenant.id,
      role: access.role,
      userId: access.user.id,
      supabase: (await createClient()) as unknown as SupabaseClient,
    }
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, message: 'Se cerró tu sesión. Volvé a entrar.', code: 'unauthenticated' }
    }
    if (error instanceof RoleRequiredError || error instanceof TenantNotFoundError) {
      return { ok: false, message: 'No tenés permiso para hacer esto.', code: 'forbidden' }
    }
    throw error
  }
}

function isDenied(access: Access | Denied): access is Denied {
  return 'ok' in access
}

async function call<T>(
  access: Access,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: T } | Denied> {
  const { data, error } = await access.supabase.rpc(fn, args)
  if (error) {
    const parsed = toCashError(error)
    if (parsed.code === 'unknown') console.error(`[pos.${fn}]`, error.code, error.message)
    return { ok: false, message: parsed.message, code: parsed.code }
  }
  return { ok: true, data: data as T }
}

const invalid: Denied = { ok: false, message: 'Faltan datos o hay alguno mal.', code: 'invalid' }

const MAX_CENTS = 100_000_000_000
const id = z.uuid()
const cents = z.number().int().min(0).max(MAX_CENTS)
const positiveCents = z.number().int().min(1).max(MAX_CENTS)
const method = z.enum(['cash', 'transfer', 'qr', 'debit', 'credit', 'other'])
const reason = z.string().trim().min(1).max(200)
/** La arma el celular una vez por toque: reintentar sin señal nunca cobra dos veces. */
const idempotencyKey = z.string().trim().min(8).max(80)

// ─── Lecturas que las pantallas vuelven a pedir en vivo ─────────────────────

export async function refreshBill(slug: string, sessionId: string): Promise<ActionResult<Bill>> {
  const access = await authorize(slug, POS_CHARGE_ROLES)
  if (isDenied(access)) return access
  if (!id.safeParse(sessionId).success) return invalid
  const result = await getBill(sessionId)
  if (!result.ok) return { ok: false, message: result.error.message, code: result.error.code }
  return { ok: true, data: result.data }
}

const shiftViewSchema = z.object({
  branchId: id,
  /** Un turno puntual (historial). Sin dato: el abierto, o el último que se cerró. */
  shiftId: id.nullish(),
  /** El carril de práctica. */
  practice: z.boolean().optional(),
})

export async function refreshShift(
  slug: string,
  branchId: string,
  options: { shiftId?: string | null; practice?: boolean } = {},
): Promise<ActionResult<ShiftSnapshot>> {
  const access = await authorize(slug, POS_CASH_ROLES)
  if (isDenied(access)) return access
  const parsed = shiftViewSchema.safeParse({ branchId, ...(options ?? {}) })
  if (!parsed.success) return invalid
  const result = await getShiftSnapshot(parsed.data.branchId, {
    shiftId: parsed.data.shiftId ?? null,
    practice: parsed.data.practice === true,
  })
  if (!result.ok) return { ok: false, message: result.error.message, code: result.error.code }
  return { ok: true, data: result.data }
}

export async function refreshApprovals(
  slug: string,
  branchId: string,
): Promise<ActionResult<ApprovalsInbox>> {
  const access = await authorize(slug, POS_CHARGE_ROLES)
  if (isDenied(access)) return access
  if (!id.safeParse(branchId).success) return invalid
  const result = await getApprovalsInbox(branchId)
  if (!result.ok) return { ok: false, message: result.error.message, code: result.error.code }
  return { ok: true, data: result.data }
}

// ─── Cobrar ─────────────────────────────────────────────────────────────────

const paySchema = z.object({
  sessionId: id,
  method,
  /** Lo que este cobro baja de la cuenta. El recargo de crédito lo suma la base. */
  amountCents: positiveCents,
  idempotencyKey,
  /** Efectivo: con cuánto paga. Sin dato = paga justo. */
  tenderedCents: positiveCents.nullish(),
  tipCents: cents.default(0),
  /** Sin dato = lo que el bar tiene puesto para ese medio. */
  invoice: z.boolean().nullish(),
  /** «Juan», «Parte 2 de 4». */
  payerLabel: z.string().trim().max(60).nullish(),
  /** División por producto: el renglón repetido una vez por unidad (`picksToItemIds`). */
  itemIds: z.array(id).max(400).optional(),
  reference: z.string().trim().max(80).nullish(),
  /** Solo si hay más de una caja abierta en la sucursal. */
  shiftId: id.nullish(),
})
export type PayInput = z.input<typeof paySchema>

export async function pay(slug: string, input: PayInput): Promise<ActionResult<PayResult>> {
  const access = await authorize(slug, POS_CHARGE_ROLES)
  if (isDenied(access)) return access
  const parsed = paySchema.safeParse(input)
  if (!parsed.success) return invalid
  const data = parsed.data

  const result = await call<PayResult>(access, 'pos_pay', {
    p_session_id: data.sessionId,
    p_method: data.method,
    p_amount_cents: data.amountCents,
    p_idempotency_key: data.idempotencyKey,
    p_tendered_cents: data.method === 'cash' ? (data.tenderedCents ?? null) : null,
    p_tip_cents: data.tipCents,
    p_invoice: data.invoice ?? null,
    p_payer_label: data.payerLabel || null,
    p_item_ids: data.itemIds?.length ? data.itemIds : null,
    p_reference: data.reference || null,
    p_shift_id: data.shiftId ?? null,
  })
  if (!result.ok) return result

  const { payment, closed, points, duplicate } = result.data
  if (!duplicate) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'pos.payment_taken',
      entity: 'pos_payment',
      entityId: payment.id,
      payload: {
        session_id: payment.session_id,
        shift_id: payment.shift_id,
        method: payment.method,
        amount_cents: payment.amount_cents,
        surcharge_cents: payment.surcharge_cents,
        tip_cents: payment.tip_cents,
        invoice: payment.invoice,
        practice: payment.is_practice,
      },
    })
    if (closed) {
      await logAudit({
        tenantId: access.tenantId,
        userId: access.userId,
        action: 'pos.table_paid',
        entity: 'table_session',
        entityId: payment.session_id,
        payload: {
          due_cents: result.data.bill.due_cents,
          discount_cents: result.data.bill.discount_cents,
          deposit_cents: result.data.bill.deposit_cents,
          points_awarded: points?.awarded ?? 0,
          points_failed: points?.failed ?? false,
          practice: payment.is_practice,
        },
      })
    }
  }
  return { ok: true, data: result.data }
}

/**
 * Cerrar una mesa a la que no le queda nada por cobrar (la seña o un descuento
 * cubrían todo). Si nunca se le cobró nada, la cierra quien puede aprobar: la
 * cuenta lo avisa en `can.close_without_payment`.
 */
export async function closeTable(
  slug: string,
  sessionId: string,
): Promise<ActionResult<CloseTableResult>> {
  const access = await authorize(slug, POS_CHARGE_ROLES)
  if (isDenied(access)) return access
  if (!id.safeParse(sessionId).success) return invalid
  const result = await call<CloseTableResult>(access, 'pos_close_table', {
    p_session_id: sessionId,
  })
  if (!result.ok) return result
  if (!result.data.duplicate) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'pos.table_paid',
      entity: 'table_session',
      entityId: sessionId,
      payload: {
        due_cents: result.data.bill.due_cents,
        discount_cents: result.data.bill.discount_cents,
        deposit_cents: result.data.bill.deposit_cents,
        points_awarded: result.data.points?.awarded ?? 0,
        points_failed: result.data.points?.failed ?? false,
        without_payment: true,
      },
    })
  }
  return { ok: true, data: result.data }
}

/** Anular un cobro mientras la mesa sigue abierta. Siempre con motivo. */
export async function voidPayment(
  slug: string,
  paymentId: string,
  why: string,
): Promise<ActionResult<VoidPaymentResult>> {
  const access = await authorize(slug, POS_CASH_ROLES)
  if (isDenied(access)) return access
  const parsed = z.object({ paymentId: id, why: reason }).safeParse({ paymentId, why })
  if (!parsed.success) {
    return id.safeParse(paymentId).success
      ? { ok: false, message: 'Contame por qué se anula.', code: 'reason_required' }
      : invalid
  }
  const result = await call<VoidPaymentResult>(access, 'pos_void_payment', {
    p_payment_id: parsed.data.paymentId,
    p_reason: parsed.data.why,
  })
  if (!result.ok) return result
  if (!result.data.duplicate) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'pos.payment_voided',
      entity: 'pos_payment',
      entityId: parsed.data.paymentId,
      payload: {
        session_id: result.data.payment.session_id,
        method: result.data.payment.method,
        amount_cents: result.data.payment.amount_cents,
        reason: parsed.data.why,
      },
    })
  }
  return { ok: true, data: result.data }
}

const editPaymentSchema = z
  .object({
    paymentId: id,
    /** El medio correcto. */
    method: method.optional(),
    invoice: z.boolean().optional(),
    note: z.string().trim().max(200).nullish(),
    /**
     * Solo cuando el cobro queda en crédito: `true` = el recargo se cobró,
     * `false` = no se cobró. Sin dato, la base lo calcula si el cobro PASA a
     * crédito y no lo toca si ya lo era.
     */
    surcharge: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.method !== undefined || value.invoice !== undefined || value.surcharge !== undefined,
  )
export type EditPaymentInput = z.input<typeof editPaymentSchema>

/**
 * Corregir un cobro: el medio y/o si se factura. No cambia el monto ni borra
 * nada; cada cambio queda escrito con quién y cuándo. Con el turno cerrado solo
 * lo hace un dueño (lo decide la base).
 */
export async function editPayment(
  slug: string,
  input: EditPaymentInput,
): Promise<ActionResult<EditPaymentResult>> {
  const access = await authorize(slug, POS_CASH_ROLES)
  if (isDenied(access)) return access
  const parsed = editPaymentSchema.safeParse(input)
  if (!parsed.success) return invalid
  const result = await call<EditPaymentResult>(access, 'pos_edit_payment', {
    p_payment_id: parsed.data.paymentId,
    p_method: parsed.data.method ?? null,
    p_invoice: parsed.data.invoice ?? null,
    p_note: parsed.data.note || null,
    p_surcharge: parsed.data.surcharge ?? null,
  })
  if (!result.ok) return result
  if (result.data.changed) {
    const { payment } = result.data
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'pos.payment_corrected',
      entity: 'pos_payment',
      entityId: payment.id,
      payload: {
        session_id: payment.session_id,
        amount_cents: payment.amount_cents,
        method: payment.method,
        invoice: payment.invoice,
        surcharge_cents: payment.surcharge_cents,
        requested: {
          method: parsed.data.method ?? null,
          invoice: parsed.data.invoice ?? null,
          surcharge: parsed.data.surcharge ?? null,
        },
      },
    })
  }
  return { ok: true, data: result.data }
}

// ─── Descuentos, bajas y pedidos ────────────────────────────────────────────

const discountSchema = z.discriminatedUnion('kind', [
  z.object({
    sessionId: id,
    kind: z.literal('percent'),
    /** En por ciento, como se escribe: 10, 12.5. */
    percent: z.number().gt(0).max(100),
    reason,
  }),
  z.object({ sessionId: id, kind: z.literal('amount'), amountCents: positiveCents, reason }),
])
export type AddDiscountInput = z.input<typeof discountSchema>

/**
 * Un descuento a la mesa. Quien puede dar el OK lo aplica directo; el resto
 * deja un pedido (`applied: false`) que alguien aprueba desde su celular.
 */
export async function addDiscount(
  slug: string,
  input: AddDiscountInput,
): Promise<ActionResult<DiscountResult>> {
  const access = await authorize(slug, POS_CHARGE_ROLES)
  if (isDenied(access)) return access
  const parsed = discountSchema.safeParse(input)
  if (!parsed.success) return invalid
  const data = parsed.data
  const value = data.kind === 'percent' ? percentToBp(data.percent) : data.amountCents
  if (value < 1) return invalid

  const result = await call<DiscountResult>(access, 'pos_add_discount', {
    p_session_id: data.sessionId,
    p_kind: data.kind,
    p_value: value,
    p_reason: data.reason,
  })
  if (!result.ok) return result
  if (!result.data.duplicate) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: result.data.applied ? 'pos.discount_applied' : 'pos.discount_requested',
      entity: result.data.applied ? 'pos_discount' : 'pos_approval',
      entityId: result.data.discount_id ?? result.data.approval_id,
      payload: { session_id: data.sessionId, kind: data.kind, value, reason: data.reason },
    })
  }
  return { ok: true, data: result.data }
}

export async function removeDiscount(
  slug: string,
  discountId: string,
): Promise<ActionResult<RemoveDiscountResult>> {
  const access = await authorize(slug, POS_CHARGE_ROLES)
  if (isDenied(access)) return access
  if (!id.safeParse(discountId).success) return invalid
  const result = await call<RemoveDiscountResult>(access, 'pos_remove_discount', {
    p_discount_id: discountId,
  })
  if (!result.ok) return result
  if (!result.data.duplicate) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'pos.discount_removed',
      entity: 'pos_discount',
      entityId: discountId,
    })
  }
  return { ok: true, data: result.data }
}

/**
 * Dar de baja un renglón pidiendo permiso si hace falta: si quien llama puede
 * (o cocina todavía no lo empezó) se da de baja ahí mismo; si no, queda el
 * pedido (`applied: false`). El motivo es obligatorio cuando cocina ya empezó.
 */
export async function requestVoid(
  slug: string,
  itemId: string,
  why: string | null,
): Promise<ActionResult<RequestVoidResult>> {
  const access = await authorize(slug, POS_CHARGE_ROLES)
  if (isDenied(access)) return access
  if (!id.safeParse(itemId).success) return invalid
  const cleaned = (typeof why === 'string' ? why : '').trim().slice(0, 200)
  const result = await call<RequestVoidResult>(access, 'pos_request_void', {
    p_item_id: itemId,
    p_reason: cleaned || null,
  })
  if (!result.ok) return result
  if (!result.data.duplicate) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: result.data.applied ? 'pos.item_cancelled' : 'pos.void_requested',
      entity: result.data.applied ? 'ticket_item' : 'pos_approval',
      entityId: result.data.applied ? itemId : result.data.approval_id,
      payload: { item_id: itemId, reason: cleaned || null },
    })
  }
  return { ok: true, data: result.data }
}

const decideSchema = z.object({
  approvalId: id,
  approve: z.boolean(),
  note: z.string().trim().max(200).nullish(),
})

/**
 * El OK (o el no) a un pedido. Aprobar aplica el descuento o la baja en el mismo
 * movimiento. Quien pidió puede retirar lo suyo mandando `approve: false`.
 */
export async function decideApproval(
  slug: string,
  input: z.input<typeof decideSchema>,
): Promise<ActionResult<DecideApprovalResult>> {
  const access = await authorize(slug, POS_CHARGE_ROLES)
  if (isDenied(access)) return access
  const parsed = decideSchema.safeParse(input)
  if (!parsed.success) return invalid
  const result = await call<DecideApprovalResult>(access, 'pos_decide_approval', {
    p_approval_id: parsed.data.approvalId,
    p_approve: parsed.data.approve,
    p_note: parsed.data.note || null,
  })
  if (!result.ok) return result
  if (!result.data.duplicate) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: `pos.approval_${result.data.status}`,
      entity: 'pos_approval',
      entityId: parsed.data.approvalId,
      payload: { kind: result.data.kind, note: parsed.data.note || null },
    })
  }
  return { ok: true, data: result.data }
}

// ─── La caja ────────────────────────────────────────────────────────────────

const openShiftSchema = z.object({
  branchId: id,
  /** Lo que hay en el cajón al abrir (lo que quien abre confirmó o contó). */
  openingFloatCents: cents,
  /** «Mediodía», «Noche». */
  label: z.string().trim().max(30).nullish(),
  note: z.string().trim().max(300).nullish(),
  /** Solo si la sucursal tiene más de una caja. */
  registerId: id.nullish(),
  practice: z.boolean().optional(),
})
export type OpenShiftInput = z.input<typeof openShiftSchema>

export async function openShift(
  slug: string,
  input: OpenShiftInput,
): Promise<ActionResult<OpenShiftResult>> {
  const access = await authorize(slug, POS_CASH_ROLES)
  if (isDenied(access)) return access
  const parsed = openShiftSchema.safeParse(input)
  if (!parsed.success) return invalid
  const data = parsed.data
  const result = await call<OpenShiftResult>(access, 'pos_open_shift', {
    p_branch_id: data.branchId,
    p_opening_float_cents: data.openingFloatCents,
    p_label: data.label || null,
    p_note: data.note || null,
    p_register_id: data.registerId ?? null,
    p_practice: data.practice ?? false,
  })
  if (!result.ok) return result
  if (!result.data.already_open) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'pos.shift_opened',
      entity: 'pos_shift',
      entityId: result.data.shift_id,
      payload: {
        branch_id: data.branchId,
        register_id: result.data.register_id,
        opening_float_cents: result.data.opening_float_cents,
        opening_expected_cents: result.data.opening_expected_cents,
        practice: data.practice ?? false,
      },
    })
  }
  return { ok: true, data: result.data }
}

const cashMovementSchema = z.object({
  shiftId: id,
  kind: z.enum(['in', 'out']),
  amountCents: positiveCents,
  reason,
  /** Ruta de la foto del comprobante dentro del bucket, bajo la carpeta del bar. */
  photoPath: z.string().trim().max(300).nullish(),
  idempotencyKey,
})
export type CashMovementInput = z.input<typeof cashMovementSchema>

/** Plata que entra o sale del cajón sin ser un cobro (sacar para pagar el hielo, sumar cambio). */
export async function cashMovement(
  slug: string,
  input: CashMovementInput,
): Promise<ActionResult<CashMovementResult>> {
  const access = await authorize(slug, POS_CASH_ROLES)
  if (isDenied(access)) return access
  const parsed = cashMovementSchema.safeParse(input)
  if (!parsed.success) return invalid
  const data = parsed.data
  const result = await call<CashMovementResult>(access, 'pos_cash_movement', {
    p_shift_id: data.shiftId,
    p_kind: data.kind,
    p_amount_cents: data.amountCents,
    p_reason: data.reason,
    p_photo_path: data.photoPath || null,
    p_idempotency_key: data.idempotencyKey,
  })
  if (!result.ok) return result
  if (!result.data.duplicate) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: data.kind === 'out' ? 'pos.cash_out' : 'pos.cash_in',
      entity: 'pos_cash_movement',
      entityId: result.data.movement_id,
      payload: {
        shift_id: data.shiftId,
        amount_cents: data.amountCents,
        reason: data.reason,
        has_photo: Boolean(data.photoPath),
      },
    })
  }
  return { ok: true, data: result.data }
}

export async function voidCashMovement(
  slug: string,
  movementId: string,
  why: string,
): Promise<ActionResult<CashMovementResult>> {
  const access = await authorize(slug, POS_CASH_ROLES)
  if (isDenied(access)) return access
  const parsed = z.object({ movementId: id, why: reason }).safeParse({ movementId, why })
  if (!parsed.success) {
    return id.safeParse(movementId).success
      ? { ok: false, message: 'Contame por qué se anula.', code: 'reason_required' }
      : invalid
  }
  const result = await call<CashMovementResult>(access, 'pos_void_cash_movement', {
    p_movement_id: parsed.data.movementId,
    p_reason: parsed.data.why,
  })
  if (!result.ok) return result
  if (!result.data.duplicate) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'pos.cash_movement_voided',
      entity: 'pos_cash_movement',
      entityId: parsed.data.movementId,
      payload: { reason: parsed.data.why },
    })
  }
  return { ok: true, data: result.data }
}

const closeShiftSchema = z.object({
  shiftId: id,
  /** Lo contado, en centavos. Con conteo billete por billete, tiene que ser su suma. */
  countedCents: cents,
  breakdown: z
    .object({
      /** `value` en pesos. */
      bills: z
        .array(
          z.object({
            value: z.number().int().min(1).max(10_000_000),
            count: z.number().int().min(0).max(100_000),
          }),
        )
        .max(40),
      other_cents: cents.optional(),
    })
    .nullish(),
  /** Lo que queda de cambio para el turno que sigue. */
  leaveFloatCents: cents,
  note: z.string().trim().max(300).nullish(),
})
export type CloseShiftInput = z.input<typeof closeShiftSchema>

/**
 * Cerrar el turno: lo contado contra lo que tenía que haber. La pantalla pide el
 * conteo ANTES de mostrar el esperado; acá vuelve la diferencia y el resumen.
 */
export async function closeShift(
  slug: string,
  input: CloseShiftInput,
): Promise<ActionResult<CloseShiftResult>> {
  const access = await authorize(slug, POS_CASH_ROLES)
  if (isDenied(access)) return access
  const parsed = closeShiftSchema.safeParse(input)
  if (!parsed.success) return invalid
  const data = parsed.data
  if (data.breakdown && countTotal(data.breakdown) !== data.countedCents) {
    return {
      ok: false,
      message: 'El conteo no suma el total: revisá los billetes.',
      code: 'count_mismatch',
    }
  }
  if (data.leaveFloatCents > data.countedCents) {
    return {
      ok: false,
      message: 'No podés dejar de cambio más de lo que contaste.',
      code: 'leave_float_invalid',
    }
  }

  const result = await call<CloseShiftResult>(access, 'pos_close_shift', {
    p_shift_id: data.shiftId,
    p_counted_cents: data.countedCents,
    p_breakdown: data.breakdown
      ? { bills: data.breakdown.bills, other_cents: data.breakdown.other_cents ?? 0 }
      : null,
    p_leave_float_cents: data.leaveFloatCents,
    p_note: data.note || null,
  })
  if (!result.ok) return result
  if (!result.data.already_closed) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'pos.shift_closed',
      entity: 'pos_shift',
      entityId: data.shiftId,
      payload: {
        expected_cash_cents: result.data.expected_cash_cents,
        counted_cash_cents: result.data.counted_cash_cents,
        difference_cents: result.data.difference_cents,
        leave_float_cents: result.data.leave_float_cents,
        sales_cents: result.data.summary.sales_cents,
      },
    })
  }
  return { ok: true, data: result.data }
}
