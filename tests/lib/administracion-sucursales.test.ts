/**
 * Administración por sucursal, entrega 1 (`.pendiente/CONTRATO.md`): la sucursal de cada comprobante viaja en
 * `acc_post_bundle` (y entra al hash solo cuando viene), la acción la valida con `branchForWrite`, los errores
 * nuevos de la base tienen su texto, «Cambiar de sucursal» llama a su RPC y los informes reciben `p_branch_id`.
 * Con la base, el permiso y la sucursal que se mira simulados (sin red).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/accounting/access', () => ({ authorizeAccounting: vi.fn() }))
vi.mock('@/lib/accounting/server/document-context', () => ({
  loadDocumentContext: vi.fn(),
  loadFirstOpenDate: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/branches/scope', () => ({ getBranchScope: vi.fn() }))

import { newTreasuryBranchId } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_lib/payloads'
import { buildQuickExpenseValues } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import { buildRecurringPayload } from '@/app/(manager)/[tenantSlug]/administracion/compras/gastos-fijos/[id]/_lib/form-payload'
import { authorizeAccounting } from '@/lib/accounting/access'
import { postQuickExpense, setDocumentBranch } from '@/lib/accounting/actions/documents'
import {
  createRecurringBulk,
  saveRecurringExpense,
  saveTreasuryAccount,
} from '@/lib/accounting/actions/master'
import {
  accBranchView,
  branchRpcParam,
  importBranchId,
  isEmptyBranchFilter,
  keepTreasuryForBranch,
  rpcBranchIdOfFilter,
  treasuriesForBranch,
  treasuryFitsBranch,
} from '@/lib/accounting/branch'
import { ACC_ERRORS, mapAccError } from '@/lib/accounting/errors'
import { buildQuickExpense, toRpcPayload, withDocumentBranch } from '@/lib/accounting/posting'
import { canonicalize } from '@/lib/accounting/preview'
import { getCashDaily } from '@/lib/accounting/queries/cash-flow'
import {
  getPartyStatement,
  listOpenItems,
  listPartyBalances,
} from '@/lib/accounting/queries/parties'
import { getPayrollReport } from '@/lib/accounting/queries/payroll'
import { listRecurringPayments } from '@/lib/accounting/queries/recurring'
import {
  getCashFlow,
  getCashProjection,
  listTreasuryBalances,
} from '@/lib/accounting/queries/treasury'
import { getWeekPlan } from '@/lib/accounting/queries/week-plan'
import { loadDocumentContext } from '@/lib/accounting/server/document-context'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import type { QuickExpenseValues } from '@/lib/accounting/server/document-types'
import type { PostingContext } from '@/lib/accounting/types'
import { getBranchScope } from '@/lib/branches/scope'
import type { BranchRef, BranchScope } from '@/lib/branches/types'
import { createClient } from '@/lib/supabase/server'
import { E4_QUICK, E5, prepare } from './accounting-fixtures'

const SLUG = 'hub'
const TENANT = '00000000-0000-4000-8000-0000000000aa'
const CLIENT_REF = '00000000-0000-4000-8000-0000000000bb'
const DOC_ID = '00000000-0000-4000-8000-0000000000d1'
const AC_ID = '6011ae59-1a30-4119-a45b-4152b1ba10ed'
const CERRO_ID = '6380c468-cf88-495c-a0f3-85e42279a355'
const OTHER_ID = '0f6b1f0e-0000-4000-8000-000000000003'

const branch = (id: string, name: string, isDefault: boolean): BranchRef => ({
  id,
  name,
  shortName: null,
  slug: name.toLowerCase(),
  color: '#2f5d50',
  address: null,
  position: isDefault ? 0 : 1,
  isDefault,
  openedOn: null,
  seatCapacity: null,
})
const AC = branch(AC_ID, 'Alta', true)
const CERRO = branch(CERRO_ID, 'Cerro', false)

/** Un dueño mirando una sucursal (o «Todas» con `current: null`). */
function scopeOf(current: BranchRef | null): BranchScope {
  const branches = [AC, CERRO]
  return {
    branches,
    current,
    isAll: current === null,
    ids: current ? [current.id] : branches.map((b) => b.id),
    unrestricted: true,
    multi: true,
    canAll: true,
    needsChoice: false,
    device: current,
    source: 'cookie',
  }
}

