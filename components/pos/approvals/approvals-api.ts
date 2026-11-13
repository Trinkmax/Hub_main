import type { ActionResult } from '@/lib/pos/actions'
import {
  decideApproval,
  refreshApprovals,
  refreshBill,
  removeDiscount,
} from '@/lib/pos/cash/actions'
import type { ApprovalsInbox, DecideApprovalResult, InboxApproval } from '@/lib/pos/cash/types'
import { discountFromApproval } from '@/lib/pos/pay/approvals'

/**
 * Lo que la bandeja de pedidos necesita del servidor. La bandeja no sabe de dónde sale: recibe
 * estas funciones y dibuja. `liveApprovalsApi` las conecta con las acciones de verdad.
 */
export type ApprovalsApi = {
  load: () => Promise<ActionResult<ApprovalsInbox>>
  decide: (input: {
    approvalId: string
    approve: boolean
    note?: string | null
  }) => Promise<ActionResult<DecideApprovalResult>>
  /** Deshacer un descuento recién aprobado: se busca en la cuenta de esa mesa y se quita. */
  undoDiscount: (approval: InboxApproval) => Promise<ActionResult>
}

export function liveApprovalsApi(slug: string, branchId: string): ApprovalsApi {
  return {
    load: () => refreshApprovals(slug, branchId),
    decide: (input) => decideApproval(slug, input),
    undoDiscount: async (approval) => {
      const bill = await refreshBill(slug, approval.session_id)
      if (!bill.ok) return bill
      const discount = discountFromApproval(bill.data.discounts, approval)
      if (!discount) {
        return {
          ok: false,
          message: 'Ese descuento ya no está en la mesa.',
          code: 'discount_not_found',
        }
      }
      const removed = await removeDiscount(slug, discount.id)
      return removed.ok ? { ok: true } : removed
    },
  }
}
