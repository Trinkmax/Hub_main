/**
 * Acciones de comprobantes (G.3, E.7): el camino completo con la base y el
 * permiso simulados. Lo que importa: que se guarde exactamente lo que se vio
 * (hash), que los avisos vuelvan todos juntos (del motor y de la base), que un
 * doble envío no duplique, y que los errores lleguen con su texto.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/accounting/access', () => ({ authorizeAccounting: vi.fn() }))
vi.mock('@/lib/accounting/server/document-context', () => ({
  loadDocumentContext: vi.fn(),
  loadFirstOpenDate: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { authorizeAccounting } from '@/lib/accounting/access'
import {
  postQuickExpense,
  previewBundle,
  undoDocument,
  voidDocument,
} from '@/lib/accounting/actions/documents'
import { buildTransfer } from '@/lib/accounting/posting'
import { loadDocumentContext } from '@/lib/accounting/server/document-context'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import type { QuickExpenseValues } from '@/lib/accounting/server/document-types'
import {
  parsePostBundleResult,
  parseReverseResult,
  parseVoidResult,
} from '@/lib/accounting/server/rpc-results'
import type { PostingContext } from '@/lib/accounting/types'
import { createClient } from '@/lib/supabase/server'
import { E4_QUICK, E5, prepare } from './accounting-fixtures'

const SLUG = 'hub'
const TENANT = '00000000-0000-4000-8000-0000000000aa'
const CLIENT_REF = '00000000-0000-4000-8000-0000000000bb'
const NBSP = ' '

type RpcResult = { data: unknown; error: unknown }
const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<RpcResult>>()

function allowWrite() {
  vi.mocked(authorizeAccounting).mockResolvedValue({
    ok: true,
    tenantId: TENANT,
    userId: '00000000-0000-4000-8000-0000000000cc',
    slug: SLUG,
    // El resto del acceso no lo usa la acción.
    access: {} as never,
  })
}

function useContext(ctx: PostingContext, firstOpenDate: string | null = null) {
  vi.mocked(loadDocumentContext).mockResolvedValue({ ok: true, ctx, firstOpenDate })
}

const SAVED = {
  bundle_id: 'b1',
  replayed: false,
  documents: [
    {
      ref: 'd1',
      id: '00000000-0000-4000-8000-0000000000d1',
      seq: '124',
      entry_id: 'e1',
      provisional_number: 57,
      lines: [{ line_no: 1, journal_line_id: 'l1' }],
    },
  ],
  allocations: [],
}

/** Lo que manda el formulario: los datos + el hash de la vista previa que vio la persona. */
function e4Values(ctx: PostingContext, r: ReturnType<typeof prepare>['r'], firstOpenDate?: string) {
  const values = { ...E4_QUICK.input(r), clientRef: CLIENT_REF } as QuickExpenseValues
  const preview = previewDocumentForm('quick_expense', values, ctx, { firstOpenDate })
  if (!preview.ok) throw new Error(preview.message)
  return { ...values, previewHash: preview.hash }
}

beforeEach(() => {
  vi.clearAllMocks()
  rpc.mockReset()
  vi.mocked(createClient).mockResolvedValue({ rpc } as never)
  allowWrite()
})

