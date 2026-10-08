/**
 * Formas del servidor de importaciones (diseño §4.0, WP6): estados, lo que le
 * falta a una propuesta (`needs`), su resumen para la lista (`summary`), los
 * motivos de un salteo, los textos en palabras simples y los esquemas zod de
 * las acciones de `lib/imports/actions.ts`.
 *
 * Puro (sin `server-only`): lo importan las acciones, las lecturas y las
 * pantallas (WP10/WP11) para tipar lo que reciben.
 *
 * **Convención del jsonb.** `needs`, `summary` y `error` se guardan en
 * snake_case, igual que lo que escribe la base (`error = {reason, batch_id}` de
 * `acc_import_put_proposals`). `form_values` va en camelCase porque es la
 * entrada (`*Values`) del formulario de Administración, sin `clientRef`,
 * `previewHash` ni `warningsAck` (los avisos aceptados viven en la columna
 * `warnings_ack`).
 */

import { z } from 'zod'
import { optionalIsoDay, optionalText, signedCentsInt, uuidField } from '@/lib/accounting/schemas'
import {
  IVA_CONDITIONS,
  type IvaCondition,
  WARNING_KEYS,
  type WarningKey,
} from '@/lib/accounting/types'
import { importIssuesSchema, type ProposalForm } from '../types'

// ─── Estados (los CHECK de 20261008120200_acc_imports_core.sql y 20261008120340) ─

export const BATCH_STATUSES = ['staging', 'review', 'posting', 'done', 'cancelled'] as const
export type ImportBatchStatus = (typeof BATCH_STATUSES)[number]

export const ITEM_STATUSES = [
  'new',
  'duplicate',
  'ignored',
  'review',
  'posted',
  'cancelled',
] as const
export type ImportItemStatus = (typeof ITEM_STATUSES)[number]

export const PROPOSAL_STATUSES = [
  'needs_input',
  'ready',
  'posting',
  'posted',
  'stale',
  'error',
  'skipped',
  /**
   * El comprobante se anuló o se revirtió (lo marca la base, migración
   * 20261008120340). Queda así hasta «Volver a cargar» (cambio `reimport`): ahí
   * se arma de nuevo con `attempt + 1` y su `client_ref` nuevo.
   */
  'voided',
] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

export const PROPOSAL_FORMS = [
  'purchase',
  'purchase_credit_note',
  'collection',
  'bank_expense',
  'transfer',
  'cash_movement',
  'payment',
] as const satisfies readonly ProposalForm[]

/** Orígenes que tienen propuestas en esta versión (Emitidos llega con WP13). */
export const PROPOSAL_SOURCES = ['arca_recibidos', 'mp_release', 'bank_statement'] as const
export type ProposalSource = (typeof PROPOSAL_SOURCES)[number]

// ─── Lo que le falta a una propuesta (`needs`) ───────────────────────────────

/** Canales de cobro de Mercado Pago que se mapean a un medio del cierre del día. */
export const MP_COBRO_CHANNELS = ['qr', 'point', 'link', 'transfer_in'] as const
export type MpCobroChannel = (typeof MP_COBRO_CHANNELS)[number]

/** A quién hay que elegir en `pick_party`. */
export type PartyRole = 'supplier' | 'tax_agency' | 'payroll' | 'card_processor' | 'any'

/** Lo que solo se puede cargar a mano («Cargarla a mano») o ignorar. */
export type ManualReason =
  | 'cheque'
  | 'commissions_extras'
  | 'unsupported'
  | 'not_ours'
  | 'check_row'

export const NEED_KEYS = [
  'new_supplier',
  'supplier_account',
  'supplier_inactive',
  'condition_mismatch',
  'other_taxes_as',
  'vat_rate',
  'unsupported_voucher',
  'receipt',
  'foreign_currency',
  'total_gap',
  'possible_duplicate',
  'mp_invoice',
  'channel_method',
  'pick_party',
  'pick_treasury',
  'counterpart_account',
  'unknown_tax',
  'estimated_deductions',
  'accept_warning',
  'engine_error',
  'manual',
] as const
export type NeedKey = (typeof NEED_KEYS)[number]

