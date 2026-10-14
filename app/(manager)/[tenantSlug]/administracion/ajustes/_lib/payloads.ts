/**
 * Lo que cada formulario de Ajustes le manda a su acción, en funciones puras.
 *
 * Antes cada panel armaba su envío en línea, dentro del `save`. El rediseño de
 * octubre 2026 cambió cómo se ven esos formularios (tarjetas de elección en vez
 * de desplegables, la comisión como píldora de cada medio, «Cambiar el orden»)
 * y sacó los diálogos a archivos propios para poder abrirlos desde otros lados.
 * Lo que NO puede cambiar es lo que viaja: mismas claves, mismos valores y los
 * mismos valores por defecto si la persona no toca nada. Por eso el armado vive
 * acá, sin React, y `administracion-ajustes-payloads.test.ts` lo fija con un
 * dorado por caso, escrito contra el código de antes del rediseño.
 */

import type { SalesMethodRow, SalesPointRow } from '@/lib/accounting/queries/settings'
import type { TreasuryAccountRow } from '@/lib/accounting/queries/treasury'
import type {
  Channel,
  CommissionVatMode,
  PartyKind,
  PartyRates,
  SalesMethodKind,
  TreasuryKind,
} from '@/lib/accounting/types'
import { CUIT_MESSAGES, formatCuit, normalizeCuit, parseCuit } from '@/lib/fiscal'
import { bpToPercentInput, parsePercentToBp } from './percent'

// ─── Cajas y cuentas ─────────────────────────────────────────────────────────

export type TreasuryDraft = {
  id: string | null
  updatedAt: string | null
  name: string
  kind: TreasuryKind
  bankName: string
  accountNumber: string
  cbuCvu: string
  alias: string
  allowNegative: boolean
  createBankParty: boolean
}

/** El borrador de una edición, o el de un alta: banco, con «sumarlo como proveedor» prendido. */
export function treasuryDraftOf(t: TreasuryAccountRow | null): TreasuryDraft {
  return t
    ? {
        id: t.id,
        updatedAt: t.updatedAt,
        name: t.name,
        kind: t.kind,
        bankName: t.bankName ?? '',
        accountNumber: t.accountNumber ?? '',
        cbuCvu: t.cbuCvu ?? '',
        alias: t.alias ?? '',
        allowNegative: t.allowNegative,
        createBankParty: false,
      }
    : {
        id: null,
        updatedAt: null,
        name: '',
        kind: 'bank',
        bankName: '',
        accountNumber: '',
        cbuCvu: '',
        alias: '',
        allowNegative: false,
        createBankParty: true,
      }
}

/**
 * Alta o edición de una caja. Los datos que no son de su tipo viajan en `null`
 * (el banco de una caja de efectivo, el CBU de una tarjeta); en el alta va
 * además `createBankParty`, y en la edición `id` + `expectedUpdatedAt`.
 */
export function treasurySavePayload(d: TreasuryDraft): Record<string, unknown> {
  const bankish = d.kind === 'bank' || d.kind === 'credit_card'
  const transfers = d.kind === 'bank' || d.kind === 'wallet'
  const base = {
    name: d.name,
    kind: d.kind,
    bankName: bankish ? d.bankName.trim() || null : null,
    accountNumber: d.kind === 'bank' ? d.accountNumber.trim() || null : null,
    cbuCvu: transfers ? d.cbuCvu.trim() || null : null,
    alias: transfers ? d.alias.trim() || null : null,
    allowNegative: d.kind === 'cash' ? false : d.allowNegative,
  }
  return d.id
    ? { id: d.id, expectedUpdatedAt: d.updatedAt, ...base }
    : { ...base, createBankParty: d.kind === 'bank' && d.createBankParty }
}

/** El interruptor «En uso»: solo cambia `active` (la base decide si puede apagarse). */
export function treasuryTogglePayload(
  t: Pick<TreasuryAccountRow, 'id' | 'updatedAt' | 'name' | 'kind'>,
  active: boolean,
): Record<string, unknown> {
  return { id: t.id, expectedUpdatedAt: t.updatedAt, name: t.name, kind: t.kind, active }
}

// ─── Medios de cobro ─────────────────────────────────────────────────────────

export type MethodDraft = {
  id: string | null
  updatedAt: string | null
  name: string
  kind: SalesMethodKind
  channel: Channel
  treasuryId: string | null
  partyId: string | null
  days: string
  active: boolean
}

