import 'server-only'
import type { FiscalBook } from '@/lib/accounting/types'
import type { CsvCell } from '@/lib/csv/write'
import { csvMoney } from '@/lib/csv/write'
import { listAccounts } from './accounts'
import {
  getIvaAliquots,
  getIvaBook,
  getIvaPosition,
  getJournal,
  getLedger,
  getNetByMethod,
  getSalesSummary,
  getSubledger,
  getTrialBalance,
  type LedgerAccount,
  type SubledgerKind,
  subledgerCell,
} from './books'
import { SUBLEDGER_COLUMNS } from './columns'
import {
  ACCOUNTS_HEADERS,
  accountCsvRow,
  CASH_FLOW_HEADERS,
  type CsvRow,
  cashFlowCsvRow,
  GENERAL_LEDGER_HEADERS,
  generalLedgerCsvRow,
  generalLedgerTotalRow,
  HISTORY_HEADERS,
  historyCsvRow,
  IMPORT_HEADERS,
  IVA_ALIQUOTS_HEADERS,
  IVA_POSITION_HEADERS,
  IVA_PURCHASES_AMOUNT_COLUMNS,
  IVA_PURCHASES_HEADERS,
  IVA_SALES_AMOUNT_COLUMNS,
  IVA_SALES_HEADERS,
  importCsvRows,
  ivaAliquotCsvRow,
  ivaPositionCsvRows,
  ivaPurchasesCsvRow,
  ivaSalesCsvRow,
  ivaTotalsRow,
  JOURNAL_HEADERS,
  journalCsvRows,
  journalTotalsRow,
  LEDGER_HEADERS,
  ledgerCsvRow,
  ledgerTotalsRow,
  NET_BY_METHOD_HEADERS,
  netByMethodCsvRow,
  PARTY_BALANCES_HEADERS,
  partyBalanceCsvRow,
  partyBalancesTotalsRow,
  SALES_SUMMARY_HEADERS,
  salesSummaryCsvRow,
  statementCsvRow,
  statementHeaders,
  subledgerCsvCell,
  TREASURY_BALANCES_HEADERS,
  TRIAL_BALANCE_HEADERS,
  treasuryBalanceCsvRow,
  trialBalanceCsvRow,
  trialBalanceTotalsRow,
} from './csv'
import { listHistory } from './history'
import type { ExportBook } from './labels'
import { getParty, getPartyStatement, listPartyBalances } from './parties'
import { AccQueryError, callRpcRows, int, queryError, readerClient } from './shared'
import { getCashFlow, listTreasuryBalances } from './treasury'

/**
 * Exportes de Administración (§F.15): para cada libro, sus encabezados, un
 * conteo previo (para cortar con 413 ANTES de transmitir) y un generador que
 * pide las páginas de a 500 con el cursor y arma las filas, con la fila
 * `Totales` al final. El route handler lo transmite con `writeCsvStream`.
 * Pantalla = CSV: todo sale de las mismas lecturas que usan las pantallas.
 */

/** Tope de filas de un archivo (F.15 paso 4). */
export const EXPORT_MAX_ROWS = 200_000

const PAGE = 500
/** Red contra un cursor que no avanza (nunca debería pasar). */
const MAX_PAGES = 2000

export type ExportSpec = {
  libro: ExportBook
  /** Rango resuelto (en los libros mensuales, el mes entero). */
  from: string
  to: string
  /** Primer día del mes (libros mensuales). */
  month: string
  /** «Al día» de los saldos. */
  asOf: string
  accountId: string | null
  partyId: string | null
  treasuryId: string | null
  beforeFyResult: boolean
}

export type ExportPlan = {
  headers: readonly string[]
  /** Filas que va a tener el archivo (o una cota superior). */
  count: () => Promise<number>
  /** Filas de datos y, al final, `Totales`. */
  rows: () => AsyncGenerator<readonly CsvCell[]>
}

const TOO_LARGE = 'Es demasiado para un solo archivo. Elegí un período más corto.'

/** Recorre todas las páginas de una lectura keyset. */
async function* pages<P extends { nextCursor: string | null }>(
  fetchPage: (after: string | null) => Promise<P>,
): AsyncGenerator<P> {
  let after: string | null = null
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const page: P = await fetchPage(after)
    yield page
    if (!page.nextCursor || page.nextCursor === after) return
    after = page.nextCursor
  }
  throw new AccQueryError('export', 'invalid', TOO_LARGE, 'export_too_large')
}

