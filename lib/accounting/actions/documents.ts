'use server'

/**
 * Server actions de comprobantes de Administración (Sprint 1, G.1 · G.3).
 *
 * Todas reciben el `slug` de la URL y un objeto (no FormData) con los
 * importes ya en centavos enteros (el campo de plata convierte pesos →
 * centavos en el borde, G.2), y devuelven un estado discriminado
 * (`lib/accounting/action-state.ts`):
 *
 * - `{ ok: true, result, message }`: guardado. `message` es el texto del toast
 *   («Gasto cargado · $ 3.600 · Coca-Cola · Caja») y `result.documents[0].id`
 *   es lo que recibe `undoDocument` desde su «Deshacer» (anula todo el envío:
 *   la compra y su pago, el cierre y sus acreditaciones).
 * - `invalid` (+ `fieldErrors` por ruta: `'lines.2.accountId'`), `forbidden`,
 *   `disabled`, `conflict`, `stale`, `error`: mensaje listo para mostrar.
 * - `preview_stale` (cambió algo en la base mientras se cargaba) o `conflict`
 *   con `detail.key === 'period_closed'` y `hash` (la fecha es de un mes
 *   cerrado: el asiento corregido va al primer día abierto): traen `preview`
 *   y `hash`. Mostrá el asiento y, si la persona confirma sin tocar nada,
 *   reenviá con `previewHash = hash` («Cargarlo el 01/10»).
 * - `needs_confirmation`: avisos (`warnings`, todos juntos, con sus botones).
 *   Si los acepta, reenviá lo mismo con sus `key` agregadas a `warningsAck`
 *   (no cambian el hash). Pueden venir del motor o de la base.
 *
 * **Vista previa («Ver asiento») y `previewHash`.** O en el navegador con
 * `previewDocumentForm(form, values, ctx, { firstOpenDate })`
 * (`lib/accounting/server/document-forms.ts`, puro: el mismo código que corre
 * acá, con el `ctx` de `loadPostingContext` y el `firstOpenDate` de
 * `loadFirstOpenDate` que cargó la página), o en el servidor con
 * `previewBundle(slug, { form, values })` (para lo que el navegador no tiene:
 * partidas que se eligen después, la factura de comisiones). Nunca armes la
 * vista previa con el estado crudo del formulario: el hash es de la salida de
 * zod.
 *
 * El `clientRef` (UUID que el formulario genera al abrirse) hace idempotente
 * el envío: un reintento devuelve lo ya guardado (`result.replayed`). Se
 * mantiene entre los reenvíos de confirmación y se genera uno nuevo después de
 * cada guardado («Cargar otro»).
 *
 * El detalle de cada paso está en `lib/accounting/server/post-document.ts`.
 */

import type { AccActionState, AccSimpleState } from '@/lib/accounting/action-state'
import {
  allocateSchema,
  markTreasuryCheckedSchema,
  reverseSchema,
  unallocateSchema,
  undoDocumentSchema,
  voidDocumentSchema,
} from '@/lib/accounting/schemas'
import type {
  AllocateItemsResult,
  AllocateItemsValues,
  BankExpenseValues,
  CashMovementValues,
  CollectionValues,
  ManualEntryValues,
  MarkTreasuryCheckedValues,
  PaymentValues,
  PreviewBundleState,
  PreviewRequest,
  PurchaseValues,
  QuickExpenseValues,
  ReverseDocumentResult,
  ReverseDocumentValues,
  SalesCloseValues,
  SalesInvoiceValues,
  TransferValues,
  TreasuryAdjustmentValues,
  TreasuryCheckedResult,
  UnallocateItemValues,
  VoidDocumentResult,
  VoidDocumentValues,
  WalletCheckValues,
} from '@/lib/accounting/server/document-types'
import { runPostDocument, runPreviewDocument } from '@/lib/accounting/server/post-document'
import {
  parseAllocateResult,
  parseReverseResult,
  parseTreasuryChecked,
  parseVoidResult,
} from '@/lib/accounting/server/rpc-results'
import { runSimpleRpc } from '@/lib/accounting/server/simple-rpc'
import { formatIsoDay } from '@/lib/dates'

// ─── Comprobantes (acc_post_bundle) ──────────────────────────────────────────

/** «Nuevo gasto» (H.5): `expense`, o `[purchase, payment]` con factura de un proveedor. */
export async function postQuickExpense(
  slug: string,
  input: QuickExpenseValues,
): Promise<AccActionState> {
  return runPostDocument(slug, 'quick_expense', input)
}