describe('guardar un comprobante (postQuickExpense)', () => {
  it('sin permiso devuelve el estado de la puerta y no toca la base', async () => {
    vi.mocked(authorizeAccounting).mockResolvedValue({
      ok: false,
      state: { ok: false, code: 'forbidden', message: 'No tenés permiso.' },
    })
    const state = await postQuickExpense(SLUG, {} as QuickExpenseValues)
    expect(state).toMatchObject({ ok: false, code: 'forbidden' })
    expect(loadDocumentContext).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('un importe en cero vuelve marcado en su campo', async () => {
    const { ctx, r } = prepare()
    useContext(ctx)
    const state = await postQuickExpense(SLUG, { ...e4Values(ctx, r), amountCents: 0 })
    expect(state.ok).toBe(false)
    if (state.ok) return
    expect(state.code).toBe('invalid')
    expect(state.fieldErrors?.amountCents).toBe('Tiene que ser mayor a cero.')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('guarda SU bundle con el hash de la vista previa, revalida y arma el toast', async () => {
    const { ctx, r } = prepare()
    useContext(ctx)
    rpc.mockResolvedValue({ data: SAVED, error: null })
    const values = e4Values(ctx, r)

    const state = await postQuickExpense(SLUG, values)

    expect(state.ok).toBe(true)
    if (!state.ok) return
    expect(rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = rpc.mock.calls[0] ?? []
    expect(fn).toBe('acc_post_bundle')
    expect(args).toMatchObject({ p_tenant_id: TENANT, p_client_ref: CLIENT_REF })
    const bundle = args?.p_bundle as { preview_hash: string; documents: Array<{ kind: string }> }
    expect(bundle.preview_hash).toBe(values.previewHash)
    expect(bundle.documents.map((d) => d.kind)).toEqual(['expense'])
    expect(state.result.documents[0]?.seq).toBe(124)
    expect(state.message).toBe(
      `Gasto cargado · $${NBSP}4.500 · Compras: bebidas sin alcohol · Caja`,
    )
    expect(revalidatePath).toHaveBeenCalledWith('/hub/administracion', 'layout')
  })

  it('si algo cambió desde la vista previa: preview_stale con el asiento y el hash nuevos', async () => {
    const { ctx, r } = prepare()
    useContext(ctx)
    const values = { ...e4Values(ctx, r), previewHash: 'a'.repeat(64) }
    const state = await postQuickExpense(SLUG, values)
    expect(state).toMatchObject({ ok: false, code: 'preview_stale' })
    if (state.ok) return
    expect(state.hash).toBe(e4Values(ctx, r).previewHash)
    expect(state.preview?.[0]?.balanced).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('fecha de un mes cerrado: se guarda el primer día abierto; sin ese dato, no se manda', async () => {
    const { ctx, r } = prepare()
    rpc.mockResolvedValue({ data: SAVED, error: null })
    // E4 es del 03/10; el primer día abierto (simulado) es el 10/10.
    useContext(ctx, '2026-10-10')

    // La vista previa ya lo sabía: se guarda con fecha contable 10/10.
    const moved = await postQuickExpense(SLUG, e4Values(ctx, r, '2026-10-10'))
    expect(moved.ok).toBe(true)
    const bundle = rpc.mock.calls[0]?.[1].p_bundle as {
      documents: Array<{ issue_date: string; accounting_date: string }>
    }
    expect(bundle.documents[0]).toMatchObject({
      issue_date: '2026-10-03',
      accounting_date: '2026-10-10',
    })

    // La vista previa no lo sabía: «Octubre está cerrado» con el asiento corregido para reenviar.
    const stale = await postQuickExpense(SLUG, e4Values(ctx, r))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(stale).toMatchObject({
      ok: false,
      code: 'conflict',
      detail: { key: 'period_closed', month: '2026-10', first_open_date: '2026-10-10' },
    })
    if (stale.ok) return
    expect(stale.message.startsWith('Octubre está cerrado.')).toBe(true)
    expect(stale.hash).toBe(e4Values(ctx, r, '2026-10-10').previewHash)
    expect(stale.preview?.[0]?.date).toBe('2026-10-10')
  })

  it('los avisos del motor vuelven juntos; aceptados, viajan en warnings_ack', async () => {
    const { ctx, r } = prepare()
    // La caja tiene $ 10: pagar $ 4.500 en efectivo la deja en negativo.
    const caja = [...ctx.treasuries.values()].find((t) => t.kind === 'cash')
    if (!caja) throw new Error('falta la caja')
    const tight: PostingContext = {
      ...ctx,
      treasuries: new Map(
        [...ctx.treasuries].map(([id, t]) => [
          id,
          id === caja.id ? { ...t, balanceCents: 1_000 } : t,
        ]),
      ),
    }
    useContext(tight)
    rpc.mockResolvedValue({ data: SAVED, error: null })
    const values = e4Values(tight, r)

    const first = await postQuickExpense(SLUG, values)
    expect(first).toMatchObject({ ok: false, code: 'needs_confirmation' })
    if (first.ok) return
    expect(first.warnings?.map((w) => w.key)).toEqual(['treasury_negative'])
    expect(first.warnings?.[0]?.message).toContain('Caja quedaría en')
    expect(rpc).not.toHaveBeenCalled()

    const second = await postQuickExpense(SLUG, { ...values, warningsAck: ['treasury_negative'] })
    expect(second.ok).toBe(true)
    const bundle = rpc.mock.calls[0]?.[1].p_bundle as {
      documents: Array<{ warnings_ack: string[] }>
    }
    expect(bundle.documents[0]?.warnings_ack).toEqual(['treasury_negative'])
  })

  it('los avisos que solo ve la base vuelven con el nombre de la caja', async () => {
    const { ctx, r } = prepare()
    useContext(ctx)
    const caja = [...ctx.treasuries.values()].find((t) => t.kind === 'cash')
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        message: 'warning_requires_ack',
        details: JSON.stringify({
          warnings: [
            { key: 'treasury_negative', treasury: caja?.id, balance_after_cents: -40_000_00 },
            'possible_duplicate',
          ],
        }),
      },
    })
    const state = await postQuickExpense(SLUG, e4Values(ctx, r))
    expect(state).toMatchObject({ ok: false, code: 'needs_confirmation' })
    if (state.ok) return
    expect(state.warnings?.map((w) => w.key)).toEqual(['treasury_negative', 'possible_duplicate'])
    expect(state.warnings?.[0]?.message).toBe(
      `Caja quedaría en −$${NBSP}40.000,00. ¿Falta cargar algún ingreso o el cierre del día?`,
    )
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('dos envíos iguales a la vez: reintenta y devuelve lo que guardó el primero', async () => {
    const { ctx, r } = prepare()
    useContext(ctx)
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint "abd_client_ref_uq"',
        },
      })
      .mockResolvedValueOnce({ data: { ...SAVED, replayed: true }, error: null })
    const state = await postQuickExpense(SLUG, e4Values(ctx, r))
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(state).toMatchObject({ ok: true, result: { replayed: true } })
  })

  it('un mes cerrado y una función sin desplegar llegan con su texto', async () => {
    const { ctx, r } = prepare()
    useContext(ctx)
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'period_closed', details: '2026-09' },
    })
    const closed = await postQuickExpense(SLUG, e4Values(ctx, r))
    expect(closed).toMatchObject({ ok: false, code: 'conflict' })

    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    })
    const missing = await postQuickExpense(SLUG, e4Values(ctx, r))
    expect(missing).toMatchObject({
      ok: false,
      message: 'Esta función todavía no está disponible. Actualizá la página en unos minutos.',
    })
  })
})