/** Cota superior de líneas del diario en el rango (cuenta también las de asientos anulados). */
async function journalLineCount(tenantId: string, from: string, to: string): Promise<number> {
  const supabase = await readerClient()
  const { count, error } = await supabase
    .from('acc_journal_lines')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gte('entry_date', from)
    .lte('entry_date', to)
  if (error) throw queryError('acc_journal_lines', error)
  return count ?? 0
}

/** El `total_rows` de la primera página de una RPC keyset (conteo por índice en la base). */
async function firstTotal(name: string, params: Record<string, unknown>): Promise<number> {
  const raw = await callRpcRows(name, { ...params, p_after: null, p_limit: 1 })
  const first = raw[0]
  return first ? int(first.total_rows) : 0
}

const small = async (): Promise<number> => 0

// ─── Diario y asientos para importar ─────────────────────────────────────────

function journalPlan(tenantId: string, spec: ExportSpec, mode: 'journal' | 'import'): ExportPlan {
  return {
    headers: mode === 'journal' ? JOURNAL_HEADERS : IMPORT_HEADERS,
    count: () => journalLineCount(tenantId, spec.from, spec.to),
    rows: async function* () {
      // El CUIT de cada partícipe viene en las líneas del diario (`party_tax_id`).
      let debit = 0
      let credit = 0
      for await (const page of pages((after) =>
        getJournal(tenantId, { from: spec.from, to: spec.to, after, limit: 200 }),
      )) {
        for (const entry of page.rows) {
          for (const line of entry.lines) {
            debit += line.debitCents
            credit += line.creditCents
          }
          const rows = mode === 'journal' ? journalCsvRows(entry) : importCsvRows(entry)
          for (const row of rows) yield row
        }
      }
      if (mode === 'journal') yield journalTotalsRow(debit, credit)
    },
  }
}

// ─── Mayor de una cuenta y mayor general ─────────────────────────────────────

async function* ledgerRows(
  tenantId: string,
  spec: ExportSpec,
  accountId: string,
  partyId: string | null,
  onAccount: (account: LedgerAccount | null) => void,
) {
  for await (const page of pages((after) =>
    getLedger(tenantId, {
      accountId,
      partyId,
      from: spec.from,
      to: spec.to,
      after,
      limit: PAGE,
      totals: false,
    }),
  )) {
    onAccount(page.account)
    if (!page.account) return
    for (const row of page.rows) yield row
  }
}

function ledgerPlan(tenantId: string, spec: ExportSpec): ExportPlan {
  const accountId = spec.accountId ?? ''
  return {
    headers: LEDGER_HEADERS,
    count: () =>
      firstTotal('acc_report_ledger', {
        p_tenant_id: tenantId,
        p_account_id: accountId,
        p_party_id: spec.partyId,
        p_from: spec.from,
        p_to: spec.to,
      }),
    rows: async function* () {
      let debit = 0
      let credit = 0
      let closing: number | null = null
      let found = true
      for await (const row of ledgerRows(tenantId, spec, accountId, spec.partyId, (a) => {
        found = a !== null
      })) {
        if (row.rowKind === 'line') {
          debit += row.debitCents
          credit += row.creditCents
        }
        closing = row.runningBalanceCents
        yield ledgerCsvRow(row)
      }
      if (!found) throw new AccQueryError('export', 'invalid', 'Esa cuenta no existe en este bar.')
      yield ledgerTotalsRow(debit, credit, closing)
    },
  }
}

function generalLedgerPlan(tenantId: string, spec: ExportSpec): ExportPlan {
  return {
    headers: GENERAL_LEDGER_HEADERS,
    count: () => journalLineCount(tenantId, spec.from, spec.to),
    rows: async function* () {
      const trial = await getTrialBalance(tenantId, { from: spec.from, to: spec.to })
      const accounts = trial.rows.filter(
        (r) =>
          r.postable &&
          !r.isVirtual &&
          (r.periodDebitCents !== 0 ||
            r.periodCreditCents !== 0 ||
            r.openingDebitCents !== r.openingCreditCents),
      )
      for (const account of accounts) {
        let debit = 0
        let credit = 0
        let closing = account.openingDebitCents - account.openingCreditCents
        for await (const row of ledgerRows(tenantId, spec, account.accountId, null, () => {})) {
          if (row.rowKind === 'line') {
            debit += row.debitCents
            credit += row.creditCents
          }
          closing = row.runningBalanceCents
          yield generalLedgerCsvRow(account, row)
        }
        yield generalLedgerTotalRow(account, debit, credit, closing)
      }
    },
  }
}

