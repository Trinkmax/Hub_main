/**
 * Los formularios de comprobantes: esquema zod + armador del motor, y cómo se
 * arma la propuesta. PURO (sin `server-only`): lo usan la acción, la vista
 * previa del servidor y — esto es lo importante — el navegador.
 *
 * **«La vista previa es exactamente lo que se guarda» (E.7) depende de que el
 * navegador y el servidor armen la propuesta igual.** El servidor arma con la
 * SALIDA de zod (defaults, CUIT normalizado, textos vacíos → `null`), no con el
 * estado crudo del formulario: una referencia `''` en vez de `null` o un CUIT
 * con guiones cambian el hash. Por eso un formulario que arma la vista previa
 * en el navegador usa `previewDocumentForm(form, values, ctx, opts)`: es el
 * mismo código que corre la acción.
 */

import type { z } from 'zod'
import { invalidState } from '@/lib/accounting/action-state'
import { engineErrorsState, warningCopy } from '@/lib/accounting/errors'
import {
  type BuildMeta,
  buildBankExpense,
  buildCashMovement,
  buildCollection,
  buildManualEntry,
  buildPayment,
  buildPurchase,
  buildPurchaseCreditNote,
  buildQuickExpense,
  buildSalesClose,
  buildSalesInvoice,
  buildTransfer,
  buildTreasuryAdjustment,
  buildWalletCheck,
} from '@/lib/accounting/posting'
import { PREVIEW_HASH_RE } from '@/lib/accounting/preview'
import {
  bankExpenseSchema,
  cashMovementSchema,
  collectionSchema,
  manualEntrySchema,
  paymentSchema,
  purchaseCreditNoteSchema,
  purchaseSchema,
  quickExpenseSchema,
  salesCloseSchema,
  salesInvoiceSchema,
  transferSchema,
  treasuryAdjustmentSchema,
  walletCheckSchema,
} from '@/lib/accounting/schemas'
import type { IsoDate, PostingContext, PostingResult, WarningKey } from '@/lib/accounting/types'
import { type DocumentRefs, refsFor } from './document-refs'
import type { DocumentForm, PreviewBundleState } from './document-types'

type FormMeta = { clientRef: string; previewHash: string; warningsAck: WarningKey[] }

/** Un formulario ya validado: sus datos de envío y cómo armar su propuesta. */
export type ParsedDocumentForm = FormMeta & {
  refs: DocumentRefs
  build: (ctx: PostingContext, meta: BuildMeta) => PostingResult
}

export type ParseDocumentFormResult =
  | { ok: true; value: ParsedDocumentForm }
  | { ok: false; error: z.ZodError }

type FormSpec = { parse: (raw: unknown) => ParseDocumentFormResult }

function defineForm<T extends FormMeta>(
  form: DocumentForm,
  schema: z.ZodType<T>,
  build: (input: T, ctx: PostingContext, meta: BuildMeta) => PostingResult,
): FormSpec {
  return {
    parse(raw) {
      const parsed = schema.safeParse(raw)
      if (!parsed.success) return { ok: false, error: parsed.error }
      const data = parsed.data
      return {
        ok: true,
        value: {
          clientRef: data.clientRef,
          previewHash: data.previewHash,
          warningsAck: data.warningsAck,
          refs: refsFor(form, data),
          build: (ctx, meta) => build(data, ctx, meta),
        },
      }
    },
  }
}