type RpcResult = { data: unknown; error: unknown }
const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<RpcResult>>()

/** Lo que leen las tablas: `select … eq … limit` sin filas. */
function emptyTable() {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'is', 'order', 'limit']) {
    chain[method] = () => chain
  }
  // biome-ignore lint/suspicious/noThenProperty: imita la promesa de PostgREST (`await query`)
  chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data: [], error: null })
  return chain
}

const SAVED = {
  bundle_id: 'b1',
  replayed: false,
  documents: [
    {
      ref: 'd1',
      id: DOC_ID,
      seq: '124',
      entry_id: 'e1',
      provisional_number: 57,
      lines: [{ line_no: 1, journal_line_id: 'l1' }],
    },
  ],
  allocations: [],
}

function useContext(ctx: PostingContext) {
  vi.mocked(loadDocumentContext).mockResolvedValue({ ok: true, ctx, firstOpenDate: null })
}

/** El formulario con la vista previa que vio la persona (con la sucursal que eligió, si eligió). */
function formValues(
  ctx: PostingContext,
  base: Record<string, unknown>,
  branchId?: string | null,
): QuickExpenseValues {
  const values = {
    ...base,
    clientRef: CLIENT_REF,
    ...(branchId !== undefined ? { branchId } : {}),
  } as QuickExpenseValues
  const preview = previewDocumentForm('quick_expense', values, ctx)
  if (!preview.ok) throw new Error(preview.message)
  return { ...values, previewHash: preview.hash }
}

beforeEach(() => {
  vi.clearAllMocks()
  rpc.mockReset()
  vi.mocked(createClient).mockResolvedValue({ rpc, from: () => emptyTable() } as never)
  vi.mocked(authorizeAccounting).mockResolvedValue({
    ok: true,
    tenantId: TENANT,
    userId: '00000000-0000-4000-8000-0000000000cc',
    slug: SLUG,
    access: {} as never,
  })
  vi.mocked(getBranchScope).mockResolvedValue(scopeOf(CERRO))
})

// ─── El comprobante lleva su sucursal ────────────────────────────────────────