// ─── Sumas y saldos ──────────────────────────────────────────────────────────

function trialPlan(tenantId: string, spec: ExportSpec): ExportPlan {
  return {
    headers: TRIAL_BALANCE_HEADERS,
    count: small,
    rows: async function* () {
      const trial = await getTrialBalance(tenantId, {
        from: spec.from,
        to: spec.to,
        excludeFyResult: spec.beforeFyResult,
      })
      for (const row of trial.rows) yield trialBalanceCsvRow(row)
      yield trialBalanceTotalsRow(trial.totals)
    },
  }
}

// ─── Libros IVA ──────────────────────────────────────────────────────────────

function ivaBookPlan(tenantId: string, spec: ExportSpec, book: FiscalBook): ExportPlan {
  const purchases = book === 'purchases'
  const columns = purchases ? IVA_PURCHASES_AMOUNT_COLUMNS : IVA_SALES_AMOUNT_COLUMNS
  return {
    headers: purchases ? IVA_PURCHASES_HEADERS : IVA_SALES_HEADERS,
    count: () =>
      firstTotal('acc_report_iva_book', {
        p_tenant_id: tenantId,
        p_book: book,
        p_month: spec.month,
      }),
    rows: async function* () {
      const totals: Record<string, number> = {}
      for await (const page of pages((after) =>
        getIvaBook(tenantId, { book, month: spec.month, after, limit: PAGE }),
      )) {
        for (const row of page.rows) {
          for (const [, key] of columns) totals[key] = (totals[key] ?? 0) + (row.amounts[key] ?? 0)
          yield purchases ? ivaPurchasesCsvRow(row) : ivaSalesCsvRow(row)
        }
      }
      // Compras: 8 columnas antes de los importes y 2 después; ventas: 11 y 1.
      yield purchases ? ivaTotalsRow(8, columns, totals, 2) : ivaTotalsRow(11, columns, totals, 1)
    },
  }
}

function aliquotsPlan(tenantId: string, spec: ExportSpec, book: FiscalBook): ExportPlan {
  return {
    headers: IVA_ALIQUOTS_HEADERS,
    count: () =>
      firstTotal('acc_report_iva_aliquots', {
        p_tenant_id: tenantId,
        p_book: book,
        p_month: spec.month,
      }),
    rows: async function* () {
      let net = 0
      let vat = 0
      for await (const page of pages((after) =>
        getIvaAliquots(tenantId, { book, month: spec.month, after, limit: PAGE }),
      )) {
        for (const row of page.rows) {
          net += row.netCents
          vat += row.vatCents
          yield ivaAliquotCsvRow(row)
        }
      }
      yield ['Totales', null, null, null, null, null, null, csvMoney(net), csvMoney(vat)]
    },
  }
}

function positionPlan(tenantId: string, spec: ExportSpec): ExportPlan {
  return {
    headers: IVA_POSITION_HEADERS,
    count: small,
    rows: async function* () {
      const position = await getIvaPosition(tenantId, spec.month)
      for (const row of ivaPositionCsvRows(position)) yield row
    },
  }
}

// ─── Subdiarios ──────────────────────────────────────────────────────────────

function subledgerPlan(tenantId: string, spec: ExportSpec, kind: SubledgerKind): ExportPlan {
  const columns = SUBLEDGER_COLUMNS[kind]
  const treasuryId = kind === 'treasury' ? spec.treasuryId : null
  return {
    headers: columns.map((c) => c.header),
    count: () =>
      firstTotal('acc_report_subledger', {
        p_tenant_id: tenantId,
        p_kind: kind,
        p_from: spec.from,
        p_to: spec.to,
        p_treasury_id: treasuryId,
      }),
    rows: async function* () {
      const totals = columns.map(() => 0)
      for await (const page of pages((after) =>
        getSubledger(tenantId, {
          kind,
          from: spec.from,
          to: spec.to,
          treasuryId,
          after,
          limit: PAGE,
        }),
      )) {
        for (const row of page.rows) {
          const cells: CsvRow = columns.map((column, i) => {
            const value = subledgerCell(row, column)
            if (row.rowKind === 'line' && column.type === 'money' && typeof value === 'number') {
              totals[i] = (totals[i] ?? 0) + value
            }
            return subledgerCsvCell(column, value)
          })
          if (row.rowKind === 'opening') {
            const concept = columns.findIndex((c) => c.header === 'Concepto')
            if (concept >= 0 && !cells[concept]) cells[concept] = 'Saldo anterior'
          }
          yield cells
        }
      }
      yield columns.map((column, i): CsvCell => {
        if (i === 0) return 'Totales'
        if (column.type !== 'money' || column.header === 'Saldo') return null
        return csvMoney(totals[i] ?? 0)
      })
    },
  }
}

