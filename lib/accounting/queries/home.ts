import 'server-only'
import type { PgLikeError } from '@/lib/accounting/errors'
import {
  aggregateSpending,
  SPENDING_BASE_ROLES,
  SPENDING_DOCUMENT_KINDS,
  SPENDING_TAX_ROLES,
  type SpendingAccount,
  type SpendingDocument,
  type SpendingLine,
  type SpendingTotals,
} from '@/lib/accounting/home'
import {
  cents,
  chunks,
  int,
  intOrNull,
  isRecord,
  namesById,
  queryError,
  readerClient,
  requireRange,
  str,
  strOrNull,
  type UnknownRecord,
  uniqueIds,
} from './shared'

/**
 * Lecturas propias del Resumen («la plata hoy»): lo que `acc_report_summary`
 * no trae. Las cuentas y los textos están en `lib/accounting/home.ts` (puro).
 *
 * Todo por la RLS de lectores (la contadora también lo ve), con el bar
 * explícito en cada `select`. Solo importes, tipos e ids: ni nombres de
 * proveedores, ni descripciones, ni notas.
 */

// ─── En qué se va la plata ───────────────────────────────────────────────────

export type MonthSpending = SpendingTotals & {
  from: string
  to: string
  /**
   * Se llegó al tope de lectura: los números son de una parte del período. La
   * pantalla tiene que decirlo (no pasa con lo que carga un bar en un mes).
   */
  truncated: boolean
}

/** La API devuelve hasta 1.000 filas por pedido: se lee de a páginas. */
const PAGE = 1000
/** 10.000 comprobantes de compra en un período: más de lo que carga un bar. */
const MAX_DOCUMENT_PAGES = 10
/** Por tanda de 100 comprobantes (10.000 renglones). */
const MAX_LINE_PAGES = 10
/** Tandas de renglones que se piden a la vez. */
const LINE_BATCHES_AT_ONCE = 6

type PageResult = { data: unknown; error: PgLikeError | null }

/**
 * Lee TODAS las filas de una consulta, de a 1.000 (`range`). La consulta tiene
 * que venir ordenada por una columna única: si no, una fila puede salir dos
 * veces o ninguna entre una página y la otra.
 */
