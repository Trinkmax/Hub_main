import 'server-only'
import { addDays, isRealIsoDay } from '@/lib/dates/civil'
import { formatIsoDay, formatMonthLabel } from '@/lib/dates/format'
import { cordobaDayStartUtc } from '@/lib/dates/zone'
import { getMemberLabels } from './access'
import {
  documentKindLabel,
  documentRef,
  documentTitle,
  EXPORT_BOOK_INFO,
  isExportBook,
} from './labels'
import {
  asRecord,
  centsOrNull,
  clampLimit,
  decodePageToken,
  encodeCursor,
  int,
  intOrNull,
  isRecord,
  isUuid,
  namesById,
  type QueryPage,
  queryError,
  readerClient,
  settleQuery,
  str,
  strOrNull,
  type UnknownRecord,
} from './shared'

/**
 * Historia contable (§F.14, H.12 «Historia»): `audit_log` con
 * `entity like 'acc\_%'` (políticas de B.7), keyset por `(created_at, id)`
 * descendente, 100 por página, con nombres de `acc_member_labels`.
 * «Franco cargó Factura A 0003-00001290 · $ 860.000,00 · 03/10 14:32».
 */

export type HistoryRow = {
  id: string
  createdAt: string
  userId: string | null
  actorName: string
  action: string
  entity: string
  entityId: string | null
  /** El verbo y el objeto, sin el nombre: «cargó Factura A 0003-00001290». */
  text: string
  documentId: string | null
  documentSeq: number | null
  amountCents: number | null
  /** Un dato más, si hay (asientos del cierre, filas del exporte). */
  detail: string | null
}

export type HistoryFilters = {
  userId?: string | null
  /** Entidad: `acc_document`, `acc_period`, `acc_access`, `acc_export`… */
  entity?: string | null
  /** Días del bar (Córdoba), inclusivos. */
  from?: string | null
  to?: string | null
  after?: string | null
  limit?: number | null
}

export type HistoryPage = QueryPage<HistoryRow> & {
  /** Personas que cargaron algo, para el filtro «Quién». */
  people: Array<{ userId: string; name: string }>
}

const ENTITY_RE = /^acc_[a-z_]{2,40}$/

type Names = {
  labels: ReadonlyMap<string, string>
  documents: ReadonlyMap<string, UnknownRecord>
  parties: ReadonlyMap<string, UnknownRecord>
  treasuries: ReadonlyMap<string, UnknownRecord>
  accounts: ReadonlyMap<string, UnknownRecord>
}

function docTitle(names: Names, id: string | null, payload: UnknownRecord): string {
  const doc = id ? names.documents.get(id) : undefined
  if (doc) {
    return documentTitle({
      kind: str(doc.kind),
      voucherType: strOrNull(doc.voucher_type),
      pointOfSale: intOrNull(doc.point_of_sale),
      number: intOrNull(doc.number),
    })
  }
  const kind = strOrNull(payload.kind)
  const seq = intOrNull(payload.seq)
  const base = kind ? documentKindLabel(kind) : 'un comprobante'
  return seq ? `${base} ${documentRef(seq)}` : base
}

function personName(names: Names, userId: unknown): string {
  return isUuid(userId) ? (names.labels.get(userId) ?? 'otra persona') : 'otra persona'
}

