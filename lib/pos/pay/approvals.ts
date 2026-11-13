/**
 * Pedidos de descuento y de baja — PURO.
 *
 * Lo que la bandeja y la cuenta necesitan decir de un pedido: qué es, cuánta plata mueve, hace
 * cuánto espera y qué le contestaron. Nada de acá decide quién puede aprobar: eso lo dice la base.
 */
import { formatCentsShort } from '@/lib/money'
import type {
  ApprovalKind,
  ApprovalStatus,
  BillDiscount,
  DiscountPayload,
  InboxApproval,
  VoidItemPayload,
} from '@/lib/pos/cash/types'
import { minutesSince } from '@/lib/pos/order/clock'
import { formatMinutes } from '@/lib/pos/table-state'
import { bpLabel } from './charge'

type Payload = DiscountPayload | VoidItemPayload

export function isVoidPayload(payload: Payload | undefined | null): payload is VoidItemPayload {
  return Boolean(payload && 'item_id' in payload)
}

export function isDiscountPayload(payload: Payload | undefined | null): payload is DiscountPayload {
  return Boolean(payload && 'kind' in payload && 'value' in payload)
}

/** «Descuento 10 %» / «Descuento $ 5.000» / «Baja: 3 × Clásicas». */
export function approvalTitle(approval: {
  kind: ApprovalKind
  payload?: Payload
  summary: string
}): string {
  const { payload } = approval
  if (approval.kind === 'void_item' && isVoidPayload(payload)) {
    return `Baja: ${payload.quantity} × ${payload.name}`
  }
  if (approval.kind === 'discount' && isDiscountPayload(payload)) {
    return `Descuento ${payload.kind === 'percent' ? bpLabel(payload.value) : formatCentsShort(payload.value)}`
  }
  // Sin el detalle (lo ya contestado): lo que armó la base, hasta el motivo.
  return approval.summary.split(' · ')[0] ?? approval.summary
}

/** El motivo que escribió quien pidió. */
export function approvalReason(approval: { payload?: Payload; summary: string }): string | null {
  const reason = approval.payload?.reason?.trim()
  if (reason) return reason
  const [, ...rest] = approval.summary.split(' · ')
  return rest.join(' · ').trim() || null
}

/** Lo que baja de la cuenta si se aprueba, cuando se sabe (una baja, o un descuento en pesos). */
export function approvalCents(approval: { kind: ApprovalKind; payload?: Payload }): number | null {
  const { payload } = approval
  if (approval.kind === 'void_item' && isVoidPayload(payload)) return payload.amount_cents
  if (approval.kind === 'discount' && isDiscountPayload(payload) && payload.kind === 'amount') {
    return payload.value
  }
  return null
}

/** «recién», «hace 3 min», «hace 1 h 05». */
export function agoLabel(iso: string | null | undefined, nowMs: number): string {
  const minutes = minutesSince(iso, nowMs)
  if (minutes === null) return ''
  return minutes < 1 ? 'recién' : `hace ${formatMinutes(minutes)}`
}

export const DECISION_WORD: Readonly<Record<Exclude<ApprovalStatus, 'pending'>, string>> = {
  approved: 'Aprobado',
  rejected: 'Rechazado',
  cancelled: 'Retirado',
}

/** «Mesa 12» o a nombre de quién está, para ubicar el pedido. */
export function approvalWhere(approval: Pick<InboxApproval, 'table_label' | 'alias'>): string {
  if (approval.table_label) return `Mesa ${approval.table_label}`
  return approval.alias || 'Sin mesa'
}

/**
 * Lo que le contestaron a quien pidió y todavía no vio: lo suyo, decidido después de la última vez
 * que abrió la bandeja. Lo que retiró él mismo no cuenta.
 */
export function unseenAnswers(
  recent: ReadonlyArray<InboxApproval>,
  seenUntil: string | null,
): InboxApproval[] {
  return recent.filter(
    (approval) =>
      approval.mine &&
      approval.status !== 'cancelled' &&
      Boolean(approval.decided_at) &&
      (seenUntil === null || (approval.decided_at ?? '') > seenUntil),
  )
}

/** Lo último que se decidió, para anotar hasta dónde se vio. */
export function latestDecision(recent: ReadonlyArray<InboxApproval>): string | null {
  let latest: string | null = null
  for (const approval of recent) {
    if (approval.decided_at && (latest === null || approval.decided_at > latest)) {
      latest = approval.decided_at
    }
  }
  return latest
}

/**
 * El descuento que nació de aprobar un pedido, para poder deshacerlo: mismo tipo, valor y motivo,
 * pedido por la misma persona y ya aprobado. Si hay más de uno igual, el más nuevo.
 */
export function discountFromApproval(
  discounts: ReadonlyArray<BillDiscount>,
  approval: { payload?: Payload | null; requested_by_name: string },
): BillDiscount | null {
  const { payload } = approval
  if (!isDiscountPayload(payload)) return null
  const matches = discounts.filter(
    (discount) =>
      discount.approved_by_name !== null &&
      discount.kind === payload.kind &&
      discount.value === payload.value &&
      discount.reason === payload.reason &&
      discount.by_name === approval.requested_by_name,
  )
  return matches.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null
}