// ─── Estados de cuenta y saldos ──────────────────────────────────────────────

async function statementPlan(tenantId: string, spec: ExportSpec): Promise<ExportPlan> {
  const party = spec.partyId ? await getParty(tenantId, spec.partyId) : null
  if (!party) {
    throw new AccQueryError('export', 'invalid', 'Ese proveedor o cliente no existe en este bar.')
  }
  return {
    headers: statementHeaders(party.group),
    count: () =>
      firstTotal('acc_report_party_statement', {
        p_tenant_id: tenantId,
        p_party_id: party.id,
        p_account_id: null,
        p_from: spec.from,
        p_to: spec.to,
      }),
    rows: async function* () {
      let up = 0
      let down = 0
      let closing: number | null = null
      for await (const page of pages((after) =>
        getPartyStatement(tenantId, {
          partyId: party.id,
          from: spec.from,
          to: spec.to,
          after,
          limit: PAGE,
        }),
      )) {
        for (const row of page.rows) {
          if (row.rowKind === 'line') {
            up += row.increaseCents
            down += row.decreaseCents
          }
          closing = row.runningBalanceCents
          yield statementCsvRow(row)
        }
      }
      yield [
        'Totales',
        null,
        null,
        null,
        csvMoney(up),
        csvMoney(down),
        closing === null ? null : csvMoney(closing),
        null,
      ]
    },
  }
}

function balancesPlan(
  tenantId: string,
  spec: ExportSpec,
  group: 'payables' | 'receivables',
): ExportPlan {
  return {
    headers: PARTY_BALANCES_HEADERS,
    count: small,
    rows: async function* () {
      const rows = (await listPartyBalances(tenantId, { group, asOf: spec.asOf })).filter(
        (r) => r.debtCents !== 0 || r.creditCents !== 0,
      )
      for (const row of rows) yield partyBalanceCsvRow(row)
      yield partyBalancesTotalsRow(rows)
    },
  }
}

// ─── Cajas, flujo, neto por medio, ventas sin factura ────────────────────────

function treasuryBalancesPlan(tenantId: string, spec: ExportSpec): ExportPlan {
  return {
    headers: TREASURY_BALANCES_HEADERS,
    count: small,
    rows: async function* () {
      const rows = await listTreasuryBalances(tenantId, { asOf: spec.asOf })
      let balance = 0
      let pending = 0
      for (const row of rows) {
        balance += row.balanceCents
        pending += row.pendingWalletCents
        yield treasuryBalanceCsvRow(row)
      }
      yield ['Totales', null, csvMoney(balance), csvMoney(pending), null, null]
    },
  }
}

function cashFlowPlan(tenantId: string, spec: ExportSpec): ExportPlan {
  return {
    headers: CASH_FLOW_HEADERS,
    count: small,
    rows: async function* () {
      const rows = await getCashFlow(tenantId, { from: spec.from, to: spec.to })
      let inflow = 0
      let outflow = 0
      for (const row of rows) {
        inflow += row.inflowCents
        outflow += row.outflowCents
        yield cashFlowCsvRow(row)
      }
      yield ['Totales', null, csvMoney(inflow), csvMoney(outflow), csvMoney(inflow - outflow)]
    },
  }
}

function netByMethodPlan(tenantId: string, spec: ExportSpec): ExportPlan {
  return {
    headers: NET_BY_METHOD_HEADERS,
    count: small,
    rows: async function* () {
      const rows = await getNetByMethod(tenantId, { from: spec.from, to: spec.to })
      const sum = (pick: (r: (typeof rows)[number]) => number) =>
        csvMoney(rows.reduce((t, r) => t + pick(r), 0))
      for (const row of rows) yield netByMethodCsvRow(row)
      yield [
        'Totales',
        null,
        sum((r) => r.soldCents),
        sum((r) => r.commissionCents),
        sum((r) => r.commissionVatCents),
        sum((r) => r.withholdingsCents),
        sum((r) => r.otherChargesCents),
        sum((r) => r.unexplainedCents),
        sum((r) => r.creditedCents),
        sum((r) => r.pendingCents),
        null,
      ]
    },
  }
}