/**
 * Lo que falta, con los datos para mostrarlo y resolverlo. Ninguno trae datos
 * personales: un CUIT de proveedor y la razón social que informa ARCA son del
 * comprobante (ya están en `acc_import_items.data`).
 */
export type ImportNeed =
  | { key: 'new_supplier'; cuit: string; name: string; suggested_condition: IvaCondition }
  | { key: 'supplier_account'; party_id: string }
  | { key: 'supplier_inactive'; party_id: string }
  | {
      key: 'condition_mismatch'
      party_id: string
      condition: IvaCondition
      suggested_condition: IvaCondition | null
    }
  | { key: 'other_taxes_as'; party_id: string | null; amount_cents: number }
  | { key: 'vat_rate' }
  | { key: 'unsupported_voucher'; code: number }
  | { key: 'receipt'; code: number }
  | { key: 'foreign_currency'; currency: string; fx_rate: string; original_total_cents: number }
  | { key: 'total_gap'; cents: number }
  | { key: 'possible_duplicate'; document_id: string; label: string }
  | { key: 'mp_invoice' }
  | { key: 'channel_method'; channel: MpCobroChannel }
  | { key: 'pick_party'; role: PartyRole; suggested_party_id: string | null }
  | { key: 'pick_treasury'; suggested_treasury_id: string | null }
  | { key: 'counterpart_account'; direction: 'in' | 'out' }
  | { key: 'unknown_tax'; tax: string; amount_cents: number }
  | { key: 'estimated_deductions' }
  | { key: 'accept_warning'; warnings: WarningKey[] }
  | { key: 'engine_error'; error_key: string | null; message: string; field: string | null }
  | { key: 'manual'; reason: ManualReason }

/** Las que se resuelven con un «Confirmar» (cambio `confirm`). */
export const CONFIRMABLE_NEEDS = [
  'foreign_currency',
  'possible_duplicate',
  'estimated_deductions',
] as const satisfies readonly NeedKey[]
export type ConfirmableNeed = (typeof CONFIRMABLE_NEEDS)[number]

export const NEED_TEXT: Readonly<Record<NeedKey, string>> = {
  new_supplier: 'Es un proveedor nuevo: creálo y elegí en qué gastás con él.',
  supplier_account: 'Elegí en qué gastás con este proveedor (su cuenta habitual).',
  supplier_inactive: 'El proveedor está desactivado. Activalo en Compras › Proveedores.',
  condition_mismatch:
    'El tipo de comprobante no va con la condición frente al IVA del proveedor. Actualizá el proveedor.',
  other_taxes_as:
    'Tiene «Otros tributos» y ARCA no dice cuáles son: elegí si es percepción de IIBB, de IVA, impuestos internos u otra cuenta.',
  vat_rate: 'ARCA no informa la alícuota de IVA de este comprobante: cargalo a mano.',
  unsupported_voucher: 'Este tipo de comprobante no se importa todavía: cargalo a mano.',
  receipt:
    'Es un recibo: ¿es el pago de una factura ya cargada (ignoralo) o un gasto sin factura (cargalo a mano)?',
  foreign_currency:
    'Está en moneda extranjera: lo pasamos a pesos con el tipo de cambio del comprobante. Revisá la conversión.',
  total_gap: 'El total es menor que la suma de sus partes: cargalo a mano.',
  possible_duplicate: 'Ya cargaste algo parecido (mismo proveedor y total). ¿Es otro?',
  mp_invoice: '¿Es la factura mensual de comisiones de Mercado Pago?',
  channel_method:
    'Elegí a qué medio del cierre del día corresponde este canal de Mercado Pago (se guarda para la próxima).',
  pick_party: 'Elegí a quién le corresponde este movimiento.',
  pick_treasury: 'Elegí la otra cuenta del movimiento.',
  counterpart_account: 'Elegí qué es este movimiento (la cuenta contra la que va).',
  unknown_tax: 'Mercado Pago descontó un impuesto que no conocemos: elegí la cuenta.',
  estimated_deductions:
    'Los descuentos son estimados con las tasas del partícipe: confirmalos con la liquidación.',
  accept_warning: 'Revisá los avisos antes de cargarlo.',
  engine_error: 'No pudimos armar el asiento con estos datos.',
  manual: 'Esto se carga a mano.',
}