async function readAllPages(
  source: string,
  maxPages: number,
  fetchPage: (from: number, to: number) => PromiseLike<PageResult>,
): Promise<{ rows: UnknownRecord[]; truncated: boolean }> {
  const rows: UnknownRecord[] = []
  for (let page = 0; page < maxPages; page += 1) {
    const { data, error } = await fetchPage(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw queryError(source, error)
    const batch = Array.isArray(data) ? (data as unknown[]) : []
    for (const row of batch) if (isRecord(row)) rows.push(row)
    if (batch.length < PAGE) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

export function parseSpendingDocument(row: UnknownRecord): SpendingDocument {
  return {
    id: str(row.id),
    kind: str(row.kind),
    voucherType: strOrNull(row.voucher_type),
    totalCents: cents(row.total_cents),
  }
}

export function parseSpendingLine(row: UnknownRecord): SpendingLine {
  return {
    documentId: str(row.document_id),
    role: str(row.role),
    side: row.side === 'credit' ? 'credit' : 'debit',
    amountCents: cents(row.amount_cents),
    accountId: str(row.account_id),
    vatRateBp: intOrNull(row.vat_rate_bp),
  }
}

/** Desde qué nivel una cuenta se agrupa en su grupo (el plan tiene hasta 5). */
const LEAF_LEVEL = 5

/**
 * La categoría de cada cuenta: su grupo del plan («Compras: bebidas sin
 * alcohol» → «Alimentos y bebidas»). Va por la jerarquía (`parent_id`), nunca
 * por el prefijo del código: el plan se puede editar. Una cuenta que ya está
 * arriba del último nivel es su propia categoría.
 */
export function spendingAccounts(
  accounts: ReadonlyMap<string, UnknownRecord>,
  parents: ReadonlyMap<string, UnknownRecord>,
): Map<string, SpendingAccount> {
  const out = new Map<string, SpendingAccount>()
  for (const [id, row] of accounts) {
    const parentId = strOrNull(row.parent_id)
    const parent = parentId && int(row.level) >= LEAF_LEVEL ? parents.get(parentId) : undefined
    const group = parent && str(parent.name) ? parent : row
    out.set(id, {
      type: str(row.type),
      categoryKey: str(group.id, id),
      categoryLabel: str(group.name) || 'Sin nombre',
    })
  }
  return out
}

/**
 * «En qué se va la plata» de un período (el mes en curso: `homeSpendingRange`):
 * las compras y los gastos por categoría y por el papel que tienen (con
 * factura / sin factura).
 *
 * Es el mismo criterio de «Compras y gastos» del resumen
 * (`acc_report_summary.month_to_date`), así los dos números coinciden:
 * compras, notas de débito, gastos de contado y gastos bancarios, menos las
 * notas de crédito; por fecha contable; sin los anulados (`status = 'posted'`)
 * y sin la factura mensual de comisiones (`settles_commissions`).
 *
 * En cuatro tiempos: los comprobantes del período, sus renglones (en tandas de
 * 100 comprobantes), las cuentas de esos renglones y sus grupos. Lo que puede
 * crecer va paginado: un mes cargado pasa las 1.000 filas de la API en los
 * renglones. Si aun así se llega al tope, `truncated` lo avisa.
 */
export async function getMonthSpending(
  tenantId: string,
  params: { from: string; to: string },
): Promise<MonthSpending> {
  const range = requireRange(params.from, params.to)
  const supabase = await readerClient()

  const documents = await readAllPages('acc_documents', MAX_DOCUMENT_PAGES, (from, to) =>
    supabase
      .from('acc_documents')
      .select('id, kind, voucher_type, total_cents')
      .eq('tenant_id', tenantId)
      .eq('status', 'posted')
      .eq('settles_commissions', false)
      .in('kind', [...SPENDING_DOCUMENT_KINDS])
      .gte('accounting_date', range.from)
      .lte('accounting_date', range.to)
      .order('id', { ascending: true })
      .range(from, to),
  )
  const docs = documents.rows.map(parseSpendingDocument).filter((d) => d.id !== '')
  let truncated = documents.truncated

  const lines: SpendingLine[] = []
  const batches = chunks(uniqueIds(docs.map((d) => d.id)))
  for (let i = 0; i < batches.length; i += LINE_BATCHES_AT_ONCE) {
    const results = await Promise.all(
      batches.slice(i, i + LINE_BATCHES_AT_ONCE).map((ids) =>
        readAllPages('acc_document_lines', MAX_LINE_PAGES, (from, to) =>
          supabase
            .from('acc_document_lines')
            .select('document_id, role, side, amount_cents, account_id, vat_rate_bp')
            .eq('tenant_id', tenantId)
            .in('document_id', ids)
            // Solo lo que dice en qué se gastó y sus impuestos: la contrapartida
            // (la caja, el proveedor) no hace falta.
            .in('role', [...SPENDING_BASE_ROLES, ...SPENDING_TAX_ROLES])
            .order('id', { ascending: true })
            .range(from, to),
        ),
      ),
    )
    for (const result of results) {
      for (const row of result.rows) lines.push(parseSpendingLine(row))
      if (result.truncated) truncated = true
    }
  }

  const accounts = await namesById(
    tenantId,
    'acc_accounts',
    lines.map((l) => l.accountId),
    'id, name, type, level, parent_id',
  )
  const parents = await namesById(
    tenantId,
    'acc_accounts',
    [...accounts.values()].map((a) => a.parent_id),
    'id, name',
  )

  return {
    from: range.from,
    to: range.to,
    truncated,
    ...aggregateSpending(docs, lines, spendingAccounts(accounts, parents)),
  }
}

// ─── Puesta en marcha: proveedores sin categoría ─────────────────────────────

export type SupplierCategoryCount = {
  /** Proveedores activos a los que se les carga una compra (sin los del sistema, como «Varios»). */
  total: number
  /** De esos, los que no tienen su categoría habitual (`default_account_id`). */
  withoutCategory: number
}

/** A quiénes se les carga una factura o un gasto (como `supplierClassification` de Compras). */
const CLASSIFIABLE_PARTY_KINDS = ['supplier', 'other'] as const

/**
 * Cuántos proveedores no tienen dicho en qué se gasta con ellos, para la franja
 * «Puesta en marcha». Es la misma regla del filtro «Sin clasificar» de Compras ›
 * Proveedores (activos, proveedores u «otros», no los del sistema), así los dos
 * números coinciden. Solo cuenta (`head`): no trae ninguna ficha.
 */
export async function getSupplierCategoryCount(tenantId: string): Promise<SupplierCategoryCount> {
  const supabase = await readerClient()
  const suppliers = () =>
    supabase
      .from('acc_parties')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('kind', [...CLASSIFIABLE_PARTY_KINDS])
      .eq('active', true)
      .is('system_key', null)
  const [all, missing] = await Promise.all([
    suppliers(),
    suppliers().is('default_account_id', null),
  ])
  if (all.error) throw queryError('acc_parties', all.error)
  if (missing.error) throw queryError('acc_parties', missing.error)
  return { total: all.count ?? 0, withoutCategory: missing.count ?? 0 }
}