export function methodDraftOf(m: SalesMethodRow | null): MethodDraft {
  return m
    ? {
        id: m.id,
        updatedAt: m.updatedAt,
        name: m.name,
        kind: m.kind,
        channel: m.channel,
        treasuryId: m.treasuryAccountId,
        partyId: m.partyId,
        days: String(m.settlementDays),
        active: m.active,
      }
    : {
        id: null,
        updatedAt: null,
        name: '',
        kind: 'treasury',
        channel: 'salon',
        treasuryId: null,
        partyId: null,
        days: '0',
        active: true,
      }
}

/** Los tipos de medio que necesitan una caja adonde entra lo cobrado. */
export const methodNeedsTreasury = (k: SalesMethodKind) => k === 'treasury' || k === 'settled_now'
/** Los que necesitan a alguien que paga después (o la cuenta de señas). */
export const methodNeedsParty = (k: SalesMethodKind) =>
  k === 'settled_now' || k === 'receivable' || k === 'advance'

/** Lo mínimo de un partícipe para saber si puede pagar un tipo de medio. */
export type MethodPartyLike = { kind: PartyKind; systemKey: string | null }

/** Quién puede pagar cada tipo de medio (la base lo vuelve a validar). */
export function methodPartyFits(kind: SalesMethodKind, p: MethodPartyLike): boolean {
  if (kind === 'settled_now') return p.kind === 'payment_wallet'
  if (kind === 'receivable') {
    return (
      p.kind === 'card_processor' || p.kind === 'payment_wallet' || p.kind === 'delivery_platform'
    )
  }
  if (kind === 'advance') return p.systemKey === 'senas'
  return false
}

/**
 * Alta o edición de un medio. La caja y quién paga viajan solo si el tipo los
 * usa; los días, solo si «te lo pagan después» (si no, «0»).
 */
export function methodSavePayload(d: MethodDraft): Record<string, unknown> {
  const days = d.kind === 'receivable' ? d.days : '0'
  return {
    ...(d.id ? { id: d.id, expectedUpdatedAt: d.updatedAt } : {}),
    name: d.name,
    kind: d.kind,
    channel: d.channel,
    treasuryAccountId: methodNeedsTreasury(d.kind) ? d.treasuryId : null,
    partyId: methodNeedsParty(d.kind) ? d.partyId : null,
    settlementDays: days,
    active: d.active,
  }
}

/** El medio tal cual está guardado, con un cambio encima: prender o apagar, o su lugar en el orden. */
export function methodRowPayload(
  m: SalesMethodRow,
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: m.id,
    expectedUpdatedAt: m.updatedAt,
    name: m.name,
    kind: m.kind,
    channel: m.channel,
    treasuryAccountId: m.treasuryAccountId,
    partyId: m.partyId,
    settlementDays: m.settlementDays,
    active: m.active,
    sort: m.sort,
    ...patch,
  }
}

// ─── Tarjetas, apps, bancos y organismos (partícipes del sistema) ────────────

export type SystemPartyRow = {
  id: string
  name: string
  kind: PartyKind
  systemKey: string | null
  taxId: string | null
  active: boolean
  commissionVatMode: CommissionVatMode
  rates: PartyRates
  updatedAt: string | null
}

export type RateKey = keyof PartyRates

/** Los que cobran por el bar y descuentan comisiones y retenciones. */
export const CHARGING_PARTY_KINDS: ReadonlySet<PartyKind> = new Set([
  'card_processor',
  'payment_wallet',
  'delivery_platform',
  'bank',
])

/** Las tasas que se le pueden cargar a cada uno; `only` = solo ese tipo la tiene. */
export const PARTY_RATE_FIELDS: ReadonlyArray<{ key: RateKey; only?: PartyKind }> = [
  { key: 'commissionBp' },
  { key: 'iibbWithholdingBp' },
  { key: 'vatWithholdingBp' },
  { key: 'incomeTaxWithholdingBp' },
  { key: 'sircupaBp', only: 'payment_wallet' },
]

/** Las tasas que tiene a la vista un partícipe de ese tipo. */
export function partyRateKeys(kind: PartyKind): RateKey[] {
  if (!CHARGING_PARTY_KINDS.has(kind)) return []
  return PARTY_RATE_FIELDS.filter((f) => !f.only || f.only === kind).map((f) => f.key)
}

export type PartyDraft = {
  party: SystemPartyRow
  cuit: string
  rates: Record<RateKey, string>
  vatMode: CommissionVatMode
  active: boolean
}