export const MANUAL_REASON_TEXT: Readonly<Record<ManualReason, string>> = {
  cheque: 'Es un cheque: cargalo a mano con su comprobante.',
  commissions_extras:
    'La factura de comisiones trae otros tributos: cargala a mano para separar las percepciones.',
  unsupported: 'Este movimiento todavía no se importa: cargalo a mano.',
  not_ours: 'Está a nombre de otra CUIT o de un DNI: si no es de la SAS, marcalo «No es nuestro».',
  check_row: 'El archivo trae un dato raro en esta fila: revisala y, si está bien, cargala a mano.',
}

// ─── Por qué se salteó ───────────────────────────────────────────────────────

export const SKIP_REASONS = [
  'already_loaded',
  'manual_overlap',
  'replaced',
  'ignored',
  'reserve',
  'rule_ignore',
  'posted_in_other_batch',
  'active_in_other_batch',
  'nothing_to_load',
] as const
export type SkipReason = (typeof SKIP_REASONS)[number]

/** `acc_import_proposals.error`: un salteo, o por qué falló al contabilizar. */
export type ProposalError = {
  reason: SkipReason | 'post_failed'
  /** Clave del catálogo (`ACC_ERRORS`) si vino de la base o del motor. */
  key?: string | null
  /** El motivo en palabras simples. */
  message?: string
  document_id?: string
  label?: string
  date?: string
  batch_id?: string
}

export const SKIP_REASON_TEXT: Readonly<Record<SkipReason | 'post_failed', string>> = {
  already_loaded: 'Ya está cargado en los libros.',
  manual_overlap:
    'Ese día ya tiene movimientos de Mercado Pago cargados a mano: importá desde el día siguiente o anulá lo manual.',
  replaced: 'Se reemplazó por otra propuesta al revisar de nuevo.',
  ignored: 'Las filas se marcaron como «no es nuestro».',
  reserve: 'Reservas de dinero que se compensan solas: no se cargan.',
  rule_ignore: 'Una regla del bar dice que esto no se carga.',
  posted_in_other_batch: 'Ya se cargó desde otra importación.',
  active_in_other_batch: 'Está pendiente en otra importación: cargalo desde ahí.',
  nothing_to_load: 'No hay nada para cargar.',
  post_failed: 'No se pudo cargar.',
}

/** Una propuesta `voided` que llega a «Cargar». */
export const PROPOSAL_VOIDED_TEXT =
  'El comprobante se anuló. Si hay que cargarlo de nuevo, tocá «Volver a cargar».'

// ─── Resumen para la lista (`summary`) ───────────────────────────────────────

export const SUMMARY_KINDS = [
  'purchase',
  'credit_note',
  'mp_collection',
  'mp_bank_tax',
  'mp_iibb',
  'mp_yield',
  'mp_transfer',
  'mp_payment',
  'mp_review',
  'mp_reserve',
  'bank_expense',
  'bank_transfer',
  'bank_payment',
  'bank_collection',
  'bank_review',
] as const
export type SummaryKind = (typeof SUMMARY_KINDS)[number]

export const NOTE_KEYS = [
  'rounding_absorbed',
  'gap_to_other_taxes',
  'converted',
  'missing_close',
  'inferred_method',
  'balance_chain',
  'unmatched_charges',
  'rule_applied',
  'reimport',
] as const
export type NoteKey = (typeof NOTE_KEYS)[number]