/** Comprobante de compra (H.6): factura, tique, DDJJ o ND; con `payNow`, «Guardar y pagar». */
export async function postPurchase(slug: string, input: PurchaseValues): Promise<AccActionState> {
  return runPostDocument(slug, 'purchase', input)
}

/** Nota de crédito de proveedor (`docKind: 'purchase_credit_note'`). */
export async function postPurchaseCreditNote(
  slug: string,
  input: PurchaseValues,
): Promise<AccActionState> {
  return runPostDocument(slug, 'purchase_credit_note', input)
}

/** Pagar (H.8): facturas elegidas, saldos a favor, cajas y compensaciones. */
export async function postPayment(slug: string, input: PaymentValues): Promise<AccActionState> {
  return runPostDocument(slug, 'payment', input)
}

/** Cierre del día (H.9), con acreditaciones en el acto si las hay. */
export async function postSalesClose(
  slug: string,
  input: SalesCloseValues,
): Promise<AccActionState> {
  return runPostDocument(slug, 'sales_close', input)
}

/** Cobrar / acreditación (H.10): liquidación de tarjeta, plataforma o cliente. */
export async function postCollection(
  slug: string,
  input: CollectionValues,
): Promise<AccActionState> {
  return runPostDocument(slug, 'collection', input)
}

/** «Ajustar saldo de Mercado Pago» (E.5.8): acredita partidas y explica la diferencia. */
export async function postWalletCheck(
  slug: string,
  input: WalletCheckValues,
): Promise<AccActionState> {
  return runPostDocument(slug, 'wallet_check', input)
}

/** Factura, ND o NC de venta suelta (E.5.9); con `collectNow`, «Guardar y cobrar». */
export async function postSalesInvoice(
  slug: string,
  input: SalesInvoiceValues,
): Promise<AccActionState> {
  return runPostDocument(slug, 'sales_invoice', input)
}

/** Mover plata entre cajas (H.11). */
export async function postTransfer(slug: string, input: TransferValues): Promise<AccActionState> {
  return runPostDocument(slug, 'transfer', input)
}

/** Gasto bancario o impuesto debitado (H.11). */
export async function postBankExpense(
  slug: string,
  input: BankExpenseValues,
): Promise<AccActionState> {
  return runPostDocument(slug, 'bank_expense', input)
}

/** Otro ingreso o egreso de una caja (H.11). */
export async function postCashMovement(
  slug: string,
  input: CashMovementValues,
): Promise<AccActionState> {
  return runPostDocument(slug, 'cash_movement', input)
}

/** Ajustar saldo con diferencia (arqueo de caja, banco o billetera). */
export async function postTreasuryAdjustment(
  slug: string,
  input: TreasuryAdjustmentValues,
): Promise<AccActionState> {
  return runPostDocument(slug, 'treasury_adjustment', input)
}

/** Asiento manual, de ajuste, de sueldos o de cierre (H.13). */
export async function postManualEntry(
  slug: string,
  input: ManualEntryValues,
): Promise<AccActionState> {
  return runPostDocument(slug, 'manual_entry', input)
}

/**
 * «Ver asiento» armado en el servidor, sin guardar: el asiento, el hash que
 * hay que mandar como `previewHash` al guardar y los avisos. `values` es lo
 * mismo que se va a guardar (`clientRef` y `previewHash` pueden faltar).
 */
export async function previewBundle(
  slug: string,
  request: PreviewRequest,
): Promise<PreviewBundleState> {
  return runPreviewDocument(slug, request)
}

// ─── Cajas ───────────────────────────────────────────────────────────────────

/** «Ajustar saldo» sin diferencia: marca la caja como verificada a esa fecha. */
export async function markTreasuryChecked(
  slug: string,
  input: MarkTreasuryCheckedValues,
): Promise<AccSimpleState<TreasuryCheckedResult>> {
  return runSimpleRpc(slug, input, {
    op: 'treasury_checked',
    schema: markTreasuryCheckedSchema,
    call: (tenantId, v) => ({
      fn: 'acc_mark_treasury_checked',
      args: {
        p_tenant_id: tenantId,
        p_treasury_id: v.treasuryAccountId,
        p_counted_cents: v.countedCents,
        p_expected_book_cents: v.expectedBookCents,
        p_as_of: v.asOf,
      },
    }),
    done: (data, v) => ({
      data: parseTreasuryChecked(data, v.treasuryAccountId),
      message: 'Saldo verificado: coincide con lo contado.',
    }),
  })
}

// ─── Correcciones (C.4) ──────────────────────────────────────────────────────