describe('la sucursal en el bundle y en el hash', () => {
  it('con sucursal, cada comprobante la lleva en `branch_id`; sin ella, la clave no va', () => {
    const { ctx, r } = prepare()
    const base = E4_QUICK.input(r) as unknown as Record<string, unknown>
    const withBranch = previewDocumentForm(
      'quick_expense',
      { ...base, clientRef: CLIENT_REF, branchId: CERRO_ID },
      ctx,
    )
    const without = previewDocumentForm('quick_expense', { ...base, clientRef: CLIENT_REF }, ctx)
    expect(withBranch.ok && without.ok).toBe(true)
    if (!withBranch.ok || !without.ok) return
    // La vista previa firma la sucursal: otra sucursal es otro asiento para guardar.
    expect(withBranch.hash).not.toBe(without.hash)
    // Vacía es lo mismo que no mandarla (la decide la base).
    const nulled = previewDocumentForm(
      'quick_expense',
      { ...base, clientRef: CLIENT_REF, branchId: null },
      ctx,
    )
    expect(nulled.ok && nulled.hash).toBe(without.hash)
  })

  it('una compra con su pago (E5): los dos comprobantes quedan en la misma sucursal', async () => {
    const { ctx, r } = prepare()
    useContext(ctx)
    rpc.mockResolvedValue({ data: SAVED, error: null })
    const values = formValues(ctx, E5.input(r) as unknown as Record<string, unknown>, CERRO_ID)
    const state = await postQuickExpense(SLUG, values)
    expect(state.ok).toBe(true)
    const bundle = rpc.mock.calls[0]?.[1]?.p_bundle as {
      preview_hash: string
      documents: Array<Record<string, unknown>>
    }
    expect(bundle.documents.map((d) => [d.kind, d.branch_id])).toEqual([
      ['purchase', CERRO_ID],
      ['payment', CERRO_ID],
    ])
    expect(bundle.preview_hash).toBe(values.previewHash)
  })

  it('sin sucursal no se mira el alcance ni se manda la clave (lo de todo el bar: la decide la base)', async () => {
    const { ctx, r } = prepare()
    useContext(ctx)
    rpc.mockResolvedValue({ data: SAVED, error: null })
    const state = await postQuickExpense(
      SLUG,
      formValues(ctx, E4_QUICK.input(r) as unknown as Record<string, unknown>),
    )
    expect(state.ok).toBe(true)
    expect(getBranchScope).not.toHaveBeenCalled()
    const bundle = rpc.mock.calls[0]?.[1]?.p_bundle as { documents: Array<Record<string, unknown>> }
    expect(bundle.documents.every((d) => !('branch_id' in d))).toBe(true)
  })

  it('`withDocumentBranch` pone la sucursal donde falta, sin pisar la que ya tiene', () => {
    const { ctx, r } = prepare()
    const built = previewDocumentForm(
      'quick_expense',
      { ...(E5.input(r) as unknown as Record<string, unknown>), clientRef: CLIENT_REF },
      ctx,
    )
    expect(built.ok).toBe(true)
    const docs = [
      { kind: 'purchase', branchId: null },
      { kind: 'payment', branchId: AC_ID },
    ] as unknown as Parameters<typeof withDocumentBranch>[0]
    expect(withDocumentBranch(docs, CERRO_ID).map((d) => d.branchId)).toEqual([CERRO_ID, AC_ID])
    expect(withDocumentBranch(docs, null)).toBe(docs)
  })

  it('el motor la pone en cada comprobante, el payload la traduce 1:1 y el hash la firma', () => {
    const { ctx, r } = prepare()
    const withBranch = buildQuickExpense(E4_QUICK.input(r), ctx, {
      clientRef: CLIENT_REF,
      branchId: CERRO_ID,
    })
    const without = buildQuickExpense(E4_QUICK.input(r), ctx, { clientRef: CLIENT_REF })
    expect(withBranch.ok && without.ok).toBe(true)
    if (!withBranch.ok || !without.ok) return
    expect(withBranch.bundle.documents.map((d) => d.branchId)).toEqual([CERRO_ID])
    expect(toRpcPayload(withBranch.bundle, withBranch.hash).documents[0]?.branch_id).toBe(CERRO_ID)
    expect(canonicalize(withBranch.bundle)).toContain(`"branchId":"${CERRO_ID}"`)
    expect(without.bundle.documents.map((d) => d.branchId)).toEqual([null])
    expect('branch_id' in (toRpcPayload(without.bundle, without.hash).documents[0] ?? {})).toBe(
      false,
    )
    expect(canonicalize(without.bundle)).not.toContain('branchId')
  })
})

// ─── La acción valida la sucursal ────────────────────────────────────────────

describe('el motor: una caja de otra sucursal no paga lo de esta', () => {
  /** La caja en efectivo es de Alta Córdoba; Mercado Pago y el banco, de todo el bar. */
  function withBranches() {
    const prepared = prepare()
    const caja = prepared.f.treasury('caja')
    const treasuries = new Map(prepared.ctx.treasuries)
    treasuries.set(caja.id, { ...caja, branchId: AC_ID })
    return { ...prepared, ctx: { ...prepared.ctx, treasuries }, caja }
  }

  it('un gasto del Cerro con la caja de Alta Córdoba no se arma (lo dice antes de guardar)', () => {
    const { ctx, r } = withBranches()
    const base = {
      ...(E4_QUICK.input(r) as unknown as Record<string, unknown>),
      clientRef: CLIENT_REF,
    }
    const cerro = previewDocumentForm('quick_expense', { ...base, branchId: CERRO_ID }, ctx)
    expect(cerro).toMatchObject({
      ok: false,
      message: 'Esa caja es de otra sucursal. Elegí una de esta sucursal o de todo el bar.',
    })
    // En su sucursal, o sin sucursal elegida (decide la base), se arma igual que siempre.
    expect(previewDocumentForm('quick_expense', { ...base, branchId: AC_ID }, ctx).ok).toBe(true)
    expect(previewDocumentForm('quick_expense', base, ctx).ok).toBe(true)
  })

  it('una caja de todo el bar sirve en cualquier sucursal, y «Mover plata» puede cruzar sucursales', () => {
    const { ctx, r, caja } = withBranches()
    const mp = { ...(E5.input(r) as unknown as Record<string, unknown>), clientRef: CLIENT_REF }
    expect(previewDocumentForm('quick_expense', { ...mp, branchId: CERRO_ID }, ctx).ok).toBe(true)
    const transfer = previewDocumentForm(
      'transfer',
      {
        clientRef: CLIENT_REF,
        fromTreasuryId: caja.id,
        toTreasuryId: r.treasury('banco'),
        amountCents: 100_000,
        date: '2026-10-03',
        reference: null,
        branchId: CERRO_ID,
      },
      ctx,
    )
    expect(transfer.ok).toBe(true)
  })
})

