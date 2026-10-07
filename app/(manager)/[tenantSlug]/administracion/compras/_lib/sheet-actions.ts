'use server'

/**
 * Lecturas de los formularios de carga de Compras: las hojas «Nuevo gasto» y
 * «Pagar» y la factura de proveedor. Solo componen lecturas que ya existen
 * (`lib/accounting/context`, `lib/accounting/queries/*`): nada de SQL acá.
 *
 * Cada una vuelve a pedir acceso de ESCRITURA (CLAUDE.md §4.5:
 * `authorizeAccounting` = sesión + bar + rol + acceso por persona; son datos
 * para cargar, la contadora nunca ve estos formularios), valida la entrada y
 * nunca tira: devuelve `{ ok: false, message }` con el texto listo para
 * mostrar. Todo corre con la sesión del usuario: la RLS y `acc_assert_reader`
 * de cada RPC vuelven a decidir.
 */

import { z } from 'zod'
import { authorizeAccounting } from '@/lib/accounting/access'
import {
  AccountingContextError,
  buildPostingContext,
  loadOpenItems,
  loadPostingCatalog,
} from '@/lib/accounting/context'
import {
  findPossibleDuplicate,
  getFormDefaults,
  getQuickExpenseSuggestions,
} from '@/lib/accounting/queries/forms'
import { listPartyBalances } from '@/lib/accounting/queries/parties'
import { AccQueryError } from '@/lib/accounting/queries/shared'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import type {
  QuickSuggestion,
  SheetData,
  SheetDuplicate,
  SheetPartyDefaults,
  SheetPartyItems,
  SheetResult,
} from './sheet-types'

const LOAD_FAILED = 'No pudimos cargar los datos. Probá de nuevo; si sigue, avisanos.'

const uuid = z.uuid()

/** Sin datos personales en el log (CLAUDE.md §9): la operación y el tipo de error. */
function failure<T>(op: string, error: unknown): SheetResult<T> {
  if (error instanceof AccountingContextError) return { ok: false, message: error.state.message }
  if (error instanceof AccQueryError) return { ok: false, message: error.message }
  console.error(`[compras.sheet.${op}]`, error instanceof Error ? error.name : 'desconocido')
  return { ok: false, message: LOAD_FAILED }
}

/**
 * Una lectura que ayuda pero no es imprescindible (lo que el sistema recuerda,
 * los chips): si falla, la hoja sigue sin eso.
 */
async function optional<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise
  } catch {
    return fallback
  }
}

/**
 * Todo lo que necesita una hoja de carga al abrirse: el contexto del motor
 * (cuentas, cajas con saldo, partícipes) armado DESDE LA BASE, el primer día
 * abierto, las listas para los combos y, si se piden, los chips de «¿En qué?»
 * y los saldos de los proveedores.
 */
export async function loadSheetData(
  slug: string,
  opts: { suggestions?: boolean; balances?: boolean } = {},
): Promise<SheetResult<SheetData>> {
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return { ok: false, message: auth.state.message }
    const tenantId = auth.tenantId

    const [catalog, firstOpenDate, rawSuggestions, balances] = await Promise.all([
      loadPostingCatalog(tenantId),
      loadFirstOpenDate(tenantId),
      opts.suggestions === true
        ? optional(getQuickExpenseSuggestions(tenantId), [])
        : Promise.resolve([]),
      opts.balances === true
        ? optional(listPartyBalances(tenantId, { group: 'payables' }), null)
        : Promise.resolve(null),
    ])
    const ctx = buildPostingContext(catalog)

    const accountsById = new Map(catalog.accounts.map((a) => [a.id, a]))
    const partiesById = new Map(catalog.parties.map((p) => [p.id, p]))
    const treasuriesById = new Map(catalog.treasuries.map((t) => [t.id, t]))
    const suggestions: QuickSuggestion[] = []
    for (const s of rawSuggestions) {
      const account = accountsById.get(s.accountId)
      if (!account?.postable || !account.active) continue
      const treasury = s.treasuryAccountId ? treasuriesById.get(s.treasuryAccountId) : undefined
      const base = {
        accountId: account.id,
        label: s.label,
        treasuryAccountId: treasury?.active ? treasury.id : null,
        voucherType: s.voucherType,
      }
      if (s.type === 'party') {
        const party = s.partyId ? partiesById.get(s.partyId) : undefined
        if (!party?.active) continue
        suggestions.push({ type: 'party', partyId: party.id, ...base })
      } else {
        suggestions.push({ type: 'account', partyId: null, ...base })
      }
    }

    return {
      ok: true,
      data: {
        ctx,
        firstOpenDate,
        booksStartDate: catalog.settings.booksStartDate,
        today: catalog.today,
        treasuries: [...catalog.treasuries]
          .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'es'))
          .map((t) => ({
            id: t.id,
            name: t.name,
            kind: t.kind,
            balanceCents: t.balanceCents,
            active: t.active,
            allowNegative: t.allowNegative,
          })),
        parties: catalog.parties.map((p) => ({
          id: p.id,
          name: p.name,
          tradeName: p.tradeName,
          kind: p.kind,
          taxIdType: p.taxIdType,
          taxId: p.taxId,
          ivaCondition: p.ivaCondition,
          paymentTermDays: p.paymentTermDays,
          active: p.active,
          systemKey: p.systemKey,
          defaultAccountId: p.defaultAccountId,
          defaultVoucherType: p.defaultVoucherType,
          commissionVatMode: p.commissionVatMode,
          updatedAt: p.updatedAt,
        })),
        accounts: catalog.accounts.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          type: a.type,
          postable: a.postable,
          active: a.active,
          purchaseSelectable: a.purchaseSelectable,
          requiresParty: a.requiresParty,
          isTreasury: a.isTreasury,
          systemKey: a.systemKey,
          description: a.description,
        })),
        suggestions,
        balances,
        iibbJurisdictionCode: catalog.settings.iibbJurisdictionCode,
      },
    }
  } catch (error) {
    return failure('load', error)
  }
}