export const NOTE_TEXT: Readonly<Record<NoteKey, string>> = {
  rounding_absorbed: 'ARCA redondeó: la diferencia de centavos va al neto más grande.',
  gap_to_other_taxes:
    'El total supera la suma de sus partes: la diferencia va a «Otros tributos» (seguramente percepciones).',
  converted: 'Convertido a pesos con el tipo de cambio del comprobante.',
  missing_close: 'Falta el cierre del día: el cobro queda a favor y se imputa cuando lo cargues.',
  inferred_method: 'El medio del cierre se dedujo por el nombre: revisalo en la configuración.',
  balance_chain: 'El saldo del reporte no sigue fila a fila ese día: revisá el reporte.',
  unmatched_charges: 'Hay cargos de IVA o percepciones que no calzan con ninguna comisión.',
  rule_applied: 'Se aplicó una regla del bar.',
  reimport: 'El comprobante anterior se anuló: esta es una carga nueva.',
}

/**
 * Decisiones de la persona sobre una propuesta (sobreviven a «Revisar de
 * nuevo»). Viven en `summary.decisions`.
 */
export type ProposalDecisions = {
  other_taxes_as?: OtherTaxesAs
  other_taxes_account_id?: string
  jurisdiction_code?: number
  party_id?: string
  treasury_id?: string
  counterpart_account_id?: string
  /** NC → la factura que corrige (`null` = quedó a favor del proveedor). */
  credit_note_document_id?: string | null
  settles_commissions?: boolean
  /** Impuesto desconocido de Mercado Pago → cuenta elegida. */
  tax_accounts?: Record<string, string>
  confirmed?: ConfirmableNeed[]
}

export type ProposalSummary = {
  kind: SummaryKind
  /** Fecha del comprobante o del movimiento. */
  date: string
  /** Mes del libro (`yyyy-MM`) cuando el asiento se pudo armar. */
  month: string | null
  /** «Factura A 0003-00110266», «Cobros con QR del 05/10»… */
  label: string
  /** Proveedor, partícipe o caja (texto para la lista). */
  counterparty: string | null
  total_cents: number
  item_count: number
  /** Números del origen para la revisión (bruto, comisión, cierre…). */
  detail?: Record<string, string | number | boolean | null>
  /** Avisos del motor que se aceptan con la confirmación del lote. */
  warnings?: WarningKey[]
  notes?: NoteKey[]
  decisions?: ProposalDecisions
}

/**
 * Avisos que se aceptan con la confirmación del lote («Cargar 142 compras»):
 * se explican en el resumen previo y la persona los acepta todos juntos. Un
 * posible duplicado nunca: se resuelve propuesta por propuesta.
 */
export const BATCH_ACCEPTABLE_WARNINGS = [
  'vat_diff',
  'voucher_condition',
  'voucher_m',
  'late_registration',
  'treasury_negative',
] as const satisfies readonly WarningKey[]
export type BatchAcceptableWarning = (typeof BATCH_ACCEPTABLE_WARNINGS)[number]

export function isBatchAcceptable(key: WarningKey): key is BatchAcceptableWarning {
  return (BATCH_ACCEPTABLE_WARNINGS as readonly string[]).includes(key)
}

/** Cómo se carga «Otros tributos» de Mis Comprobantes (diseño §4.1). */
export const OTHER_TAXES_AS = ['perc_iibb', 'perc_iva', 'internal', 'account'] as const
export type OtherTaxesAs = (typeof OTHER_TAXES_AS)[number]

/** Conteos del lote (`acc_import_batches.counts`, los arma `private.acc_import_refresh_counts`). */
export type ImportBatchCounts = {
  items: number
  new: number
  duplicate: number
  ignored: number
  review: number
  postedItems: number
  cancelled: number
  proposals: number
  needsInput: number
  ready: number
  posting: number
  posted: number
  stale: number
  error: number
  skipped: number
  voided: number
}

// ─── Esquemas de las acciones ────────────────────────────────────────────────