describe('runPostDocument: la sucursal que no es de la persona', () => {
  it('vuelve como error del campo, sin leer el contexto ni tocar la base', async () => {
    vi.mocked(getBranchScope).mockResolvedValue({ ...scopeOf(AC), branches: [AC] })
    const { ctx, r } = prepare()
    const values = formValues(
      ctx,
      E4_QUICK.input(r) as unknown as Record<string, unknown>,
      CERRO_ID,
    )
    const state = await postQuickExpense(SLUG, values)
    expect(state).toMatchObject({
      ok: false,
      code: 'invalid',
      fieldErrors: { branchId: 'Esa sucursal no es tuya. Elegí otra.' },
    })
    expect(loadDocumentContext).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('un id roto no pasa el zod', async () => {
    const { ctx, r } = prepare()
    const values = formValues(ctx, E4_QUICK.input(r) as unknown as Record<string, unknown>)
    const state = await postQuickExpense(SLUG, { ...values, branchId: 'cerro' })
    expect(state).toMatchObject({ ok: false, code: 'invalid' })
    if (state.ok) return
    expect(state.fieldErrors?.branchId).toBe('Elegí la sucursal.')
  })

  it.each([
    ['branch_forbidden', 'No tenés acceso a esa sucursal.'],
    ['branch_not_found', 'Esa sucursal no existe o está apagada.'],
    ['recurring_branch_mismatch', 'Ese gasto fijo es de otra sucursal: se paga desde su sucursal.'],
  ])('lo que dice la base de la sucursal (%s) va al campo «Sucursal»', async (key, message) => {
    const { ctx, r } = prepare()
    useContext(ctx)
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: key, details: null } })
    const state = await postQuickExpense(
      SLUG,
      formValues(ctx, E4_QUICK.input(r) as unknown as Record<string, unknown>, CERRO_ID),
    )
    expect(state).toMatchObject({ ok: false, message, fieldErrors: { branchId: message } })
  })

  it('una caja de otra sucursal se dice con su texto (sin marcar la sucursal)', async () => {
    const { ctx, r } = prepare()
    useContext(ctx)
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'treasury_other_branch', details: null },
    })
    const state = await postQuickExpense(
      SLUG,
      formValues(ctx, E4_QUICK.input(r) as unknown as Record<string, unknown>, CERRO_ID),
    )
    expect(state).toMatchObject({
      ok: false,
      code: 'invalid',
      message: 'Esa caja es de otra sucursal. Elegí una de esta sucursal o de todo el bar.',
    })
    if (state.ok) return
    expect(state.fieldErrors?.branchId).toBeUndefined()
  })
})

describe('el catálogo de errores tiene las claves nuevas de la base', () => {
  it.each([
    ['branch_required', 'Elegí la sucursal.'],
    ['branch_forbidden', 'No tenés acceso a esa sucursal.'],
    ['branch_not_found', 'Esa sucursal no existe o está apagada.'],
    ['recurring_branch_mismatch', 'Ese gasto fijo es de otra sucursal: se paga desde su sucursal.'],
    [
      'treasury_other_branch',
      'Esa caja es de otra sucursal. Elegí una de esta sucursal o de todo el bar.',
    ],
    ['document_branch_general', 'Este comprobante es de todo el bar: no se cambia de sucursal.'],
  ] as const)('%s', (key, message) => {
    expect(ACC_ERRORS[key].message).toBe(message)
    expect(mapAccError({ code: 'P0001', message: key })).toMatchObject({ message, detail: { key } })
  })
})

