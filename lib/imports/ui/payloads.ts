/**
 * Lo que cada pantalla de «Importar» le manda al servidor, armado en un solo
 * lugar. Son los mismos objetos que antes se armaban adentro de cada componente
 * (`import-uploader`, `new-suppliers`, `need-block`, `mp-settings-card`,
 * `bank-rules-card`), movidos tal cual: mismas claves, mismos valores y mismos
 * valores por defecto.
 *
 * Por qué existe: el rediseño cambió la forma de esas pantallas de punta a
 * punta. Con los armadores acá, `tests/lib/imports-ui-payloads.test.ts` compara
 * cada uno contra el objeto que armaba el código anterior y contra el esquema
 * del servidor (que es estricto: una clave de más falla).
 *
 * Puro: sin React y sin acciones (las llama cada componente).
 */

import type { IvaCondition, PartyKind } from '@/lib/accounting/types'
import type {
  CreateImportBatchInput,
  CreateImportSuppliersInput,
  ImportChangeInput,
  MpCobroChannel,
  OtherTaxesAs,
  SaveImportRuleInput,
  SaveMpSettingsInput,
} from '@/lib/imports/server/types'
import type { BankRuleKind } from './labels'
import type { UploadPlan } from './upload'

// ─── Subir un archivo ────────────────────────────────────────────────────────

/** El lote que crea la subida. `figures` y los textos del plan no viajan: solo esto. */
export function batchInput(
  plan: Pick<
    UploadPlan,
    'source' | 'fileName' | 'fileSize' | 'detectedFormat' | 'periodFrom' | 'periodTo' | 'meta'
  >,
  sha: string,
  ctx: { source: UploadPlan['source']; treasuryAccountId?: string | null },
): CreateImportBatchInput {
  return {
    source: plan.source,
    fileName: plan.fileName,
    fileSha256: sha,
    fileSize: plan.fileSize,
    detectedFormat: plan.detectedFormat,
    periodFrom: plan.periodFrom,
    periodTo: plan.periodTo,
    treasuryAccountId: ctx.source === 'bank_statement' ? (ctx.treasuryAccountId ?? null) : null,
    meta: plan.meta,
  }
}

// ─── Proveedores de un archivo de ARCA ───────────────────────────────────────

/** Lo que la persona dejó elegido para un proveedor nuevo. */
export type SupplierDraft = {
  name: string
  condition: IvaCondition
  accountId: string | null
  /** El plazo como texto del campo («30», «»). */
  term: string
}

/** Los proveedores que se crean (`createImportSuppliers`), en el orden de `rows`. */
export function supplierRows(
  rows: ReadonlyArray<{ cuit: string }>,
  state: Readonly<Record<string, SupplierDraft | undefined>>,
): CreateImportSuppliersInput['suppliers'] {
  return rows.map((r) => {
    const row = state[r.cuit] as SupplierDraft
    const term = Number.parseInt(row.term, 10)
    return {
      cuit: r.cuit,
      name: row.name.trim(),
      ivaCondition: row.condition,
      accountId: row.accountId as string,
      paymentTermDays: Number.isFinite(term) && term >= 0 && term <= 365 ? term : 0,
    }
  })
}

/** Un proveedor que ya estaba cargado, con lo que `saveParty` pide para editarlo. */
export type KnownParty = {
  id: string
  kind: PartyKind
  name: string
  updatedAt: string
}

/**
 * «Sí: es {proveedor}»: guardarle el CUIT a un proveedor que ya estaba cargado.
 * Es el envío de la ficha del proveedor (`saveParty` guarda solo los campos
 * presentes; `kind` y `name` los pide el esquema).
 */
export function supplierCuitInput(party: KnownParty, cuit: string) {
  return {
    id: party.id,
    expectedUpdatedAt: party.updatedAt,
    kind: party.kind,
    name: party.name,
    taxIdType: 'cuit' as const,
    taxId: cuit,
  }
}

// ─── «Otros impuestos» de una factura ────────────────────────────────────────

/** El cambio `other_taxes_as`: para esta factura sola o para todas las del proveedor. */
export function otherTaxesChange(input: {
  proposalKey: string
  partyId: string | null
  as: OtherTaxesAs
  accountId: string | null
  jurisdiction: number
  remember: boolean
}): Extract<ImportChangeInput, { kind: 'other_taxes_as' }> {
  const rememberIt = input.remember && input.partyId !== null
  return {
    kind: 'other_taxes_as',
    proposalKey: rememberIt ? null : input.proposalKey,
    partyId: rememberIt ? input.partyId : null,
    as: input.as,
    accountId: input.as === 'account' ? input.accountId : null,
    jurisdictionCode: input.as === 'perc_iibb' ? input.jurisdiction : null,
    remember: rememberIt,
  }
}

// ─── «Antes de empezar» de Mercado Pago ──────────────────────────────────────

/** El orden en que se preguntan (y se mandan) los cuatro canales de cobro. */
export const MP_SETTINGS_CHANNELS: readonly MpCobroChannel[] = [
  'qr',
  'point',
  'transfer_in',
  'link',
]

export function mpSettingsInput(input: {
  updatedAt: string | null
  wallet: string
  methods: Readonly<Partial<Record<MpCobroChannel, string | null>>>
  cutoff: number
}): SaveMpSettingsInput {
  return {
    expectedUpdatedAt: input.updatedAt,
    treasuryAccountId: input.wallet,
    channelMethods: Object.fromEntries(
      MP_SETTINGS_CHANNELS.map((c) => [c, input.methods[c] ?? null]),
    ),
    dayCutoffHour: input.cutoff,
  }
}

// ─── Lo que el bar le enseña al banco ────────────────────────────────────────

export type RuleDraft = {
  label: string
  pattern: string
  /** El CUIT como se tipeó (con o sin guiones). */
  cuit: string
  direction: 'any' | 'credit' | 'debit'
  kind: BankRuleKind
  component: string
  accountId: string | null
  partyId: string | null
  treasuryId: string | null
  active: boolean
}

/** La regla que se guarda (`saveImportRule`); `rule` es la que se edita, si hay. */
export function ruleInput(
  rule: { id: string; priority: number; updatedAt: string | null } | null,
  draft: RuleDraft,
): SaveImportRuleInput {
  const trimmedPattern = draft.pattern.trim()
  const cuitDigits = draft.cuit.replace(/\D/g, '')
  const match: { pattern?: string; counterparty_cuit?: string; direction?: 'credit' | 'debit' } = {}
  if (trimmedPattern !== '') match.pattern = trimmedPattern
  if (cuitDigits !== '') match.counterparty_cuit = cuitDigits
  if (draft.direction !== 'any') match.direction = draft.direction
  const action: {
    kind: string
    component?: string
    treasury_account_id?: string
    party_id?: string
    account_id?: string
  } = { kind: draft.kind }
  if (draft.kind === 'expense_component') action.component = draft.component
  if (draft.kind === 'transfer' && draft.treasuryId) action.treasury_account_id = draft.treasuryId
  if ((draft.kind === 'payment' || draft.kind === 'collection') && draft.partyId) {
    action.party_id = draft.partyId
  }
  if (draft.kind === 'movement' && draft.accountId) action.account_id = draft.accountId
  return {
    id: rule?.id ?? null,
    expectedUpdatedAt: rule?.updatedAt ?? null,
    source: 'bank_statement',
    priority: rule?.priority ?? 100,
    label: draft.label.trim(),
    match,
    action,
    active: draft.active,
  }
}