function describe(
  row: UnknownRecord,
  names: Names,
): { text: string; amountCents: number | null; detail: string | null } {
  const action = str(row.action)
  const entityId = strOrNull(row.entity_id)
  const payload = asRecord(row.payload)
  const created = payload.created === true
  switch (action) {
    case 'acc_setup.completed':
      return { text: 'configuró Administración', amountCents: null, detail: null }
    case 'acc_settings.updated':
      return { text: 'cambió los datos de la SAS', amountCents: null, detail: null }
    case 'acc_access.granted':
      return {
        text: `le dio acceso a ${personName(names, payload.user_id)}`,
        amountCents: null,
        detail: payload.is_admin === true ? 'También da accesos' : null,
      }
    case 'acc_access.revoked':
      return {
        text: `le sacó el acceso a ${personName(names, payload.user_id)}`,
        amountCents: null,
        detail: null,
      }
    case 'acc_access.admin_claimed':
      return { text: 'pasó a dar los accesos', amountCents: null, detail: null }
    case 'acc_access.designated_by_platform':
      return {
        text: `quedó a cargo de configurar Administración (lo designó Soporte HUB)`,
        amountCents: null,
        detail: null,
      }
    case 'acc_document.posted':
      return {
        text: `cargó ${docTitle(names, entityId, payload)}`,
        amountCents: centsOrNull(payload.total_cents),
        detail: null,
      }
    case 'acc_document.replaced': {
      const newId = strOrNull(payload.new_id) ?? entityId
      return {
        text: `corrigió ${docTitle(names, newId, payload)}`,
        amountCents: centsOrNull(payload.new_total_cents ?? payload.total_cents),
        detail: null,
      }
    }
    case 'acc_document.voided':
      return {
        text: `${payload.undo === true ? 'deshizo' : 'anuló'} ${docTitle(names, entityId, payload)}`,
        amountCents: centsOrNull(payload.total_cents),
        detail: null,
      }
    case 'acc_document.reversed': {
      const originalId = strOrNull(payload.original_id) ?? entityId
      const date = strOrNull(payload.reversal_date)
      return {
        text: `anuló con fecha posterior ${docTitle(names, originalId, payload)}`,
        amountCents: centsOrNull(payload.total_cents),
        detail: date && isRealIsoDay(date) ? `Anulación del ${formatIsoDay(date)}` : null,
      }
    }
    case 'acc_allocation.created': {
      const count = int(payload.count)
      return {
        text: count > 1 ? `aplicó ${count} pagos o cobros` : 'aplicó un pago o cobro',
        amountCents: centsOrNull(payload.total_cents),
        detail: null,
      }
    }
    case 'acc_allocation.voided':
      return {
        text: 'desaplicó un pago o cobro',
        amountCents: centsOrNull(payload.amount_cents),
        detail: null,
      }
    case 'acc_treasury.checked': {
      const treasury = names.treasuries.get(str(payload.treasury_id))
      const asOf = strOrNull(payload.as_of)
      return {
        text: `confirmó el saldo de ${treasury ? str(treasury.name) : 'una caja'}`,
        amountCents: null,
        detail: asOf && isRealIsoDay(asOf) ? `Al ${formatIsoDay(asOf)}` : null,
      }
    }
    case 'acc_period.closed':
    case 'acc_period.reopened': {
      const month = strOrNull(payload.month)
      const label = month ? formatMonthLabel(month) : 'un mes'
      const from = intOrNull(payload.number_from)
      const to = intOrNull(payload.number_to)
      return {
        text: `${action === 'acc_period.closed' ? 'cerró' : 'reabrió'} ${label || 'un mes'}`,
        amountCents: null,
        detail: from !== null && to !== null ? `Asientos del ${from} al ${to}` : null,
      }
    }
    case 'acc_fiscal_year.closed':
    case 'acc_fiscal_year.reopened': {
      const start = strOrNull(payload.start_date)
      const end = strOrNull(payload.end_date)
      const range =
        start && end && isRealIsoDay(start) && isRealIsoDay(end)
          ? ` (${formatIsoDay(start)} al ${formatIsoDay(end)})`
          : ''
      return {
        text: `${action === 'acc_fiscal_year.closed' ? 'cerró' : 'reabrió'} el ejercicio${range}`,
        amountCents: action === 'acc_fiscal_year.closed' ? centsOrNull(payload.result_cents) : null,
        detail: null,
      }
    }
    case 'acc_account.saved': {
      const account = entityId ? names.accounts.get(entityId) : undefined
      const verb = created ? 'agregó' : 'cambió'
      return {
        text: account
          ? `${verb} la cuenta ${str(account.code)} ${str(account.name)}`
          : `${verb} una cuenta`,
        amountCents: null,
        detail: null,
      }
    }
    case 'acc_party.saved': {
      const party = entityId ? names.parties.get(entityId) : undefined
      const name = party ? str(party.name) : 'un proveedor o cliente'
      return {
        text: created ? `agregó a ${name}` : `cambió los datos de ${name}`,
        amountCents: null,
        detail: null,
      }
    }
    case 'acc_treasury.saved': {
      const treasury = entityId ? names.treasuries.get(entityId) : undefined
      const name = treasury ? str(treasury.name) : 'una caja o cuenta'
      return {
        text: created ? `agregó ${name}` : `cambió ${name}`,
        amountCents: null,
        detail: null,
      }
    }
    case 'acc_sales_method.saved':
      return {
        text: created ? 'agregó un medio de cobro' : 'cambió un medio de cobro',
        amountCents: null,
        detail: null,
      }
    case 'acc_sales_point.saved':
      return {
        text: created ? 'agregó un punto de venta' : 'cambió un punto de venta',
        amountCents: null,
        detail: null,
      }
    case 'acc_recurring.saved':
      return {
        text: created ? 'agregó un gasto fijo' : 'cambió un gasto fijo',
        amountCents: null,
        detail: null,
      }
    case 'acc_export.downloaded': {
      const libro = payload.libro
      const title = isExportBook(libro) ? EXPORT_BOOK_INFO[libro].title : 'un libro'
      const rows = intOrNull(payload.filas)
      return {
        text: `exportó ${title}`,
        amountCents: null,
        detail: rows !== null ? `${rows} ${rows === 1 ? 'fila' : 'filas'}` : null,
      }
    }
    default:
      return { text: action, amountCents: null, detail: null }
  }
}

/** El documento de la fila (para el link), si es de un comprobante. */
function documentIdOf(row: UnknownRecord): string | null {
  const action = str(row.action)
  const payload = asRecord(row.payload)
  if (action === 'acc_document.replaced')
    return strOrNull(payload.new_id) ?? strOrNull(row.entity_id)
  if (action === 'acc_document.reversed') {
    return strOrNull(payload.original_id) ?? strOrNull(row.entity_id)
  }
  return str(row.entity) === 'acc_document' ? strOrNull(row.entity_id) : null
}