const UUID_MESSAGE = 'Recargá la página y probá de nuevo.'
const batchIdField = uuidField(UUID_MESSAGE)
const proposalKeyField = z
  .string({ message: UUID_MESSAGE })
  .min(3, UUID_MESSAGE)
  .max(200, UUID_MESSAGE)
const cuit11 = z.string({ message: 'Falta el CUIT.' }).regex(/^\d{11}$/, 'Revisá el CUIT.')

/** Un valor suelto del `meta` del lote (sin objetos: nada que pueda arrastrar datos de una fila). */
const metaScalar = z.union([
  z.string().max(120),
  z.number().int().min(-1e15).max(1e15),
  z.boolean(),
  z.null(),
])

/**
 * `acc_import_batches.meta`: lo que el navegador sabe del archivo (generación,
 * saldos, controles). Lista blanca estricta: ninguna clave puede traer datos
 * personales de las filas.
 */
export const batchMetaSchema = z
  .object({
    layout: z.string().max(40).optional(),
    generation: z.enum(['g1', 'g2', 'g3']).optional(),
    titleCuit: cuit11.nullable().optional(),
    headerRow: z.number().int().min(0).max(1_000_000).nullable().optional(),
    decimal: z.enum([',', '.']).optional(),
    delimiter: z.enum([';', ',', '\t', '|']).optional(),
    encoding: z.string().max(20).optional(),
    container: z.string().max(20).optional(),
    cutoffHour: z.number().int().min(0).max(8).optional(),
    initialBalanceCents: signedCentsInt().nullable().optional(),
    finalBalanceCents: signedCentsInt().nullable().optional(),
    rows: z.number().int().min(0).max(10_000_000).optional(),
    rowErrors: z.number().int().min(0).max(10_000_000).optional(),
    checks: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/), metaScalar).optional(),
    stats: z
      .record(
        z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/),
        z.number().int().min(-1e15).max(1e15),
      )
      .optional(),
    fileIssues: importIssuesSchema.max(20).optional(),
  })
  .strict()
export type ImportBatchMeta = z.infer<typeof batchMetaSchema>

export const createImportBatchSchema = z
  .object({
    source: z.enum(['arca_recibidos', 'mp_release', 'bank_statement'], {
      message: 'Este archivo todavía no se puede importar acá.',
    }),
    fileName: optionalText(200).default(null),
    fileSha256: z
      .string({ message: UUID_MESSAGE })
      .regex(/^[0-9a-f]{64}$/, 'No pudimos leer el archivo. Probá subirlo de nuevo.'),
    fileSize: z
      .number({ message: UUID_MESSAGE })
      .int(UUID_MESSAGE)
      .min(1, 'El archivo está vacío.')
      .max(20 * 1024 * 1024, 'El archivo pesa más de 20 MB. Bajá un período más corto.'),
    detectedFormat: z
      .string()
      .regex(/^[a-z0-9_:-]{2,80}$/, UUID_MESSAGE)
      .nullable()
      .default(null),
    periodFrom: optionalIsoDay.default(null),
    periodTo: optionalIsoDay.default(null),
    treasuryAccountId: uuidField('Elegí la cuenta del extracto.').nullable().default(null),
    meta: batchMetaSchema.default({}),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.source === 'bank_statement' && v.treasuryAccountId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['treasuryAccountId'],
        message: 'Elegí la cuenta del extracto.',
      })
    }
    if (v.periodFrom !== null && v.periodTo !== null && v.periodTo < v.periodFrom) {
      ctx.addIssue({ code: 'custom', path: ['periodTo'], message: 'Revisá el período.' })
    }
  })
export type CreateImportBatchInput = z.input<typeof createImportBatchSchema>

/** Una fila ya parseada en el navegador (`data` se valida contra el esquema de su origen). */
export const stagedRowSchema = z
  .object({
    rowNo: z.number().int().min(0).max(9_999_999),
    naturalKey: z.string().min(3).max(200),
    data: z.unknown(),
    issues: z.array(z.unknown()).max(200).default([]),
  })
  .strict()

