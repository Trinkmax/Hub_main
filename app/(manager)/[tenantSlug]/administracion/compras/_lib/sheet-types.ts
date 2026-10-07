/**
 * Lo que devuelven las lecturas de las hojas «Nuevo gasto» y «Pagar» y de la
 * factura de proveedor (`sheet-actions.ts`). Viven aparte porque un archivo
 * `'use server'` solo exporta funciones async.
 */

import type { PartyBalanceRow } from '@/lib/accounting/queries/parties'
import type {
  AccountType,
  CommissionVatMode,
  IvaCondition,
  OpenItemRef,
  PartyKind,
  PostingContext,
  TreasuryKind,
} from '@/lib/accounting/types'

export type SheetResult<T> = { ok: true; data: T } | { ok: false; message: string }

export type SheetTreasury = {
  id: string
  name: string
  kind: TreasuryKind
  /** Saldo de libro en el sentido normal de su cuenta (en una tarjeta de la empresa, la deuda). */
  balanceCents: number
  active: boolean
  allowNegative: boolean
}

export type SheetParty = {
  id: string
  name: string
  tradeName: string | null
  kind: PartyKind
  taxIdType: 'cuit' | 'cuil' | 'dni' | 'none'
  taxId: string | null
  ivaCondition: IvaCondition
  paymentTermDays: number
  active: boolean
  systemKey: string | null
  defaultAccountId: string | null
  defaultVoucherType: string | null
  commissionVatMode: CommissionVatMode
  /** Para editar el CUIT en línea (`saveParty`, concurrencia optimista). */
  updatedAt: string | null
}

export type SheetAccount = {
  id: string
  code: string
  name: string
  type: AccountType
  postable: boolean
  active: boolean
  purchaseSelectable: boolean
  requiresParty: boolean
  isTreasury: boolean
  systemKey: string | null
  description: string | null
}

export type QuickSuggestion = {
  type: 'party' | 'account'
  partyId: string | null
  accountId: string
  label: string
  /** La caja con que se pagó la última vez (para proponerla). */
  treasuryAccountId: string | null
  /** El comprobante de la última vez. */
  voucherType: string | null
}

/** Lo que trae la hoja al abrirse: el contexto del motor (DESDE LA BASE) y las listas. */
export type SheetData = {
  ctx: PostingContext
  /** Primer día abierto si hay meses cerrados (la fecha contable se corre ahí). */
  firstOpenDate: string | null
  /** Desde cuándo lleva las cuentas el bar: antes no se carga nada. */
  booksStartDate: string
  /** Hoy en el bar (`acc_today`). */
  today: string
  /** Las cajas en el orden de Ajustes (activas e inactivas: el combo muestra las activas). */
  treasuries: SheetTreasury[]
  parties: SheetParty[]
  accounts: SheetAccount[]
  /** Chips de «¿En qué?» (vacío si todavía no hay historia). */
  suggestions: QuickSuggestion[]
  /** Saldos de proveedores para ordenar «Pagar» (`null` si no se pudieron leer). */
  balances: PartyBalanceRow[] | null
  /** Jurisdicción de IIBB de la SAS (la de las percepciones por defecto). */
  iibbJurisdictionCode: number
}

/** Lo que el sistema recuerda de un proveedor (`acc_form_defaults`). */
export type SheetPartyDefaults = {
  accountId: string | null
  voucherType: string | null
  vatRateBp: number | null
  pointOfSale: number | null
  lastNumber: number | null
  treasuryAccountId: string | null
  paymentTermDays: number | null
  suggestedTermDays: number | null
  medianTotalCents: number | null
  cuitMissing: boolean
}

/** Las partidas abiertas de un proveedor (para «Pagar» y la NC). */
export type SheetPartyItems = {
  partyId: string
  items: OpenItemRef[]
}

export type SheetDuplicate = {
  documentId: string
  label: string
  accountingDate: string | null
  totalCents: number | null
  partyName: string | null
  match: 'number' | 'amount'
}