describe('vista previa en el servidor (previewBundle)', () => {
  it('da el mismo hash que el navegador y no escribe nada', async () => {
    const { ctx, r } = prepare(E5)
    useContext(ctx)
    const values = E5.input(r)
    const server = await previewBundle(SLUG, { form: 'quick_expense', values })
    const browser = previewDocumentForm('quick_expense', values, ctx)
    expect(server.ok && browser.ok).toBe(true)
    if (!server.ok || !browser.ok) return
    expect(server.hash).toBe(browser.hash)
    expect(server.preview.map((p) => p.kind)).toEqual(['purchase', 'payment'])
    expect(rpc).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('el navegador arma con la salida de zod: una referencia vacía da el mismo hash que ninguna', () => {
    const { ctx, r } = prepare()
    const base = {
      fromTreasuryId: r.treasury('caja'),
      toTreasuryId: r.treasury('banco'),
      amountCents: 50_000_000,
      date: '2026-10-05',
    }
    const empty = previewDocumentForm('transfer', { ...base, reference: '  ' }, ctx)
    const none = previewDocumentForm('transfer', { ...base, reference: null }, ctx)
    expect(empty.ok && none.ok).toBe(true)
    if (!empty.ok || !none.ok) return
    expect(empty.hash).toBe(none.hash)
    // Armar con el estado crudo (sin zod) daría otro hash: por eso los formularios usan previewDocumentForm.
    const raw = buildTransfer({ ...base, reference: '  ', notes: null, warningsAck: [] }, ctx, {
      clientRef: CLIENT_REF,
    })
    expect(raw.ok && raw.hash !== none.hash).toBe(true)
  })

  it('un formulario desconocido no llega a la base', async () => {
    const state = await previewBundle(SLUG, { form: 'otro', values: {} } as never)
    expect(state).toMatchObject({ ok: false, code: 'invalid' })
    expect(loadDocumentContext).not.toHaveBeenCalled()
  })
})

describe('anular y deshacer', () => {
  const DOC = '00000000-0000-4000-8000-0000000000d1'

  it('«Deshacer» anula todo el envío con la marca de undo', async () => {
    rpc.mockResolvedValue({
      data: { voided_document_ids: [DOC, 'd2'], unallocated_count: 0 },
      error: null,
    })
    const state = await undoDocument(SLUG, DOC)
    expect(rpc).toHaveBeenCalledWith('acc_void_document', {
      p_tenant_id: TENANT,
      p_document_id: DOC,
      p_reason: 'Deshacer',
      p_options: { with_bundle: true, unallocate: false, undo: true },
    })
    expect(state).toMatchObject({ ok: true, data: { voidedDocumentIds: [DOC, 'd2'] } })
    expect(revalidatePath).toHaveBeenCalledWith('/hub/administracion', 'layout')
  })

  it('con pagos aplicados avisa con la clave para volver a preguntar', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'document_has_allocations', details: null },
    })
    const state = await voidDocument(SLUG, { documentId: DOC, reason: 'Cargada dos veces' })
    expect(state).toMatchObject({
      ok: false,
      code: 'conflict',
      detail: { key: 'document_has_allocations' },
    })
  })

  it('el motivo corto no llega a la base', async () => {
    const state = await voidDocument(SLUG, { documentId: DOC, reason: 'no' })
    expect(state).toMatchObject({ ok: false, code: 'invalid' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('resultados de las RPC', () => {
  it('normaliza bigint como texto y tolera claves que faltan', () => {
    expect(parsePostBundleResult(SAVED).documents[0]).toMatchObject({
      seq: 124,
      provisional_number: 57,
    })
    expect(parsePostBundleResult(null)).toEqual({
      bundle_id: '',
      replayed: false,
      documents: [],
      allocations: [],
    })
    expect(parseVoidResult({ voided_document_ids: ['a'], unallocated_count: '2' })).toEqual({
      voidedDocumentIds: ['a'],
      unallocatedCount: 2,
    })
    expect(parseReverseResult({ reversal_id: 'r1', replayed: true })).toEqual({
      reversalDocumentId: 'r1',
      replayed: true,
    })
  })
})