/**
 * Anular un comprobante de un mes abierto (motivo de 5 a 300 letras). Con
 * `withBundle`, todo el envío. Si otros pagos o cobros lo cancelaron, la base
 * contesta `document_has_allocations` (`detail.key`): preguntá y reenviá con
 * `unallocate: true` (esos pagos quedan a cuenta).
 */
export async function voidDocument(
  slug: string,
  input: VoidDocumentValues,
): Promise<AccSimpleState<VoidDocumentResult>> {
  return runSimpleRpc(slug, input, {
    op: 'void',
    schema: voidDocumentSchema,
    call: (tenantId, v) => ({
      fn: 'acc_void_document',
      args: {
        p_tenant_id: tenantId,
        p_document_id: v.documentId,
        p_reason: v.reason,
        p_options: { with_bundle: v.withBundle, unallocate: v.unallocate, undo: false },
      },
    }),
    done: (data) => {
      const result = parseVoidResult(data)
      const title =
        result.voidedDocumentIds.length > 1 ? 'Comprobantes anulados.' : 'Comprobante anulado.'
      return {
        data: result,
        message:
          result.unallocatedCount > 0 ? `${title} Lo que tenía aplicado quedó a cuenta.` : title,
      }
    },
  })
}

/** El «Deshacer» del toast: anula todo lo guardado en ese envío (10 minutos, solo quien lo cargó). */
export async function undoDocument(
  slug: string,
  documentId: string,
): Promise<AccSimpleState<VoidDocumentResult>> {
  return runSimpleRpc(
    slug,
    { documentId },
    {
      op: 'undo',
      schema: undoDocumentSchema,
      call: (tenantId, v) => ({
        fn: 'acc_void_document',
        args: {
          p_tenant_id: tenantId,
          p_document_id: v.documentId,
          p_reason: 'Deshacer',
          p_options: { with_bundle: true, unallocate: false, undo: true },
        },
      }),
      done: (data) => ({ data: parseVoidResult(data), message: 'Listo, lo deshicimos.' }),
    },
  )
}

/**
 * «Anular con fecha de hoy» (comprobante de un mes cerrado, C.4.3): un
 * comprobante espejo en un mes abierto. Idempotente por `clientRef`.
 */
export async function reverseDocument(
  slug: string,
  input: ReverseDocumentValues,
): Promise<AccSimpleState<ReverseDocumentResult>> {
  return runSimpleRpc(slug, input, {
    op: 'reverse',
    schema: reverseSchema,
    call: (tenantId, v) => ({
      fn: 'acc_reverse_document',
      args: {
        p_tenant_id: tenantId,
        p_client_ref: v.clientRef,
        p_document_id: v.documentId,
        p_reason: v.reason,
        p_reversal_date: v.reversalDate,
        p_options: { unallocate: v.unallocate },
      },
    }),
    done: (data, v) => ({
      data: parseReverseResult(data),
      message: `Comprobante anulado con fecha ${formatIsoDay(v.reversalDate)}.`,
    }),
  })
}

/** «Imputar» o «Usar saldo a favor» entre partidas abiertas del mismo partícipe y cuenta. */
export async function allocateItems(
  slug: string,
  input: AllocateItemsValues,
): Promise<AccSimpleState<AllocateItemsResult>> {
  return runSimpleRpc(slug, input, {
    op: 'allocate',
    schema: allocateSchema,
    call: (tenantId, v) => ({
      fn: 'acc_allocate',
      args: {
        p_tenant_id: tenantId,
        p_pairs: v.pairs.map((p) => ({
          debit_line_id: p.debitLineId,
          credit_line_id: p.creditLineId,
          amount_cents: p.amountCents,
        })),
        p_date: v.date,
      },
    }),
    done: (data, v) => ({
      data: parseAllocateResult(data),
      message: v.pairs.length > 1 ? 'Imputaciones guardadas.' : 'Imputación guardada.',
    }),
  })
}

/** Deshacer una imputación (queda a cuenta). Las de una anulación no se tocan. */
export async function unallocateItem(
  slug: string,
  input: UnallocateItemValues,
): Promise<AccSimpleState> {
  return runSimpleRpc(slug, input, {
    op: 'unallocate',
    schema: unallocateSchema,
    call: (tenantId, v) => ({
      fn: 'acc_unallocate',
      args: { p_tenant_id: tenantId, p_allocation_id: v.allocationId, p_reason: v.reason },
    }),
    done: () => ({ data: undefined, message: 'Imputación quitada: quedó a cuenta.' }),
  })
}
