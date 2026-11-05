import { monthName } from '@/lib/dates'
import type { SystemAccountKey } from './system-keys'
import type { Side, TreasuryKind } from './types'

/**
 * Los modelos del asiento manual: los asientos que se repiten, ya con sus cuentas (reunión del
 * 29/10: «préstamo bancario: banco a deudas bancarias; y cuando pagás la cuota, deuda bancaria y
 * intereses perdidos, a caja»). Puro. Las cuentas se buscan por `system_key`, nunca por código ni por
 * nombre (los dos se pueden editar); la caja la elige quien carga, se propone la que suele ser.
 *
 * Un modelo no trae importes: los pone quien tiene el papel adelante. Las líneas salen en el orden en
 * que se escribe un asiento, primero el Debe.
 */

export type EntryModelKey = 'prestamo' | 'cuota' | 'aporte' | 'retiro' | 'amortizacion' | 'sueldos'

export type EntryModelAccount =
  | { kind: 'system'; key: SystemAccountKey }
  /** «Una caja»: se propone la primera activa de ese tipo. */
  | { kind: 'treasury'; prefer: TreasuryKind }

export type EntryModelLine = { side: Side; account: EntryModelAccount }

export type EntryModel = {
  key: EntryModelKey
  name: string
  /** El tipo de asiento con que se guarda. */
  entryKind: 'manual' | 'adjustment' | 'payroll'
  /** Sin líneas: es la otra cara del formulario (los sueldos, en tres pasos). */
  lines: readonly EntryModelLine[]
  /** Una aclaración que va a la vista mientras está elegido. */
  note: string | null
}

const BANK: EntryModelAccount = { kind: 'treasury', prefer: 'bank' }
const CASH: EntryModelAccount = { kind: 'treasury', prefer: 'cash' }
const system = (key: SystemAccountKey): EntryModelAccount => ({ kind: 'system', key })

export const ENTRY_MODELS: readonly EntryModel[] = [
  {
    key: 'prestamo',
    name: 'Préstamo recibido',
    entryKind: 'manual',
    lines: [
      { side: 'debit', account: BANK },
      { side: 'credit', account: system('bank_loans') },
    ],
    note: null,
  },
  {
    key: 'cuota',
    name: 'Cuota de préstamo con intereses',
    entryKind: 'manual',
    lines: [
      { side: 'debit', account: system('bank_loans') },
      { side: 'debit', account: system('interest_expense') },
      { side: 'credit', account: BANK },
    ],
    note: null,
  },
  {
    key: 'aporte',
    name: 'Aporte de socios',
    entryKind: 'manual',
    lines: [
      { side: 'debit', account: CASH },
      { side: 'credit', account: system('partners_current') },
    ],
    note: null,
  },
  {
    key: 'retiro',
    name: 'Retiro de socios',
    entryKind: 'manual',
    lines: [
      { side: 'debit', account: system('partners_current') },
      { side: 'credit', account: CASH },
    ],
    note: null,
  },
  {
    key: 'amortizacion',
    name: 'Amortización del mes',
    entryKind: 'adjustment',
    lines: [
      { side: 'debit', account: system('depreciation') },
      { side: 'credit', account: system('accumulated_depreciation') },
    ],
    note: null,
  },
  {
    key: 'sueldos',
    name: 'Sueldos del mes',
    entryKind: 'payroll',
    lines: [],
    note: 'Si ya devengaste en Sueldos, cargá solo las cargas sociales.',
  },
]

export function entryModel(key: string | null | undefined): EntryModel | null {
  return ENTRY_MODELS.find((m) => m.key === key) ?? null
}

/** El concepto que se propone al elegir el modelo; sigue a la fecha del asiento. */
export function entryModelConcept(model: EntryModel, date: string | null): string {
  switch (model.key) {
    case 'prestamo':
      return 'Préstamo bancario'
    case 'cuota':
      return 'Cuota de préstamo'
    case 'aporte':
      return 'Aporte de socio'
    case 'retiro':
      return 'Retiro de socio'
    case 'amortizacion': {
      const month = date ? monthName(Number(date.slice(5, 7))) : ''
      return month ? `Amortización de ${month}` : 'Amortización del mes'
    }
    case 'sueldos':
      return ''
  }
}

export type ModelAccountRef = {
  id: string
  systemKey: string | null
  postable: boolean
  active: boolean
}

export type ModelTreasuryRef = { accountId: string; kind: TreasuryKind; active: boolean }

export type EntryModelFilledLine = {
  accountId: string | null
  side: Side
  /** La cuenta no se encontró (la desactivaron o el plan no la tiene): la elige quien carga. */
  missing: boolean
}

/** La tarjeta de la empresa no es una caja: de ahí no entra un préstamo ni sale un retiro. */
function treasuryFor(prefer: TreasuryKind, treasuries: readonly ModelTreasuryRef[]): string | null {
  const usable = treasuries.filter((t) => t.active && t.kind !== 'credit_card')
  return (usable.find((t) => t.kind === prefer) ?? usable[0])?.accountId ?? null
}

/** Las líneas del modelo con las cuentas de este bar. */
export function entryModelLines(
  model: EntryModel,
  catalog: {
    accounts: readonly ModelAccountRef[]
    treasuries: readonly ModelTreasuryRef[]
  },
): EntryModelFilledLine[] {
  return model.lines.map((line) => {
    const account = line.account
    const accountId =
      account.kind === 'treasury'
        ? treasuryFor(account.prefer, catalog.treasuries)
        : (catalog.accounts.find((a) => a.systemKey === account.key && a.postable && a.active)
            ?.id ?? null)
    return { accountId, side: line.side, missing: accountId === null }
  })
}