/** Esquema y armador de cada formulario. */
const FORMS: Readonly<Record<DocumentForm, FormSpec>> = {
  quick_expense: defineForm('quick_expense', quickExpenseSchema, buildQuickExpense),
  purchase: defineForm('purchase', purchaseSchema, buildPurchase),
  purchase_credit_note: defineForm(
    'purchase_credit_note',
    purchaseCreditNoteSchema,
    buildPurchaseCreditNote,
  ),
  payment: defineForm('payment', paymentSchema, buildPayment),
  sales_close: defineForm('sales_close', salesCloseSchema, buildSalesClose),
  collection: defineForm('collection', collectionSchema, buildCollection),
  wallet_check: defineForm('wallet_check', walletCheckSchema, buildWalletCheck),
  sales_invoice: defineForm('sales_invoice', salesInvoiceSchema, buildSalesInvoice),
  transfer: defineForm('transfer', transferSchema, buildTransfer),
  bank_expense: defineForm('bank_expense', bankExpenseSchema, buildBankExpense),
  cash_movement: defineForm('cash_movement', cashMovementSchema, buildCashMovement),
  treasury_adjustment: defineForm(
    'treasury_adjustment',
    treasuryAdjustmentSchema,
    buildTreasuryAdjustment,
  ),
  manual_entry: defineForm('manual_entry', manualEntrySchema, buildManualEntry),
}

export function isDocumentForm(value: unknown): value is DocumentForm {
  return typeof value === 'string' && Object.hasOwn(FORMS, value)
}

/** zod del formulario (lo que se guarda o se previsualiza). */
export function parseDocumentForm(form: DocumentForm, raw: unknown): ParseDocumentFormResult {
  return FORMS[form].parse(raw)
}

/**
 * La propuesta que se guarda: con el primer día abierto, si hay meses
 * cerrados (un gasto o una compra con fecha de un mes cerrado se contabiliza
 * ese día: «Septiembre está cerrado: lo cargamos el 01/10», H.5).
 */
export function buildPrimary(
  parsed: ParsedDocumentForm,
  ctx: PostingContext,
  firstOpenDate: IsoDate | null,
): PostingResult {
  return parsed.build(ctx, {
    clientRef: parsed.clientRef,
    validate: firstOpenDate ? { firstOpenDate } : {},
  })
}

/**
 * La misma propuesta armada SIN el primer día abierto: la fecha contable queda
 * en el mes elegido. Solo sirve para reconocer una vista previa armada sin ese
 * dato (nunca se guarda: su mes está cerrado y la RPC la rechazaría).
 */
export function buildIgnoringClosedMonths(
  parsed: ParsedDocumentForm,
  ctx: PostingContext,
): PostingResult {
  return parsed.build(ctx, { clientRef: parsed.clientRef, validate: {} })
}

/** `clientRef` de relleno para armar una vista previa (no entra al hash). */
const PREVIEW_CLIENT_REF = '00000000-0000-4000-8000-000000000000'
const PREVIEW_PLACEHOLDER_HASH = '0'.repeat(64)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Completa `clientRef` y `previewHash` si faltan: la vista previa todavía no tiene hash. */
export function withPreviewMeta(values: unknown): unknown {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) return values
  const out: Record<string, unknown> = { ...(values as Record<string, unknown>) }
  if (typeof out.clientRef !== 'string' || !UUID_RE.test(out.clientRef)) {
    out.clientRef = PREVIEW_CLIENT_REF
  }
  if (typeof out.previewHash !== 'string' || !PREVIEW_HASH_RE.test(out.previewHash)) {
    out.previewHash = PREVIEW_PLACEHOLDER_HASH
  }
  return out
}

/**
 * La vista previa de un formulario armada EXACTAMENTE como la arma la acción:
 * zod (defaults y normalizaciones) + el mismo `build*`, con el contexto que la
 * página cargó (`loadPostingContext`) y, si la página lo pasa, el primer día
 * abierto (`loadFirstOpenDate`). El `hash` es el `previewHash` que va al
 * guardar. Errores de carga: `invalid` con `fieldErrors`, como al guardar.
 */
export function previewDocumentForm(
  form: DocumentForm,
  values: unknown,
  ctx: PostingContext,
  opts: { firstOpenDate?: IsoDate | null } = {},
): PreviewBundleState {
  const parsed = parseDocumentForm(form, withPreviewMeta(values))
  if (!parsed.ok) return invalidState(parsed.error)
  const built = buildPrimary(parsed.value, ctx, opts.firstOpenDate ?? null)
  if (!built.ok) return engineErrorsState(built.errors)
  return {
    ok: true,
    preview: built.preview,
    hash: built.hash,
    warnings: built.warnings.map(warningCopy),
  }
}
