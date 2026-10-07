'use server'

/**
 * Lecturas de las hojas de Ventas y Cajas (Cobrar, Mover plata, Ajustar saldo,
 * Otro ingreso o egreso). Las hojas se abren sobre cualquier pantalla de
 * Administración y traen sus datos al abrirse: esto solo compone lecturas que
 * ya existen en `lib/accounting` (sin SQL ni lógica de negocio).
 *
 * Cada una valida el acceso (CLAUDE.md §4.5: `authorizeAccounting` =
 * `requireTenantAccess` + `requireRole` + acceso por persona) y la entrada con
 * zod, y corre con la sesión del usuario: la RLS y `acc_assert_reader` de cada
 * RPC vuelven a decidir. Son datos para cargar: piden escritura (la contadora
 * nunca ve estas hojas). Nunca tiran: devuelven el mensaje listo para mostrar.
 */

import { z } from 'zod'
import { authorizeAccounting } from '@/lib/accounting/access'
import type { AccFailureState } from '@/lib/accounting/action-state'
import {
  AccountingContextError,
  buildPostingContext,
  loadOpenItems,
  loadPostingCatalog,
} from '@/lib/accounting/context'
import { getTreasuryCheck } from '@/lib/accounting/queries/forms'
import { listPartyBalances } from '@/lib/accounting/queries/parties'
import { AccQueryError } from '@/lib/accounting/queries/shared'
import { isoDay } from '@/lib/accounting/schemas'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import type { OpenItemRef } from '@/lib/accounting/types'
import type { CajasVentasCatalog, ReceivableSummary, SheetLoad, TreasuryCheckData } from './types'

const LOAD_FAILED = 'No pudimos cargar los datos. Probá de nuevo; si sigue, avisanos.'

function denied<T>(state: AccFailureState): SheetLoad<T> {
  return { ok: false, code: state.code, message: state.message }
}

function failed<T>(op: string, error: unknown): SheetLoad<T> {
  if (error instanceof AccountingContextError) return denied(error.state)
  if (error instanceof AccQueryError) return { ok: false, code: error.code, message: error.message }
  // Solo la operación y el nombre del error: nunca datos del bar ni de personas.
  console.error(
    `[administracion.cajas-ventas.${op}]`,
    error instanceof Error ? error.name : 'desconocido',
  )
  return { ok: false, code: 'error', message: LOAD_FAILED }
}

const uuid = z.uuid()

/**
 * El catálogo del bar para las hojas: el contexto del motor (cuentas, cajas
 * con su saldo, partícipes, medios) armado DESDE LA BASE, el primer día
 * abierto y las listas para los combos.
 */
export async function loadCajasVentasCatalog(slug: string): Promise<SheetLoad<CajasVentasCatalog>> {
  const auth = await authorizeAccounting(slug, 'write')
  if (!auth.ok) return denied(auth.state)
  try {
    const [catalog, firstOpenDate] = await Promise.all([
      loadPostingCatalog(auth.tenantId),
      loadFirstOpenDate(auth.tenantId),
    ])
    return {
      ok: true,
      data: {
        ctx: buildPostingContext(catalog),
        firstOpenDate,
        today: catalog.today,
        booksStartDate: catalog.settings.booksStartDate,
        treasuries: catalog.treasuries
          .filter((t) => t.active)
          .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'es'))
          .map((t) => ({
            id: t.id,
            accountId: t.accountId,
            name: t.name,
            kind: t.kind,
            balanceCents: t.balanceCents,
            bankPartyId: t.bankPartyId,
            allowNegative: t.allowNegative,
            alias: t.alias,
            bankName: t.bankName,
            lastCheckedOn: t.lastCheckedOn,
            active: t.active,
          })),
        accounts: catalog.accounts.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          type: a.type,
          postable: a.postable,
          active: a.active,
          requiresParty: a.requiresParty,
          isTreasury: a.isTreasury,
          systemKey: a.systemKey,
          description: a.description,
        })),
        parties: catalog.parties.map((p) => ({
          id: p.id,
          kind: p.kind,
          name: p.name,
          tradeName: p.tradeName,
          taxId: p.taxId,
          ivaCondition: p.ivaCondition,
          paymentTermDays: p.paymentTermDays,
          commissionVatMode: p.commissionVatMode,
          rates: p.rates,
          receivableAccountId: p.receivableAccountId,
          active: p.active,
          systemKey: p.systemKey,
        })),
        methods: catalog.methods.map((m) => ({
          id: m.id,
          name: m.name,
          kind: m.kind,
          channel: m.channel,
          treasuryAccountId: m.treasuryAccountId,
          partyId: m.partyId,
          settlementDays: m.settlementDays,
          active: m.active,
          systemKey: m.systemKey,
        })),
      },
    }
  } catch (error) {
    return failed('catalogo', error)
  }
}