export const addImportItemsSchema = z
  .object({
    batchId: batchIdField,
    items: z
      .array(stagedRowSchema, { message: 'Revisá la lista.' })
      .min(1, 'No hay filas para cargar.')
      .max(1000, 'Mandá las filas en tandas de hasta 1000.'),
  })
  .strict()
export type AddImportItemsInput = z.input<typeof addImportItemsSchema>

export const batchOnlySchema = z.object({ batchId: batchIdField }).strict()

const otherTaxesChange = z
  .object({
    kind: z.literal('other_taxes_as'),
    proposalKey: proposalKeyField.nullable().default(null),
    partyId: uuidField().nullable().default(null),
    as: z.enum(OTHER_TAXES_AS, { message: 'Elegí qué es.' }),
    accountId: uuidField('Elegí la cuenta.').nullable().default(null),
    jurisdictionCode: z.number().int().min(901).max(924).nullable().default(null),
    remember: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.proposalKey === null && v.partyId === null) {
      ctx.addIssue({ code: 'custom', path: ['proposalKey'], message: UUID_MESSAGE })
    }
    if (v.remember && v.partyId === null) {
      ctx.addIssue({ code: 'custom', path: ['partyId'], message: 'Elegí el proveedor.' })
    }
    if (v.as === 'account' && v.accountId === null) {
      ctx.addIssue({ code: 'custom', path: ['accountId'], message: 'Elegí la cuenta.' })
    }
  })