/** Lo que el sistema recuerda de un proveedor (H.5). `null` si todavía no hay nada que recordar. */
export async function loadPartyDefaults(
  slug: string,
  partyId: string,
): Promise<SheetResult<SheetPartyDefaults | null>> {
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return { ok: false, message: auth.state.message }
    if (!uuid.safeParse(partyId).success) return { ok: true, data: null }
    const d = await optional(getFormDefaults(auth.tenantId, partyId), null)
    if (!d) return { ok: true, data: null }
    return {
      ok: true,
      data: {
        accountId: d.accountId,
        voucherType: d.voucherType,
        vatRateBp: d.vatRateBp,
        pointOfSale: d.pointOfSale,
        lastNumber: d.lastNumber,
        treasuryAccountId: d.treasuryAccountId,
        paymentTermDays: d.paymentTermDays,
        suggestedTermDays: d.suggestedTermDays,
        medianTotalCents: d.medianTotalCents,
        cuitMissing: d.cuitMissing,
      },
    }
  } catch (error) {
    return failure('defaults', error)
  }
}

const partyItemsInput = z.object({
  partyId: uuid.nullish(),
  lineId: uuid.nullish(),
})

/**
 * Las partidas abiertas de un proveedor, con su pendiente de hoy (las mismas
 * que va a leer la acción al guardar). Con `lineId` (`?partida=`) se averigua
 * el proveedor por la partida.
 */
export async function loadPartyItems(
  slug: string,
  input: { partyId?: string | null; lineId?: string | null },
): Promise<SheetResult<SheetPartyItems>> {
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return { ok: false, message: auth.state.message }
    const parsed = partyItemsInput.safeParse(input)
    if (!parsed.success) return { ok: false, message: 'Elegí el proveedor.' }
    let partyId = parsed.data.partyId ?? null
    if (!partyId && parsed.data.lineId) {
      const [item] = await loadOpenItems(auth.tenantId, { lineIds: [parsed.data.lineId] })
      partyId = item?.partyId ?? null
    }
    if (!partyId) {
      return { ok: false, message: 'Ese comprobante ya no está pendiente. Elegí el proveedor.' }
    }
    const items = await loadOpenItems(auth.tenantId, { openItemsOf: [{ partyId }] })
    return { ok: true, data: { partyId, items } }
  } catch (error) {
    return failure('items', error)
  }
}

const duplicateInput = z.object({
  partyId: uuid.nullable(),
  totalCents: z.number().int().min(0).max(999_999_999_999),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  voucherType: z.string().max(40).nullable(),
  pointOfSale: z.number().int().min(0).max(99_999).nullable(),
  number: z.number().int().min(1).max(99_999_999).nullable(),
})

/** ¿Ya está cargado? (mismo PV-número, o mismo proveedor y total en pocos días). */
export async function findDuplicate(
  slug: string,
  params: {
    partyId: string | null
    totalCents: number
    issueDate: string
    voucherType: string | null
    pointOfSale: number | null
    number: number | null
  },
): Promise<SheetResult<SheetDuplicate | null>> {
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return { ok: false, message: auth.state.message }
    const parsed = duplicateInput.safeParse(params)
    if (!parsed.success) return { ok: true, data: null }
    const found = await optional(findPossibleDuplicate(auth.tenantId, parsed.data), null)
    return {
      ok: true,
      data: found
        ? {
            documentId: found.documentId,
            label: found.label,
            accountingDate: found.accountingDate ?? found.issueDate,
            totalCents: found.totalCents,
            partyName: found.partyName,
            match: found.match,
          }
        : null,
    }
  } catch (error) {
    return failure('duplicate', error)
  }
}
