'use server'

/**
 * Lecturas que piden los componentes de cliente (las hojas de acción rápida
 * `?accion=` cargan sus datos al abrirse, admin-ui §2.4). Cada una valida la
 * sesión, el bar y el acceso de lectura (`authorizeAccounting(slug, 'read')`),
 * valida la entrada con zod y llama a la lectura de `lib/accounting/queries`.
 * Nunca tiran: devuelven `{ ok: true, data }` o `{ ok: false, code, message }`
 * (`QueryOutcome`) para que la hoja muestre el error con «Reintentar».
 *
 * Los tipos de `data` están en los módulos de lectura (`OpenItemRow`,
 * `TreasuryCheck`, `FormDefaults`…): importalos con `import type`.
 */

import { z } from 'zod'
import { authorizeAccounting } from '@/lib/accounting/access'
import { loadPostingCatalog, type PostingCatalog } from '@/lib/accounting/context'
import { PARTY_KINDS } from '@/lib/accounting/types'
import {
  type FormDefaults,
  findPossibleDuplicate,
  getFormDefaults,
  getQuickExpenseSuggestions,
  getTreasuryCheck,
  type PossibleDuplicate,
  type QuickExpenseSuggestion,
  type TreasuryCheck,
} from './forms'
import {
  getPartyPosition,
  listOpenItems,
  type OpenItemRow,
  type PartyOption,
  type PartyPosition,
  searchParties,
} from './parties'
import { type QueryOutcome, settleQuery } from './shared'
import { listTreasuryBalances, type TreasuryBalanceRow } from './treasury'

const uuid = z.uuid('El identificador no es válido.')
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elegí una fecha.')

async function withReader<T>(
  slug: string,
  run: (tenantId: string) => Promise<T>,
): Promise<QueryOutcome<T>> {
  const auth = await authorizeAccounting(slug, 'read')
  if (!auth.ok) return { ok: false, code: auth.state.code, message: auth.state.message }
  return settleQuery(run(auth.tenantId))
}

function invalid(error: z.ZodError): QueryOutcome<never> {
  return { ok: false, code: 'invalid', message: error.issues[0]?.message ?? 'Revisá los datos.' }
}

/**
 * Cuentas, proveedores y clientes, cajas con su saldo, medios de cobro y
 * puntos de venta (para los combos de una hoja). Mismo catálogo que usa el
 * motor en el servidor.
 */
export async function fetchAccountingCatalog(slug: string): Promise<QueryOutcome<PostingCatalog>> {
  return withReader(slug, (tenantId) => loadPostingCatalog(tenantId))
}

/** Saldo de cada caja hoy (o al día pedido). */
export async function fetchTreasuryBalances(
  slug: string,
  raw: unknown = {},
): Promise<QueryOutcome<TreasuryBalanceRow[]>> {
  const parsed = z.object({ asOf: isoDay.nullish() }).safeParse(raw ?? {})
  if (!parsed.success) return invalid(parsed.error)
  return withReader(slug, (tenantId) =>
    listTreasuryBalances(tenantId, { asOf: parsed.data.asOf ?? null }),
  )
}

const openItemsSchema = z.object({
  partyId: uuid,
  side: z.enum(['debt', 'credit']),
  accountId: uuid.nullish(),
})

/** Partidas abiertas de un proveedor o cliente, hoy («Pagar», «Cobrar», imputar). */
export async function fetchOpenItems(
  slug: string,
  raw: unknown,
): Promise<QueryOutcome<OpenItemRow[]>> {
  const parsed = openItemsSchema.safeParse(raw)
  if (!parsed.success) return invalid(parsed.error)
  return withReader(slug, (tenantId) =>
    listOpenItems(tenantId, {
      partyId: parsed.data.partyId,
      side: parsed.data.side,
      accountId: parsed.data.accountId ?? null,
    }),
  )
}

const positionSchema = z.object({
  partyId: uuid,
  group: z.enum(['payables', 'receivables']),
  soonDays: z.number().int().min(1).max(30).optional(),
})

/** Deuda, a favor, antigüedad y semáforo de un proveedor o cliente, hoy. */
export async function fetchPartyPosition(
  slug: string,
  raw: unknown,
): Promise<QueryOutcome<PartyPosition>> {
  const parsed = positionSchema.safeParse(raw)
  if (!parsed.success) return invalid(parsed.error)
  return withReader(slug, (tenantId) => getPartyPosition(tenantId, parsed.data))
}

const searchSchema = z.object({
  q: z.string().max(80).nullish(),
  kinds: z.array(z.enum(PARTY_KINDS)).max(10).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  includeInactive: z.boolean().optional(),
})

/** Buscar proveedores o clientes por nombre, fantasía o CUIT. */
export async function searchPartiesAction(
  slug: string,
  raw: unknown,
): Promise<QueryOutcome<PartyOption[]>> {
  const parsed = searchSchema.safeParse(raw ?? {})
  if (!parsed.success) return invalid(parsed.error)
  return withReader(slug, (tenantId) => searchParties(tenantId, parsed.data))
}

const treasuryCheckSchema = z.object({ treasuryId: uuid, asOf: isoDay.nullish() })

/** «Ajustar saldo»: el saldo según el sistema y, en billeteras, lo que falta acreditar. */
export async function fetchTreasuryCheck(
  slug: string,
  raw: unknown,
): Promise<QueryOutcome<TreasuryCheck | null>> {
  const parsed = treasuryCheckSchema.safeParse(raw)
  if (!parsed.success) return invalid(parsed.error)
  return withReader(slug, (tenantId) =>
    getTreasuryCheck(tenantId, {
      treasuryId: parsed.data.treasuryId,
      asOf: parsed.data.asOf ?? null,
    }),
  )
}

/** Lo que el sistema recuerda de un proveedor (cuenta, comprobante, caja, plazo). */
export async function fetchFormDefaults(
  slug: string,
  raw: unknown,
): Promise<QueryOutcome<FormDefaults>> {
  const parsed = z.object({ partyId: uuid }).safeParse(raw)
  if (!parsed.success) return invalid(parsed.error)
  return withReader(slug, (tenantId) => getFormDefaults(tenantId, parsed.data.partyId))
}

/** Los chips de «¿En qué?» de «Nuevo gasto». */
export async function fetchQuickExpenseSuggestions(
  slug: string,
): Promise<QueryOutcome<QuickExpenseSuggestion[]>> {
  return withReader(slug, (tenantId) => getQuickExpenseSuggestions(tenantId))
}

const duplicateSchema = z.object({
  partyId: uuid.nullable(),
  totalCents: z.number().int().min(0).max(999_999_999_999),
  issueDate: isoDay,
  voucherType: z.string().max(40).nullable(),
  pointOfSale: z.number().int().min(0).max(99_999).nullable(),
  number: z.number().int().min(1).max(99_999_999).nullable(),
})

/** «¿No la cargaste ya?»: mismo número, o mismo proveedor y total en ±3 días. */
export async function checkPossibleDuplicate(
  slug: string,
  raw: unknown,
): Promise<QueryOutcome<PossibleDuplicate | null>> {
  const parsed = duplicateSchema.safeParse(raw)
  if (!parsed.success) return invalid(parsed.error)
  return withReader(slug, (tenantId) => findPossibleDuplicate(tenantId, parsed.data))
}
