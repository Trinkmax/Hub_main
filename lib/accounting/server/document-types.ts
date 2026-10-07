/**
 * Tipos de las acciones de comprobantes (`lib/accounting/actions/documents.ts`).
 *
 * Viven acá porque un archivo `'use server'` solo puede exportar funciones
 * async. Puro (sin `server-only`): los importan los formularios.
 *
 * Los `*Values` son la ENTRADA de cada esquema de `lib/accounting/schemas.ts`
 * (`z.input`: los campos con default son opcionales). Importes en centavos
 * enteros: el campo de plata convierte pesos → centavos en el borde (G.2).
 */

import type { z } from 'zod'
import type { AccFailureState } from '@/lib/accounting/action-state'
import type { WarningCopy } from '@/lib/accounting/errors'
import type {
  allocateSchema,
  bankExpenseSchema,
  cashMovementSchema,
  collectionSchema,
  manualEntrySchema,
  markTreasuryCheckedSchema,
  paymentSchema,
  purchaseSchema,
  quickExpenseSchema,
  reverseSchema,
  salesCloseSchema,
  salesInvoiceSchema,
  transferSchema,
  treasuryAdjustmentSchema,
  unallocateSchema,
  voidDocumentSchema,
  walletCheckSchema,
} from '@/lib/accounting/schemas'
import type { EntryPreview } from '@/lib/accounting/types'

// ─── Entradas de los formularios ─────────────────────────────────────────────

export type QuickExpenseValues = z.input<typeof quickExpenseSchema>
/** Compra, nota de débito o nota de crédito de proveedor (`docKind`). */
export type PurchaseValues = z.input<typeof purchaseSchema>
export type PaymentValues = z.input<typeof paymentSchema>
export type SalesCloseValues = z.input<typeof salesCloseSchema>
export type CollectionValues = z.input<typeof collectionSchema>
export type WalletCheckValues = z.input<typeof walletCheckSchema>
/** Factura, nota de débito o nota de crédito de venta (`docKind`). */
export type SalesInvoiceValues = z.input<typeof salesInvoiceSchema>
export type TransferValues = z.input<typeof transferSchema>
export type BankExpenseValues = z.input<typeof bankExpenseSchema>
export type CashMovementValues = z.input<typeof cashMovementSchema>
export type TreasuryAdjustmentValues = z.input<typeof treasuryAdjustmentSchema>
export type ManualEntryValues = z.input<typeof manualEntrySchema>
export type MarkTreasuryCheckedValues = z.input<typeof markTreasuryCheckedSchema>
export type VoidDocumentValues = z.input<typeof voidDocumentSchema>
export type ReverseDocumentValues = z.input<typeof reverseSchema>
export type AllocateItemsValues = z.input<typeof allocateSchema>
export type UnallocateItemValues = z.input<typeof unallocateSchema>

// ─── Vista previa en el servidor («Ver asiento») ─────────────────────────────

/**
 * Lo mismo que manda el formulario al guardar, pero `clientRef` y
 * `previewHash` son opcionales: la vista previa todavía no tiene hash.
 */
export type PreviewValues<T> = Omit<T, 'clientRef' | 'previewHash'> & {
  clientRef?: string
  previewHash?: string
}

export type PreviewRequest =
  | { form: 'quick_expense'; values: PreviewValues<QuickExpenseValues> }
  | { form: 'purchase'; values: PreviewValues<PurchaseValues> }
  | { form: 'purchase_credit_note'; values: PreviewValues<PurchaseValues> }
  | { form: 'payment'; values: PreviewValues<PaymentValues> }
  | { form: 'sales_close'; values: PreviewValues<SalesCloseValues> }
  | { form: 'collection'; values: PreviewValues<CollectionValues> }
  | { form: 'wallet_check'; values: PreviewValues<WalletCheckValues> }
  | { form: 'sales_invoice'; values: PreviewValues<SalesInvoiceValues> }
  | { form: 'transfer'; values: PreviewValues<TransferValues> }
  | { form: 'bank_expense'; values: PreviewValues<BankExpenseValues> }
  | { form: 'cash_movement'; values: PreviewValues<CashMovementValues> }
  | { form: 'treasury_adjustment'; values: PreviewValues<TreasuryAdjustmentValues> }
  | { form: 'manual_entry'; values: PreviewValues<ManualEntryValues> }

/** Los formularios que guardan comprobantes con `acc_post_bundle`. */
export type DocumentForm = PreviewRequest['form']
export type PreviewForm = DocumentForm

/**
 * Resultado de `previewBundle`: el asiento armado con el contexto DE LA BASE,
 * su hash (lo que el formulario manda como `previewHash` al guardar) y los
 * avisos que va a pedir confirmar. Con errores de carga, el mismo estado que
 * devolvería guardar (`invalid` con `fieldErrors`).
 */
export type PreviewBundleState =
  | { ok: true; preview: EntryPreview[]; hash: string; warnings: WarningCopy[] }
  | AccFailureState

// ─── Resultados de las correcciones ──────────────────────────────────────────

/** `acc_void_document`: los comprobantes anulados (todo el envío con `withBundle`) y los pagos que quedaron a cuenta. */
export type VoidDocumentResult = {
  voidedDocumentIds: string[]
  unallocatedCount: number
}

/** `acc_reverse_document`: la anulación con fecha de hoy (comprobante `reversal`). */
export type ReverseDocumentResult = {
  /** `null` solo si la base no lo devolvió (versión vieja de la RPC). */
  reversalDocumentId: string | null
  /** El mismo pedido ya estaba guardado (doble envío): no se anuló dos veces. */
  replayed: boolean
}

/** `acc_allocate`: las imputaciones creadas. */
export type AllocateItemsResult = { allocationIds: string[] }

/** `acc_mark_treasury_checked`: la caja quedó verificada a esa fecha. */
export type TreasuryCheckedResult = {
  treasuryAccountId: string
  lastCheckedOn: string | null
}