// ─── «Cambiar de sucursal» ───────────────────────────────────────────────────

describe('setDocumentBranch', () => {
  it('llama a acc_set_document_branch con el bar de la URL y dice que cambió', async () => {
    rpc.mockResolvedValue({
      data: { ok: true, document_id: DOC_ID, branch_id: AC_ID, moved: true },
      error: null,
    })
    const state = await setDocumentBranch(SLUG, { documentId: DOC_ID, branchId: AC_ID })
    expect(rpc).toHaveBeenCalledWith('acc_set_document_branch', {
      p_tenant_id: TENANT,
      p_document_id: DOC_ID,
      p_branch_id: AC_ID,
      p_reason: null,
    })
    expect(state).toEqual({
      ok: true,
      data: { documentId: DOC_ID, branchId: AC_ID, moved: true },
      message: 'Listo: el comprobante cambió de sucursal.',
    })
  })

  it('ya era de esa sucursal: lo dice y no es un error', async () => {
    rpc.mockResolvedValue({
      data: { ok: true, document_id: DOC_ID, branch_id: AC_ID, moved: false },
      error: null,
    })
    const state = await setDocumentBranch(SLUG, { documentId: DOC_ID, branchId: AC_ID })
    expect(state).toMatchObject({ ok: true, message: 'Ya era de esa sucursal.' })
  })

  it('el zod frena un id roto o un motivo larguísimo (sin llamar a la base)', async () => {
    const bad = await setDocumentBranch(SLUG, { documentId: DOC_ID, branchId: 'cerro' })
    expect(bad).toMatchObject({
      ok: false,
      code: 'invalid',
      fieldErrors: { branchId: 'Elegí la sucursal.' },
    })
    const long = await setDocumentBranch(SLUG, {
      documentId: DOC_ID,
      branchId: AC_ID,
      reason: 'x'.repeat(301),
    })
    expect(long).toMatchObject({ ok: false, code: 'invalid' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('una sucursal que la persona no ve no se pide', async () => {
    const state = await setDocumentBranch(SLUG, { documentId: DOC_ID, branchId: OTHER_ID })
    expect(state).toMatchObject({
      ok: false,
      fieldErrors: { branchId: 'Esa sucursal no es tuya. Elegí otra.' },
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('un comprobante de todo el bar no se mueve: el texto de la base', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'document_branch_general', details: null },
    })
    const state = await setDocumentBranch(SLUG, { documentId: DOC_ID, branchId: AC_ID })
    expect(state).toMatchObject({
      ok: false,
      code: 'conflict',
      message: 'Este comprobante es de todo el bar: no se cambia de sucursal.',
    })
  })
})

// ─── Gastos fijos y cajas con sucursal ───────────────────────────────────────

const RECURRING_ROW = {
  id: '00000000-0000-4000-8000-0000000000e1',
  name: 'Alquiler',
  account_id: '00000000-0000-4000-8000-0000000000e2',
  frequency: 'monthly',
  due_day: 10,
  next_due_date: '2026-12-10',
  branch_id: CERRO_ID,
  updated_at: '2026-11-23T10:00:00Z',
}

describe('gastos fijos: la sucursal viaja en el guardado', () => {
  const create = {
    name: 'Alquiler',
    accountId: RECURRING_ROW.account_id,
    frequency: 'monthly',
    dueDay: 10,
    nextDueDate: '2026-12-10',
  }

  it('un alta lleva la sucursal elegida', async () => {
    rpc.mockResolvedValue({ data: RECURRING_ROW, error: null })
    const state = await saveRecurringExpense(SLUG, { ...create, branchId: CERRO_ID })
    expect(state.ok).toBe(true)
    const args = rpc.mock.calls[0]?.[1] as { p_expense: Record<string, unknown> }
    expect(args.p_expense.branch_id).toBe(CERRO_ID)
  })

  it('un alta sin sucursal va a la que se mira; en «Todas» sin elegir, la base pone la principal', async () => {
    rpc.mockResolvedValue({ data: RECURRING_ROW, error: null })
    await saveRecurringExpense(SLUG, create)
    expect(
      (rpc.mock.calls[0]?.[1] as { p_expense: Record<string, unknown> }).p_expense.branch_id,
    ).toBe(CERRO_ID)
    rpc.mockClear()
    vi.mocked(getBranchScope).mockResolvedValue(scopeOf(null))
    const state = await saveRecurringExpense(SLUG, create)
    expect(state.ok).toBe(true)
    expect(
      'branch_id' in (rpc.mock.calls[0]?.[1] as { p_expense: Record<string, unknown> }).p_expense,
    ).toBe(false)
  })

  it('una sucursal que la persona no tiene no se guarda', async () => {
    const state = await saveRecurringExpense(SLUG, { ...create, branchId: OTHER_ID })
    expect(state).toMatchObject({
      ok: false,
      fieldErrors: { branchId: 'Esa sucursal no es tuya. Elegí otra.' },
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('una edición sin sucursal no la toca', async () => {
    rpc.mockResolvedValue({ data: RECURRING_ROW, error: null })
    await saveRecurringExpense(SLUG, {
      id: RECURRING_ROW.id,
      expectedUpdatedAt: RECURRING_ROW.updated_at,
      ...create,
    })
    const args = rpc.mock.calls[0]?.[1] as { p_expense: Record<string, unknown> }
    expect('branch_id' in args.p_expense).toBe(false)
  })

  it('«Pegar una lista»: todos van a la sucursal elegida', async () => {
    rpc.mockResolvedValue({ data: { created: 2, skipped: [] }, error: null })
    const item = {
      name: 'Luz',
      accountId: RECURRING_ROW.account_id,
      dueDay: 10,
      nextDueDate: '2026-12-10',
    }
    const state = await createRecurringBulk(SLUG, {
      items: [item, { ...item, name: 'Gas' }],
      branchId: AC_ID,
    })
    expect(state.ok).toBe(true)
    const args = rpc.mock.calls[0]?.[1] as { p_items: Array<Record<string, unknown>> }
    expect(args.p_items.map((i) => i.branch_id)).toEqual([AC_ID, AC_ID])
  })

  it('la ficha manda la sucursal que tiene en pantalla', () => {
    const form = {
      id: null,
      updatedAt: null,
      name: 'Alquiler',
      partyId: null,
      accountId: RECURRING_ROW.account_id,
      voucherType: null,
      vatRateBp: null,
      amountCents: null,
      frequency: 'monthly' as const,
      dueDay: 10,
      nextDueDate: '2026-12-10',
      remindDaysBefore: 5,
      treasuryAccountId: null,
      active: true,
      notes: '',
      endsOn: null,
      installmentsTotal: null,
      breakdown: [],
    }
    const input = { initial: form, dues: null, lines: [] }
    expect(
      buildRecurringPayload({ ...input, form: { ...form, branchId: CERRO_ID } }),
    ).toMatchObject({
      branchId: CERRO_ID,
    })
    expect('branchId' in buildRecurringPayload({ ...input, form })).toBe(false)
  })
})

describe('cajas: de una sucursal o de todo el bar', () => {
  const TREASURY = {
    id: '00000000-0000-4000-8000-0000000000f1',
    account_id: '00000000-0000-4000-8000-0000000000f2',
    name: 'Caja del Cerro',
    kind: 'cash',
    branch_id: CERRO_ID,
    updated_at: '2026-11-23T10:00:00Z',
  }

  it('`null` explícito es «todo el bar»; una sucursal ajena no se pide; sin la clave, no se toca', async () => {
    rpc.mockResolvedValue({ data: TREASURY, error: null })
    await saveTreasuryAccount(SLUG, { name: 'Mercado Pago', kind: 'wallet', branchId: null })
    expect(
      (rpc.mock.calls[0]?.[1] as { p_treasury: Record<string, unknown> }).p_treasury,
    ).toMatchObject({
      branch_id: null,
    })
    rpc.mockClear()
    const forbidden = await saveTreasuryAccount(SLUG, {
      name: 'Caja',
      kind: 'cash',
      branchId: OTHER_ID,
    })
    expect(forbidden).toMatchObject({
      ok: false,
      fieldErrors: { branchId: 'Esa sucursal no es tuya. Elegí otra.' },
    })
    expect(rpc).not.toHaveBeenCalled()
    rpc.mockResolvedValue({ data: TREASURY, error: null })
    await saveTreasuryAccount(SLUG, { name: 'Caja', kind: 'cash' })
    expect(
      'branch_id' in (rpc.mock.calls[0]?.[1] as { p_treasury: Record<string, unknown> }).p_treasury,
    ).toBe(false)
  })

  it('una caja nueva: el efectivo es de un local; lo demás, de todo el bar', () => {
    expect(newTreasuryBranchId('cash', CERRO_ID)).toBe(CERRO_ID)
    expect(newTreasuryBranchId('wallet', CERRO_ID)).toBeNull()
    expect(newTreasuryBranchId('bank', CERRO_ID)).toBeNull()
    expect(newTreasuryBranchId('credit_card', CERRO_ID)).toBeNull()
  })
})

// ─── Qué cajas ofrece un formulario ──────────────────────────────────────────

describe('las cajas de un formulario según la sucursal', () => {
  const cajaCerro = { id: 'c1', branchId: CERRO_ID }
  const cajaAlta = { id: 'c2', branchId: AC_ID }
  const mp = { id: 'mp', branchId: null }
  const sinDato = { id: 'old' }
  const all: Array<{ id: string; branchId?: string | null }> = [cajaCerro, cajaAlta, mp, sinDato]

  it('las de esa sucursal y las de todo el bar; sin sucursal elegida, todas', () => {
    expect(treasuriesForBranch(all, CERRO_ID).map((t) => t.id)).toEqual(['c1', 'mp', 'old'])
    expect(treasuriesForBranch(all, AC_ID).map((t) => t.id)).toEqual(['c2', 'mp', 'old'])
    expect(treasuriesForBranch(all, null)).toEqual(all)
    expect(treasuryFitsBranch(undefined, CERRO_ID)).toBe(false)
  })

  it('al cambiar de sucursal, la caja elegida queda solo si sirve ahí', () => {
    expect(keepTreasuryForBranch(all, 'c1', CERRO_ID)).toBe('c1')
    expect(keepTreasuryForBranch(all, 'c1', AC_ID)).toBeNull()
    expect(keepTreasuryForBranch(all, 'mp', AC_ID)).toBe('mp')
    expect(keepTreasuryForBranch(all, null, AC_ID)).toBeNull()
  })

  it('«Nuevo gasto» y la tira de un gasto fijo mandan la sucursal solo si hay una', () => {
    const state = {
      amountCents: 100_000,
      target: { kind: 'account' as const, accountId: RECURRING_ROW.account_id },
      treasuryAccountId: 'c1',
      voucher: 'none' as const,
      vatRateBp: 2100 as const,
      vatAdjustCents: 0,
      pointOfSale: null,
      number: null,
      date: '2026-11-23',
      detail: '',
      recurringExpenseId: RECURRING_ROW.id,
    }
    expect(buildQuickExpenseValues({ ...state, branchId: CERRO_ID }).values).toMatchObject({
      branchId: CERRO_ID,
      recurringExpenseId: RECURRING_ROW.id,
    })
    expect('branchId' in (buildQuickExpenseValues(state).values ?? {})).toBe(false)
  })
})

// ─── Lo que se lee ───────────────────────────────────────────────────────────

describe('la sucursal que se mira, para las lecturas', () => {
  it('una sucursal → su id; «Todas» → sin filtro y sin `p_branch_id`', () => {
    expect(accBranchView(scopeOf(CERRO))).toMatchObject({
      filter: { ids: [CERRO_ID] },
      id: CERRO_ID,
    })
    expect(accBranchView(scopeOf(null))).toMatchObject({ filter: { ids: null }, id: null })
    expect(branchRpcParam(CERRO_ID)).toEqual({ p_branch_id: CERRO_ID })
    expect(branchRpcParam(null)).toEqual({})
  })

  it('lo que pide el navegador, ya recortado', () => {
    expect(rpcBranchIdOfFilter({ ids: [CERRO_ID] })).toBe(CERRO_ID)
    expect(rpcBranchIdOfFilter({ ids: [CERRO_ID, AC_ID] })).toBeNull()
    expect(rpcBranchIdOfFilter({ ids: null })).toBeNull()
    expect(isEmptyBranchFilter({ ids: [] })).toBe(true)
    expect(isEmptyBranchFilter({ ids: null })).toBe(false)
  })

  it('un lote importado: la sucursal de su caja; si es de todo el bar, la que se mira', () => {
    expect(importBranchId({ boxBranchId: AC_ID, viewedBranchId: CERRO_ID })).toBe(AC_ID)
    expect(importBranchId({ boxBranchId: null, viewedBranchId: CERRO_ID })).toBe(CERRO_ID)
    expect(importBranchId({ boxBranchId: null, viewedBranchId: null })).toBeNull()
  })
})

describe('los informes reciben `p_branch_id` (y sin sucursal, la firma de siempre)', () => {
  const calls = () => rpc.mock.calls.map(([fn, args]) => [fn, args.p_branch_id ?? 'sin'])

  beforeEach(() => {
    rpc.mockResolvedValue({ data: [], error: null })
  })

  it('Compras y pagos: saldos, partidas, estado de cuenta y plan de la semana', async () => {
    const party = '00000000-0000-4000-8000-000000000101'
    await listPartyBalances(TENANT, { group: 'payables', branchId: CERRO_ID })
    await listOpenItems(TENANT, { partyId: party, side: 'debt', branchId: CERRO_ID })
    await getPartyStatement(TENANT, {
      partyId: party,
      from: '2026-11-01',
      to: '2026-11-30',
      branchId: CERRO_ID,
    })
    await getWeekPlan(TENANT, '2026-11-23', CERRO_ID)
    await listPartyBalances(TENANT, { group: 'payables' })
    await getWeekPlan(TENANT, '2026-11-23')
    expect(calls()).toEqual([
      ['acc_report_party_balances', CERRO_ID],
      ['acc_report_open_items', CERRO_ID],
      ['acc_report_party_statement', CERRO_ID],
      ['acc_report_week_plan', CERRO_ID],
      ['acc_report_party_balances', 'sin'],
      ['acc_report_week_plan', 'sin'],
    ])
    expect('p_branch_id' in (rpc.mock.calls[4]?.[1] ?? {})).toBe(false)
  })

  it('Caja: saldos, día por día, flujo y proyección', async () => {
    await listTreasuryBalances(TENANT, { asOf: '2026-11-23', branchId: AC_ID })
    await getCashDaily(TENANT, { from: '2026-11-01', to: '2026-11-23', branchId: AC_ID })
    await getCashFlow(TENANT, { from: '2026-09-01', to: '2026-11-23', branchId: AC_ID })
    await getCashProjection(TENANT, { asOf: '2026-11-23', branchId: AC_ID })
    await getCashFlow(TENANT, { from: '2026-09-01', to: '2026-11-23' })
    expect(calls()).toEqual([
      ['acc_report_treasury_balances', AC_ID],
      ['acc_report_cash_daily', AC_ID],
      ['acc_report_cash_flow', AC_ID],
      ['acc_report_cash_projection', AC_ID],
      ['acc_report_cash_flow', 'sin'],
    ])
  })

  it('Gastos fijos: sus pagos y la fila de sueldos', async () => {
    rpc.mockImplementation(async (fn) =>
      fn === 'acc_report_payroll'
        ? { data: { employees: [], accrual: null }, error: null }
        : { data: [], error: null },
    )
    await listRecurringPayments(TENANT, CERRO_ID)
    await getPayrollReport(TENANT, '2026-11', CERRO_ID)
    await getPayrollReport(TENANT, '2026-11')
    expect(calls()).toEqual([
      ['acc_report_recurring_status', CERRO_ID],
      ['acc_report_payroll', CERRO_ID],
      ['acc_report_payroll', 'sin'],
    ])
  })
})
