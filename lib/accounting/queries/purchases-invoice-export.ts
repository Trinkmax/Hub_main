import 'server-only'
import { type InvoiceFilter, matchesInvoiceFilter } from '@/lib/accounting/invoiced'
import type { CsvCell } from '@/lib/csv/write'
import { csvMoney } from '@/lib/csv/write'
import { getSubledger, subledgerCell } from './books'
import { SUBLEDGER_COLUMNS } from './columns'
import { type CsvRow, subledgerCsvCell } from './csv'
import type { ExportPlan, ExportSpec } from './exports'
import {
  AccQueryError,
  chunks,
  isRecord,
  queryError,
  readerClient,
  str,
  strOrNull,
  uniqueIds,
} from './shared'

/**
 * El subdiario de compras «con factura» o «sin factura» (pedido de los socios,
 * 12/10/2026): el exporte de Compras › Comprobantes cuando la lista está
 * filtrada. Mismas columnas y mismas filas que el subdiario entero
 * (`acc_report_subledger`), pero solo las que entran en el filtro, con sus
 * totales. La base no cambia: el tipo de comprobante de cada fila se lee
 * aparte y se filtra acá.
 *
 * Los libros (diario, mayor, sumas y saldos) NO se filtran: todo va al mismo
 * diario, a propósito.
 */

const PAGE = 500
/** Red contra un cursor que no avanza (nunca debería pasar). */
const MAX_PAGES = 2000
const TOO_LARGE = 'Es demasiado para un solo archivo. Elegí un período más corto.'

/**
 * El tipo de comprobante de cada fila del subdiario. Una anulación no lleva
 * tipo: vale el del comprobante que anula (va al mismo grupo que él).
 */
async function voucherTypesOf(
  tenantId: string,
  documentIds: readonly (string | null)[],
): Promise<Map<string, string | null>> {
  const ids = uniqueIds(documentIds)
  const out = new Map<string, string | null>()
  if (ids.length === 0) return out
  const supabase = await readerClient()

  const read = async (wanted: readonly string[]) => {
    const rows: Array<{ id: string; voucherType: string | null; reverses: string | null }> = []
    const results = await Promise.all(
      chunks(wanted).map((chunk) =>
        supabase
          .from('acc_documents')
          .select('id, voucher_type, reverses_document_id')
          .eq('tenant_id', tenantId)
          .in('id', chunk),
      ),
    )
    for (const result of results) {
      if (result.error) throw queryError('acc_documents', result.error)
      for (const row of (result.data ?? []) as unknown[]) {
        if (!isRecord(row)) continue
        rows.push({
          id: str(row.id),
          voucherType: strOrNull(row.voucher_type),
          reverses: strOrNull(row.reverses_document_id),
        })
      }
    }
    return rows
  }

  const docs = await read(ids)
  const originalOf = new Map<string, string>()
  for (const doc of docs) {
    if (doc.reverses) originalOf.set(doc.id, doc.reverses)
    else out.set(doc.id, doc.voucherType)
  }
  if (originalOf.size > 0) {
    const originals = new Map(
      (await read(uniqueIds([...originalOf.values()]))).map((doc) => [doc.id, doc.voucherType]),
    )
    for (const [reversalId, originalId] of originalOf) {
      out.set(reversalId, originals.get(originalId) ?? null)
    }
  }
  return out
}

export function purchasesByInvoicePlan(
  tenantId: string,
  spec: ExportSpec,
  filter: Exclude<InvoiceFilter, 'todos'>,
): ExportPlan {
  const columns = SUBLEDGER_COLUMNS.purchases
  return {
    headers: columns.map((c) => c.header),
    // Una cota superior (el subdiario entero del rango): alcanza para cortar un archivo enorme.
    count: async () => {
      const first = await getSubledger(tenantId, {
        kind: 'purchases',
        from: spec.from,
        to: spec.to,
        after: null,
        limit: 1,
      })
      return first.totalRows
    },
    rows: async function* () {
      const totals = columns.map(() => 0)
      let after: string | null = null
      for (let i = 0; ; i += 1) {
        if (i >= MAX_PAGES)
          throw new AccQueryError('export', 'invalid', TOO_LARGE, 'export_too_large')
        const page = await getSubledger(tenantId, {
          kind: 'purchases',
          from: spec.from,
          to: spec.to,
          after,
          limit: PAGE,
        })
        const types = await voucherTypesOf(
          tenantId,
          page.rows.map((row) => row.documentId),
        )
        for (const row of page.rows) {
          const type = row.documentId ? (types.get(row.documentId) ?? null) : null
          if (!matchesInvoiceFilter(type, filter)) continue
          const cells: CsvRow = columns.map((column, index) => {
            const value = subledgerCell(row, column)
            if (row.rowKind === 'line' && column.type === 'money' && typeof value === 'number') {
              totals[index] = (totals[index] ?? 0) + value
            }
            return subledgerCsvCell(column, value)
          })
          yield cells
        }
        if (!page.nextCursor || page.nextCursor === after) break
        after = page.nextCursor
      }
      yield columns.map((column, index): CsvCell => {
        if (index === 0) return 'Totales'
        if (column.type !== 'money') return null
        return csvMoney(totals[index] ?? 0)
      })
    },
  }
}