/** Un cambio de la revisión (diseño §4.0, `resolveImportNeeds`). */
export const importChangeSchema = z.union([
  z
    .object({
      kind: z.literal('supplier_account'),
      partyId: uuidField(),
      accountId: uuidField('Elegí la cuenta.'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('supplier_condition'),
      partyId: uuidField(),
      ivaCondition: z.enum(IVA_CONDITIONS, { message: 'Elegí la condición frente al IVA.' }),
    })
    .strict(),
  otherTaxesChange,
  z
    .object({
      kind: z.enum(['ignore', 'unignore']),
      itemIds: z.array(uuidField()).min(1).max(1000),
      reason: optionalText(200).default(null),
    })
    .strict(),
  z
    .object({
      kind: z.literal('channel_method'),
      channel: z.enum(MP_COBRO_CHANNELS),
      salesMethodId: uuidField('Elegí el medio.').nullable(),
    })
    .strict(),
  z
    .object({ kind: z.literal('pick_party'), proposalKey: proposalKeyField, partyId: uuidField() })
    .strict(),
  z
    .object({
      kind: z.literal('pick_treasury'),
      proposalKey: proposalKeyField,
      treasuryAccountId: uuidField('Elegí la cuenta.'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('pick_account'),
      proposalKey: proposalKeyField,
      accountId: uuidField('Elegí la cuenta.'),
      /** `null` = la contrapartida; si no, el impuesto desconocido (`unknown_tax.tax`). */
      tax: z.string().min(1).max(80).nullable().default(null),
    })
    .strict(),
  z
    .object({
      kind: z.literal('link_credit_note'),
      proposalKey: proposalKeyField,
      documentId: uuidField().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('settles_commissions'),
      proposalKey: proposalKeyField,
      value: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('accept_warning'),
      proposalKey: proposalKeyField,
      warning: z.enum(WARNING_KEYS),
    })
    .strict(),
  z
    .object({
      kind: z.literal('confirm'),
      proposalKey: proposalKeyField,
      need: z.enum(CONFIRMABLE_NEEDS),
    })
    .strict(),
  z.object({ kind: z.literal('reset'), proposalKey: proposalKeyField }).strict(),
  /** «Volver a cargar» una propuesta `voided` (otro intento, con su `client_ref` nuevo). */
  z.object({ kind: z.literal('reimport'), proposalKey: proposalKeyField }).strict(),
])
export type ImportChange = z.output<typeof importChangeSchema>
export type ImportChangeInput = z.input<typeof importChangeSchema>

export const resolveImportNeedsSchema = z
  .object({
    batchId: batchIdField,
    changes: z.array(importChangeSchema).min(1, 'No hay cambios.').max(50, 'Demasiados cambios.'),
  })
  .strict()
export type ResolveImportNeedsInput = z.input<typeof resolveImportNeedsSchema>

export const createImportSuppliersSchema = z
  .object({
    batchId: batchIdField,
    suppliers: z
      .array(
        z
          .object({
            cuit: cuit11,
            name: z
              .string({ message: 'Escribí la razón social.' })
              .trim()
              .min(2, 'Escribí la razón social.')
              .max(120, 'La razón social puede tener hasta 120 caracteres.'),
            ivaCondition: z.enum(IVA_CONDITIONS, { message: 'Elegí la condición frente al IVA.' }),
            accountId: uuidField('Elegí en qué gastás con él.'),
            paymentTermDays: z.number().int().min(0).max(365).default(0),
          })
          .strict(),
      )
      .min(1, 'Elegí al menos un proveedor.')
      .max(200, 'Creá hasta 200 proveedores por vez.'),
  })
  .strict()
export type CreateImportSuppliersInput = z.input<typeof createImportSuppliersSchema>

export const postImportProposalsSchema = z
  .object({
    batchId: batchIdField,
    items: z
      .array(
        z
          .object({
            key: proposalKeyField,
            previewHash: z.string().regex(/^[0-9a-f]{64}$/, UUID_MESSAGE),
          })
          .strict(),
      )
      .min(1, 'No hay nada para cargar.')
      .max(15, 'Se cargan de a 15.'),
    /** Avisos aceptados en el resumen previo (solo los que se aceptan por lote). */
    acceptWarnings: z.array(z.enum(BATCH_ACCEPTABLE_WARNINGS)).max(10).default([]),
  })
  .strict()
export type PostImportProposalsInput = z.input<typeof postImportProposalsSchema>

export const cancelImportBatchSchema = z
  .object({ batchId: batchIdField, reason: optionalText(300).default(null) })
  .strict()

const ruleMatchSchema = z
  .object({
    direction: z.enum(['credit', 'debit']).optional(),
    pattern: z.string().trim().min(1).max(200).optional(),
    counterparty_cuit: cuit11.optional(),
    amount_min: z.number().int().min(0).max(1e15).optional(),
    amount_max: z.number().int().min(0).max(1e15).optional(),
    treasury_account_id: uuidField().optional(),
    party_id: uuidField().optional(),
  })
  .strict()

const ruleActionSchema = z
  .object({
    kind: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
    account_id: uuidField().optional(),
    party_id: uuidField().optional(),
    treasury_account_id: uuidField().optional(),
    field: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,39}$/)
      .optional(),
    component: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,39}$/)
      .optional(),
    other_taxes_as: z.enum(OTHER_TAXES_AS).optional(),
    jurisdiction_code: z.number().int().min(901).max(924).optional(),
  })
  .strict()

export const saveImportRuleSchema = z
  .object({
    id: uuidField().nullable().default(null),
    expectedUpdatedAt: z.string().max(64).nullable().default(null),
    source: z.enum(['arca_recibidos', 'mp_release', 'bank_statement']),
    priority: z.number().int().min(1).max(1000).default(100),
    label: z
      .string({ message: 'Escribí el motivo.' })
      .trim()
      .min(2, 'Escribí el motivo.')
      .max(120, 'El motivo puede tener hasta 120 caracteres.'),
    match: ruleMatchSchema,
    action: ruleActionSchema,
    active: z.boolean().default(true),
  })
  .strict()
export type SaveImportRuleInput = z.input<typeof saveImportRuleSchema>

export const deleteImportRuleSchema = z.object({ ruleId: uuidField() }).strict()

/** Lo que puede hacer una regla del banco (`action.kind`, ver `proposals/bank.ts`). */
export const BANK_RULE_KINDS = [
  'expense_component',
  'transfer',
  'payment',
  'collection',
  'movement',
  'ignore',
  'review',
] as const