function salesSummaryPlan(tenantId: string, spec: ExportSpec): ExportPlan {
  return {
    headers: SALES_SUMMARY_HEADERS,
    count: small,
    rows: async function* () {
      const rows = await getSalesSummary(tenantId, { from: spec.from, to: spec.to })
      const sum = (pick: (r: (typeof rows)[number]) => number) =>
        csvMoney(rows.reduce((t, r) => t + pick(r), 0))
      for (const row of rows) yield salesSummaryCsvRow(row)
      yield [
        'Totales',
        null,
        sum((r) => r.soldCents),
        sum((r) => r.invoicedNetCents),
        sum((r) => r.vatCents),
        sum((r) => r.uninvoicedCents),
      ]
    },
  }
}

// ─── Historia y plan de cuentas ──────────────────────────────────────────────

function historyPlan(tenantId: string, spec: ExportSpec): ExportPlan {
  return {
    headers: HISTORY_HEADERS,
    count: async () =>
      (await listHistory(tenantId, { from: spec.from, to: spec.to, limit: 1 })).totalRows,
    rows: async function* () {
      for await (const page of pages((after) =>
        listHistory(tenantId, { from: spec.from, to: spec.to, after, limit: 200 }),
      )) {
        for (const row of page.rows) yield historyCsvRow(row)
      }
    },
  }
}

function accountsPlan(tenantId: string): ExportPlan {
  return {
    headers: ACCOUNTS_HEADERS,
    count: small,
    rows: async function* () {
      for (const row of await listAccounts(tenantId, { includeInactive: true })) {
        yield accountCsvRow(row)
      }
    },
  }
}

const SUBLEDGER_BY_BOOK: Partial<Record<ExportBook, SubledgerKind>> = {
  'subdiario-compras': 'purchases',
  'subdiario-pagos': 'payments',
  'subdiario-ventas': 'sales',
  'subdiario-ventas-medios': 'sales_by_method',
  'subdiario-cobranzas': 'collections',
  'subdiario-disponibilidades': 'treasury',
}

/** El plan de exporte de un libro ya validado (período resuelto, ids UUID). */
export async function buildExport(tenantId: string, spec: ExportSpec): Promise<ExportPlan> {
  const subledger = SUBLEDGER_BY_BOOK[spec.libro]
  if (subledger) return subledgerPlan(tenantId, spec, subledger)
  switch (spec.libro) {
    case 'diario':
      return journalPlan(tenantId, spec, 'journal')
    case 'asientos-importacion':
      return journalPlan(tenantId, spec, 'import')
    case 'mayor':
      if (!spec.accountId) {
        throw new AccQueryError('export', 'invalid', 'Elegí la cuenta del mayor.')
      }
      return ledgerPlan(tenantId, spec)
    case 'mayor-general':
      return generalLedgerPlan(tenantId, spec)
    case 'sumas-y-saldos':
      return trialPlan(tenantId, spec)
    case 'iva-compras':
      return ivaBookPlan(tenantId, spec, 'purchases')
    case 'iva-ventas':
      return ivaBookPlan(tenantId, spec, 'sales')
    case 'iva-compras-alicuotas':
      return aliquotsPlan(tenantId, spec, 'purchases')
    case 'iva-ventas-alicuotas':
      return aliquotsPlan(tenantId, spec, 'sales')
    case 'posicion-iva':
      return positionPlan(tenantId, spec)
    case 'estado-de-cuenta':
      return statementPlan(tenantId, spec)
    case 'saldos-proveedores':
      return balancesPlan(tenantId, spec, 'payables')
    case 'saldos-clientes':
      return balancesPlan(tenantId, spec, 'receivables')
    case 'cajas-y-bancos':
      return treasuryBalancesPlan(tenantId, spec)
    case 'flujo-de-caja':
      return cashFlowPlan(tenantId, spec)
    case 'neto-por-medio':
      return netByMethodPlan(tenantId, spec)
    case 'ventas-sin-factura':
      return salesSummaryPlan(tenantId, spec)
    case 'historia':
      return historyPlan(tenantId, spec)
    case 'plan-de-cuentas':
      return accountsPlan(tenantId)
    default:
      throw new AccQueryError('export', 'invalid', 'Ese libro no existe.')
  }
}