/**
 * Una página de la historia contable, la más reciente primero (100 por
 * página, `?despues=`). Filtros por persona, tipo y días del bar.
 */
export async function listHistory(
  tenantId: string,
  filters: HistoryFilters = {},
): Promise<HistoryPage> {
  const limit = clampLimit(filters.limit, 100, 200)
  const token = decodePageToken(filters.after)
  const supabase = await readerClient()

  // Los mismos filtros para la página y para el conteo (escritos dos veces: el
  // genérico del builder de supabase-js no se deja abstraer sin explotar tsc).
  const byUser = filters.userId && isUuid(filters.userId) ? filters.userId : null
  const byEntity = filters.entity && ENTITY_RE.test(filters.entity) ? filters.entity : null
  const fromUtc =
    filters.from && isRealIsoDay(filters.from) ? cordobaDayStartUtc(filters.from) : null
  const toUtc =
    filters.to && isRealIsoDay(filters.to) ? cordobaDayStartUtc(addDays(filters.to, 1)) : null

  let pageQuery = supabase
    .from('audit_log')
    .select('id, created_at, user_id, action, entity, entity_id, payload')
    .eq('tenant_id', tenantId)
    .like('entity', 'acc\\_%')
  let countQuery = supabase
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .like('entity', 'acc\\_%')
  if (byUser) {
    pageQuery = pageQuery.eq('user_id', byUser)
    countQuery = countQuery.eq('user_id', byUser)
  }
  if (byEntity) {
    pageQuery = pageQuery.eq('entity', byEntity)
    countQuery = countQuery.eq('entity', byEntity)
  }
  if (fromUtc) {
    pageQuery = pageQuery.gte('created_at', fromUtc)
    countQuery = countQuery.gte('created_at', fromUtc)
  }
  if (toUtc) {
    pageQuery = pageQuery.lt('created_at', toUtc)
    countQuery = countQuery.lt('created_at', toUtc)
  }
  const cursorAt = token ? strOrNull(token.cursor.t) : null
  const cursorId = token ? strOrNull(token.cursor.i) : null
  if (cursorAt && cursorId && isUuid(cursorId)) {
    const at = cursorAt.replace(/"/g, '')
    pageQuery = pageQuery.or(`created_at.lt."${at}",and(created_at.eq."${at}",id.lt.${cursorId})`)
  }

  const [pageResult, countResult, labelsResult] = await Promise.all([
    pageQuery
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit),
    countQuery,
    settleQuery(getMemberLabels(tenantId)),
  ])
  if (pageResult.error) throw queryError('audit_log', pageResult.error)
  if (countResult.error) throw queryError('audit_log', countResult.error)
  const rows = ((pageResult.data ?? []) as unknown[]).filter(isRecord)
  const labels = labelsResult.ok ? labelsResult.data : new Map<string, string>()

  const payloads = rows.map((r) => asRecord(r.payload))
  const [documents, parties, treasuries, accounts] = await Promise.all([
    namesById(
      tenantId,
      'acc_documents',
      rows.map(documentIdOf),
      'id, seq, kind, voucher_type, point_of_sale, number',
    ),
    namesById(
      tenantId,
      'acc_parties',
      rows.filter((r) => r.entity === 'acc_party').map((r) => r.entity_id),
    ),
    namesById(tenantId, 'acc_treasury_accounts', [
      ...rows.filter((r) => r.entity === 'acc_treasury').map((r) => r.entity_id),
      ...payloads.map((p) => p.treasury_id),
    ]),
    namesById(
      tenantId,
      'acc_accounts',
      rows.filter((r) => r.entity === 'acc_account').map((r) => r.entity_id),
      'id, code, name',
    ),
  ])
  const names: Names = { labels, documents, parties, treasuries, accounts }

  const historyRows: HistoryRow[] = rows.map((row) => {
    const userId = strOrNull(row.user_id)
    const documentId = documentIdOf(row)
    const doc = documentId ? documents.get(documentId) : undefined
    const { text, amountCents, detail } = describe(row, names)
    return {
      id: str(row.id),
      createdAt: str(row.created_at),
      userId,
      actorName: userId ? (labels.get(userId) ?? 'Alguien del equipo') : 'Sistema',
      action: str(row.action),
      entity: str(row.entity),
      entityId: strOrNull(row.entity_id),
      text,
      documentId: doc ? documentId : null,
      documentSeq: doc ? intOrNull(doc.seq) : null,
      amountCents,
      detail,
    }
  })

  const last = rows.at(-1)
  const seen = (token?.seen ?? 0) + rows.length
  const total = countResult.count ?? seen
  const nextCursor =
    last && rows.length === limit && seen < total
      ? encodeCursor({ t: str(last.created_at), i: str(last.id) }, seen)
      : null

  return {
    rows: historyRows,
    nextCursor,
    totalRows: Math.max(total, seen),
    people: [...labels.entries()]
      .map(([userId, name]) => ({ userId, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  }
}
