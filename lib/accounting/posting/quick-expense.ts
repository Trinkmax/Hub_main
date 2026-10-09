/**
 * «Nuevo gasto» (H.5, E.5.3 y E.5.4): lo de todos los días, con o sin factura,
 * pagado en el momento.
 *
 * - **Sin comprobante**, o **tique sin comercio identificado** → un `expense`
 *   (D gasto / H caja, E4). El proveedor, si se eligió, queda solo para
 *   estadísticas.
 * - **Con factura** (A, o B/C según la condición del proveedor) o **tique de un
 *   comercio identificado** → `[purchase, payment]` (E5): la compra crea la
 *   partida y el pago la cancela entera en el mismo envío, así la cuenta del
 *   proveedor muestra compra, pago y deuda $ 0. El vencimiento es la fecha
 *   (es de contado). El monto es con IVA incluido: el neto sale del total.
 *
 * Un tique con proveedor pero sin punto de venta y número no puede ir al libro
 * IVA (la fila exige número): se guarda como gasto con ese proveedor.
 *
 * Si se eligió un gasto fijo, su id va en el `expense` o en la compra (nunca en
 * el pago): la base lo marca «Cargado» y avanza su próximo vencimiento.
 *
 * E5 · limpieza con Factura A, $ 12.100 con Mercado Pago: neto 1.000.000, IVA
 * 210.000; pago imputado 1.210.000 contra la partida de la compra.
 */

import type { BuildMeta } from '@/lib/accounting/posting/common'
import { failed, partyInfo, postingError } from '@/lib/accounting/posting/common'
import { buildExpense } from '@/lib/accounting/posting/expense'
import { buildPurchase, type PurchaseBuildInput } from '@/lib/accounting/posting/purchase'
import type { QuickExpenseInput } from '@/lib/accounting/schemas'
import type {
  IvaCondition,
  PostingContext,
  PostingResult,
  VoucherType,
} from '@/lib/accounting/types'

export type QuickExpenseBuildInput = Omit<QuickExpenseInput, 'clientRef' | 'previewHash'>

export type QuickExpensePath =
  | { kind: 'expense'; voucherType: 'sin_comprobante' | 'tique' }
  | { kind: 'purchase'; voucherType: VoucherType }

/** «Factura B o C»: B si quien factura es responsable inscripto; C en cualquier otro caso (monotributo, exento). */
export function invoiceLetterFor(condition: IvaCondition): 'factura_b' | 'factura_c' {
  return condition === 'responsable_inscripto' ? 'factura_b' : 'factura_c'
}

/** Qué se guarda («Qué se guarda», H.5): un gasto o una compra pagada en el acto. */
export function quickExpensePath(
  input: Pick<QuickExpenseBuildInput, 'voucher' | 'target' | 'newParty' | 'pointOfSale' | 'number'>,
  ctx: Pick<PostingContext, 'parties'>,
): QuickExpensePath {
  const partyId = input.target.type === 'party' ? input.target.partyId : null
  const hasParty = partyId !== null || input.newParty !== null
  switch (input.voucher) {
    case 'none':
      return { kind: 'expense', voucherType: 'sin_comprobante' }
    case 'ticket':
      return hasParty && input.pointOfSale !== null && input.number !== null
        ? { kind: 'purchase', voucherType: 'tique' }
        : { kind: 'expense', voucherType: 'tique' }
    case 'a':
      return { kind: 'purchase', voucherType: 'factura_a' }
    case 'bc': {
      const condition: IvaCondition =
        input.newParty?.ivaCondition ??
        (partyId ? (ctx.parties.get(partyId)?.ivaCondition ?? 'sin_datos') : 'sin_datos')
      return { kind: 'purchase', voucherType: invoiceLetterFor(condition) }
    }
  }
}

/** «Nuevo gasto» (H.5): `expense` (E4) o `[purchase, payment]` (E5). */
export function buildQuickExpense(
  input: QuickExpenseBuildInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const partyId = input.target.type === 'party' ? input.target.partyId : null
  const accountId = input.target.accountId
  if (partyId && !partyInfo({ id: partyId }, ctx)) {
    return failed([postingError('party_not_found', 'target.partyId')])
  }
  const path = quickExpensePath(input, ctx)

  if (path.kind === 'expense') {
    return buildExpense(
      {
        date: input.date,
        treasuryAccountId: input.treasuryAccountId,
        voucherType: path.voucherType,
        partyId,
        newParty: input.newParty,
        lines: [{ accountId, amountCents: input.amountCents }],
        notes: input.detail,
        warningsAck: input.warningsAck,
        recurringExpenseId: input.recurringExpenseId,
      },
      ctx,
      meta,
    )
  }

  const purchase: PurchaseBuildInput = {
    warningsAck: input.warningsAck,
    docKind: 'purchase',
    partyId,
    newParty: input.newParty
      ? { ...input.newParty, defaultAccountId: input.newParty.defaultAccountId ?? accountId }
      : null,
    voucherType: path.voucherType,
    pointOfSale: input.pointOfSale,
    number: input.number,
    issueDate: input.date,
    accountingDate: null,
    // De contado: vence el mismo día y el pago del bundle la cancela.
    dueDate: input.date,
    amountMode: 'total',
    total: {
      totalCents: input.amountCents,
      vatRateBp: path.voucherType === 'factura_a' ? input.vatRateBp : null,
      accountId,
      vatAdjustCents: path.voucherType === 'factura_a' ? input.vatAdjustCents : 0,
    },
    lines: [],
    vat: [],
    perceptions: [],
    otherTaxes: [],
    controlTotalCents: null,
    controlAccountId: null,
    relatedDocumentId: null,
    settlesCommissions: false,
    // El gasto fijo va en la compra (no en el pago): queda «Cargado» y avanza su vencimiento.
    recurringExpenseId: input.recurringExpenseId,
    payNow: {
      treasuryAccountId: input.treasuryAccountId,
      amountCents: null,
      date: null,
      reference: null,
    },
    notes: input.detail,
  }
  return buildPurchase(purchase, ctx, meta)
}