export function partyDraftOf(p: SystemPartyRow): PartyDraft {
  return {
    party: p,
    cuit: p.taxId ? formatCuit(p.taxId) : '',
    rates: {
      commissionBp: bpToPercentInput(p.rates.commissionBp),
      iibbWithholdingBp: bpToPercentInput(p.rates.iibbWithholdingBp),
      vatWithholdingBp: bpToPercentInput(p.rates.vatWithholdingBp),
      incomeTaxWithholdingBp: bpToPercentInput(p.rates.incomeTaxWithholdingBp),
      sircupaBp: bpToPercentInput(p.rates.sircupaBp),
    },
    vatMode: p.commissionVatMode,
    active: p.active,
  }
}

/** El mensaje de una CUIT que no se lee (vacía = sin error: es opcional). */
function cuitProblem(text: string): string | null {
  if (text.trim() === '') return null
  const parsed = parseCuit(text)
  if (parsed.ok) return null
  const message = CUIT_MESSAGES[parsed.reason]
  return message.endsWith('.') ? message : `${message}.`
}

/** Las tasas del borrador, leídas: lo que se entiende y, por campo, lo que no. */
export function partyDraftRates(d: PartyDraft): {
  rates: Partial<Record<RateKey, number | null>>
  errors: Partial<Record<RateKey, string>>
} {
  const rates: Partial<Record<RateKey, number | null>> = {}
  const errors: Partial<Record<RateKey, string>> = {}
  for (const key of partyRateKeys(d.party.kind)) {
    const parsed = parsePercentToBp(d.rates[key])
    if (parsed.ok) rates[key] = parsed.bp
    else errors[key] = parsed.message
  }
  return { rates, errors }
}

export type PartySave =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> }

/**
 * El guardado de un partícipe del sistema. Si la CUIT o un porcentaje no se
 * leen, no viaja nada y cada error va a su campo. Las tasas y «cómo factura la
 * comisión» viajan solo en los que cobran; `active`, solo en las apps de
 * delivery (es su «Trabajamos con esta app»).
 */
export function partySavePayload(d: PartyDraft): PartySave {
  const p = d.party
  const errors: Record<string, string> = {}
  const issue = cuitProblem(d.cuit)
  if (issue) errors.taxId = issue
  const charges = CHARGING_PARTY_KINDS.has(p.kind)
  const read = partyDraftRates(d)
  for (const [key, message] of Object.entries(read.errors)) if (message) errors[key] = message
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  const taxId = d.cuit.trim() ? normalizeCuit(d.cuit) : null
  return {
    ok: true,
    payload: {
      id: p.id,
      expectedUpdatedAt: p.updatedAt,
      kind: p.kind,
      name: p.name,
      taxIdType: taxId ? 'cuit' : 'none',
      taxId,
      ...(charges ? { ...read.rates, commissionVatMode: d.vatMode } : {}),
      ...(p.kind === 'delivery_platform' ? { active: d.active } : {}),
    },
  }
}

// ─── Puntos de venta ─────────────────────────────────────────────────────────

export type SalesPointDraft = {
  id: string | null
  updatedAt: string | null
  number: string
  label: string
  channel: Channel
}

export function salesPointDraftOf(p: SalesPointRow | null): SalesPointDraft {
  return p
    ? {
        id: p.id,
        updatedAt: p.updatedAt,
        number: String(p.number),
        label: p.label,
        channel: p.defaultChannel,
      }
    : { id: null, updatedAt: null, number: '', label: '', channel: 'salon' }
}

/** Alta o edición. Sin nombre, se llama «Punto de venta N». */
export function salesPointSavePayload(d: SalesPointDraft): Record<string, unknown> {
  const label = d.label.trim() || (d.number ? `Punto de venta ${Number(d.number)}` : '')
  return {
    ...(d.id ? { id: d.id, expectedUpdatedAt: d.updatedAt } : {}),
    number: d.number,
    label,
    defaultChannel: d.channel,
  }
}

/** El interruptor del talonario: lo mismo que está guardado, con `active`. */
export function salesPointTogglePayload(
  p: SalesPointRow,
  active: boolean,
): Record<string, unknown> {
  return {
    id: p.id,
    expectedUpdatedAt: p.updatedAt,
    number: p.number,
    label: p.label,
    defaultChannel: p.defaultChannel,
    active,
  }
}