/** Componentes de una regla de impuestos de Mercado Pago (`action.component`). */
export const MP_TAX_COMPONENTS = ['ret_iibb', 'sircupa', 'ley25413', 'otro'] as const

export const markOnboardingStepSchema = z
  .object({
    step: z.string().regex(/^[a-z0-9_]{2,40}$/, 'Recargá la página y probá de nuevo.'),
    done: z.boolean(),
  })
  .strict()

export const saveImportLayoutSchema = z
  .object({
    signature: z.string().regex(/^[0-9a-f]{64}$/, UUID_MESSAGE),
    mapping: z
      .record(
        z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
        z.union([z.number().int().min(0).max(10_000), z.string().max(40), z.null()]),
      )
      .refine((m) => Object.keys(m).length <= 30, 'Demasiadas columnas.'),
    treasuryAccountId: uuidField().nullable().default(null),
  })
  .strict()
export type SaveImportLayoutInput = z.input<typeof saveImportLayoutSchema>

export const saveMpSettingsSchema = z
  .object({
    expectedUpdatedAt: z.string().max(64).nullable().default(null),
    treasuryAccountId: uuidField('Elegí la billetera.').optional(),
    partyId: uuidField().optional(),
    channelMethods: z.partialRecord(z.enum(MP_COBRO_CHANNELS), uuidField().nullable()).optional(),
    dayCutoffHour: z.number().int().min(0).max(8).optional(),
  })
  .strict()
export type SaveMpSettingsInput = z.input<typeof saveMpSettingsSchema>

// ─── Resultados de las acciones ──────────────────────────────────────────────

export type CreateImportBatchResult = {
  batchId: string
  status: ImportBatchStatus
  createdAt: string | null
}

export type AddImportItemsResult = {
  /** Filas nuevas (vivas). */
  inserted: number
  /** Filas que ya estaban vivas en otra importación (quedan `duplicate`). */
  duplicates: number
  /** Reenvíos de la misma fila (ya estaban en este lote). */
  skipped: number
  /** Avisos que se sacaron para que entren en la base (repetidos o los menos graves). */
  issuesTrimmed: number
  counts: ImportBatchCounts | null
}

export type BuildProposalsResult = {
  /** Propuestas del lote por estado después de armar. */
  byStatus: Record<ProposalStatus, number>
  /** Propuestas escritas (nuevas o con cambios) y las que quedaron igual. */
  written: number
  unchanged: number
  /** Reglas del bar que no se pudieron evaluar en el servidor (patrón fuera del subconjunto seguro). */
  rulesSkipped: number
  counts: ImportBatchCounts | null
}

export type PostItemOutcome =
  | 'posted'
  | 'replayed'
  | 'already_posted'
  | 'stale'
  | 'needs_input'
  | 'error'
  | 'skipped'
  | 'not_found'

export type PostItemResult = {
  key: string
  outcome: PostItemOutcome
  documentId?: string
  message?: string
  /** `stale`: el hash nuevo (reenviá con este para cargar lo que se ve ahora). */
  hash?: string
  needs?: ImportNeed[]
}

export type PostImportResult = {
  results: PostItemResult[]
  posted: number
  counts: ImportBatchCounts | null
  batchStatus: ImportBatchStatus | null
}

export type CreateImportSuppliersResult = {
  created: Array<{ cuit: string; partyId: string; name: string }>
  failed: Array<{ cuit: string; message: string }>
  build: BuildProposalsResult | null
}

export type SavedImportRule = {
  id: string
  source: string
  priority: number
  label: string
  match: Record<string, unknown>
  action: Record<string, unknown>
  active: boolean
  updatedAt: string | null
}

export type SavedMpSettings = {
  id: string
  treasuryAccountId: string
  partyId: string
  status: string
  channelMethods: Partial<Record<MpCobroChannel, string>>
  dayCutoffHour: number
  updatedAt: string | null
}
