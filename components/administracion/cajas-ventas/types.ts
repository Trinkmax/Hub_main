/**
 * Lo que traen las hojas y formularios de Ventas y Cajas (`./data.ts`): el
 * contexto del motor armado DESDE LA BASE (para la vista previa en el
 * navegador, el mismo código que corre la acción) y las listas para los
 * combos. La plata, siempre en centavos.
 */

import type { AccFailureCode } from '@/lib/accounting/action-state'
import type {
  AccountType,
  Channel,
  CommissionVatMode,
  IvaCondition,
  OpenItemRef,
  PartyKind,
  PartyRates,
  PostingContext,
  SalesMethodKind,
  TreasuryKind,
} from '@/lib/accounting/types'

/** Resultado de una lectura de hoja: los datos o el mensaje listo para mostrar. */
export type SheetLoad<T> =
  | { ok: true; data: T }
  | { ok: false; code: AccFailureCode; message: string }

export type SheetTreasury = {
  id: string
  /** La cuenta contable de la caja. */
  accountId: string
  name: string
  kind: TreasuryKind
  /**
   * Saldo de libro en el sentido normal de su cuenta: plata disponible en
   * cajas, bancos y billeteras; la DEUDA en la tarjeta de la empresa.
   */
  balanceCents: number
  /** La billetera o el banco como partícipe (Mercado Pago, Banco Nación). */
  bankPartyId: string | null
  allowNegative: boolean
  alias: string | null
  bankName: string | null
  lastCheckedOn: string | null
  active: boolean
}

export type SheetAccount = {
  id: string
  code: string
  name: string
  type: AccountType
  postable: boolean
  active: boolean
  requiresParty: boolean
  isTreasury: boolean
  systemKey: string | null
  description: string | null
}

export type SheetParty = {
  id: string
  kind: PartyKind
  name: string
  tradeName: string | null
  taxId: string | null
  ivaCondition: IvaCondition
  paymentTermDays: number
  commissionVatMode: CommissionVatMode
  rates: PartyRates
  receivableAccountId: string
  active: boolean
  systemKey: string | null
}

export type SheetMethod = {
  id: string
  name: string
  kind: SalesMethodKind
  channel: Channel
  treasuryAccountId: string | null
  partyId: string | null
  settlementDays: number
  active: boolean
  systemKey: string | null
}

/** El catálogo del bar para las hojas de Ventas y Cajas. */
export type CajasVentasCatalog = {
  /** El contexto del motor (sin partidas: cada hoja suma las que elige). */
  ctx: PostingContext
  /** Primer día del primer mes abierto (`null` si no hay meses cerrados). */
  firstOpenDate: string | null
  /** Hoy en el bar (`acc_today`). */
  today: string
  /** Desde cuándo lleva las cuentas el bar: antes no se carga nada. */
  booksStartDate: string
  /** Las cajas activas, en el orden de Ajustes. */
  treasuries: SheetTreasury[]
  /** El plan entero (rubros e imputables): los combos arman la ruta con los códigos. */
  accounts: SheetAccount[]
  /** Todos los proveedores, clientes y partícipes del sistema (activos e inactivos). */
  parties: SheetParty[]
  methods: SheetMethod[]
}

/** Lo que te debe cada cliente, tarjeta, billetera o plataforma (para «¿Quién te pagó?»). */
export type ReceivableSummary = {
  partyId: string
  /** Ventas sin cobrar (abierto del lado deuda). */
  debtCents: number
  /** A favor del cliente o «le debemos» (abierto del lado contrario). */
  creditCents: number
  overdueCents: number
  oldestDueDate: string | null
}

/** «Ajustar saldo»: lo que dice el sistema de una caja a una fecha. */
export type TreasuryCheckData = {
  /** Saldo de libro Debe − Haber (en la tarjeta de la empresa, la deuda es negativa). */
  bookCents: number
  lastAdjustmentDate: string | null
  /**
   * Billeteras: lo que falta acreditar (QR y transferencias), como partidas
   * del motor (van al contexto de la vista previa) con el nombre del medio.
   */
  walletItems: Array<OpenItemRef & { methodName: string }>
  /** Descuentos estimados con las tasas de la billetera. */
  estimates: { commissionCents: number; commissionVatCents: number; sircupaCents: number } | null
}