/** Quién te debe (clientes, tarjetas, billeteras y plataformas), hoy. */
export async function loadReceivables(slug: string): Promise<SheetLoad<ReceivableSummary[]>> {
  const auth = await authorizeAccounting(slug, 'write')
  if (!auth.ok) return denied(auth.state)
  try {
    const rows = await listPartyBalances(auth.tenantId, { group: 'receivables' })
    return {
      ok: true,
      data: rows
        .filter((r) => r.debtCents > 0 || r.creditCents > 0)
        .map((r) => ({
          partyId: r.partyId,
          debtCents: r.debtCents,
          creditCents: r.creditCents,
          overdueCents: r.overdueCents,
          oldestDueDate: r.oldestDueDate,
        })),
    }
  } catch (error) {
    return failed('cobrables', error)
  }
}

/**
 * Las partidas abiertas de un cliente, tarjeta, billetera o plataforma en sus
 * cuentas «nos debe» (las ventas a cobrar del lado Debe; los saldos a favor y
 * lo que le debemos del lado Haber), con su abierto de hoy: las mismas que va
 * a leer la acción al guardar. Sin «IVA a documentar» (no es plata a cobrar).
 */
export async function loadPartyOpenItems(
  slug: string,
  partyId: string,
): Promise<SheetLoad<OpenItemRef[]>> {
  const auth = await authorizeAccounting(slug, 'write')
  if (!auth.ok) return denied(auth.state)
  const parsed = uuid.safeParse(partyId)
  if (!parsed.success) return { ok: false, code: 'invalid', message: 'Elegí quién te pagó.' }
  try {
    const [catalog, items] = await Promise.all([
      loadPostingCatalog(auth.tenantId),
      loadOpenItems(auth.tenantId, { openItemsOf: [{ partyId: parsed.data }] }),
    ])
    const party = catalog.parties.find((p) => p.id === parsed.data)
    if (!party) return { ok: false, code: 'invalid', message: 'Ese cliente no existe en este bar.' }
    const customers = catalog.accounts.find((a) => a.systemKey === 'receivable_customers')?.id
    const control = new Set([party.receivableAccountId, ...(customers ? [customers] : [])])
    return {
      ok: true,
      data: items
        .filter((item) => item.openCents > 0 && control.has(item.accountId))
        .sort(
          (a, b) =>
            (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
            a.entryDate.localeCompare(b.entryDate),
        ),
    }
  } catch (error) {
    return failed('partidas', error)
  }
}

const checkInput = z.object({ treasuryId: uuid, asOf: isoDay })

/** «Ajustar saldo»: el saldo de libro de una caja a una fecha y, en billeteras, lo que falta acreditar. */
export async function loadTreasuryCheck(
  slug: string,
  treasuryId: string,
  asOf: string,
): Promise<SheetLoad<TreasuryCheckData>> {
  const auth = await authorizeAccounting(slug, 'write')
  if (!auth.ok) return denied(auth.state)
  const parsed = checkInput.safeParse({ treasuryId, asOf })
  if (!parsed.success) return { ok: false, code: 'invalid', message: 'Elegí la caja y la fecha.' }
  try {
    const check = await getTreasuryCheck(auth.tenantId, {
      treasuryId: parsed.data.treasuryId,
      asOf: parsed.data.asOf,
    })
    if (!check) return { ok: false, code: 'invalid', message: 'Esa caja no existe en este bar.' }
    const pending = check.openWalletItems.filter((i) => i.openCents > 0)
    // Las partidas como las va a leer la acción (abierto de hoy): van al contexto de la vista previa.
    const refs =
      pending.length > 0
        ? await loadOpenItems(auth.tenantId, { lineIds: pending.map((i) => i.lineId) })
        : []
    const byId = new Map(refs.map((r) => [r.lineId, r]))
    return {
      ok: true,
      data: {
        bookCents: check.bookCents,
        lastAdjustmentDate: check.lastAdjustmentDate,
        walletItems: pending.flatMap((item) => {
          const ref = byId.get(item.lineId)
          return ref && ref.openCents > 0 && ref.side === 'debit'
            ? [{ ...ref, methodName: item.method }]
            : []
        }),
        estimates: check.estimates,
      },
    }
  } catch (error) {
    return failed('arqueo', error)
  }
}
