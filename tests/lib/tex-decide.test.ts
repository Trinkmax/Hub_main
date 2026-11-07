import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TexTicket } from '@/lib/tex/protocol'
import type { TexExecution } from '@/lib/tex/tools/types'

const run = vi.fn<(payload: unknown) => Promise<TexExecution>>()

vi.mock('@/lib/tex/registry', () => ({
  texExecutor: (name: string) => (name === 'de.prueba' ? { run } : null),
}))
vi.mock('@/lib/accounting/actions/documents', () => ({ undoDocument: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }))

const { applyDecisions, supersedePending } = await import('@/lib/tex/decide')

const ticket: TexTicket = {
  actionId: 'a1',
  kind: 'difusion',
  title: 'Difusión',
  subtitle: null,
  rows: [],
  total: { label: 'Le llega a', value: '10 personas' },
  entry: [],
  warnings: [],
  confirmLabel: 'Mandar a 10 personas',
  status: 'pending',
  result: null,
  error: null,
}

const action = {
  id: 'a1',
  threadId: 't1',
  toolUseId: 'tu_1',
  kind: 'difusion',
  status: 'pending' as const,
  payload: { executor: 'de.prueba', data: { telefono: '+5493510000000' } },
  ticket,
  documentId: null,
}

const thread = {
  id: 't1',
  pending: { order: ['tu_1'], results: {}, waiting: ['tu_1'] },
} as never

const ctx = { slug: 'hub', tenantId: 'x', userId: 'u' } as never

function fakeStore(claimed = true) {
  return {
    action: vi.fn(async () => action),
    claimAction: vi.fn(async () => claimed),
    updateAction: vi.fn(async () => undefined),
    updateThread: vi.fn(async () => undefined),
    threadActions: vi.fn(async () => [action]),
  }
}

const approve = [{ actionId: 'a1', approve: true }]
const done: TexExecution = {
  ok: true,
  message: 'Listo',
  href: null,
  point: null,
  undoUntil: null,
}

beforeEach(() => run.mockReset())

describe('confirmar un tique', () => {
  it('lo hace una sola vez: si otro pedido ya lo tomó, no corre y no le pisa la charla', async () => {
    const store = fakeStore(false)
    const outcome = await applyDecisions(approve, thread, store as never, ctx)
    expect(run).not.toHaveBeenCalled()
    expect(store.updateAction).not.toHaveBeenCalled()
    expect(store.updateThread).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ stillWaiting: true, results: null, events: [] })
  })

  it('lo toma antes de hacerlo', async () => {
    const store = fakeStore()
    const order: string[] = []
    store.claimAction.mockImplementation(async () => {
      order.push('tomar')
      return true
    })
    run.mockImplementation(async () => {
      order.push('hacer')
      return done
    })
    await applyDecisions(approve, thread, store as never, ctx)
    expect(order).toEqual(['tomar', 'hacer'])
  })

  it('una vez hecho no guarda lo que se iba a hacer: puede traer un teléfono', async () => {
    run.mockResolvedValue(done)
    const store = fakeStore()
    await applyDecisions(approve, thread, store as never, ctx)
    expect(store.updateAction).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({
        status: 'done',
        payload: { executor: 'de.prueba', data: null },
      }),
    )
  })

  it('si falla, tampoco', async () => {
    run.mockResolvedValue({ ok: false, kind: 'failed', message: 'No se pudo' })
    const store = fakeStore()
    await applyDecisions(approve, thread, store as never, ctx)
    expect(store.updateAction).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ status: 'failed', payload: { executor: 'de.prueba', data: null } }),
    )
  })

  it('«No» no corre nada, ni toma el tique, y vacía lo que se iba a hacer', async () => {
    const store = fakeStore()
    await applyDecisions([{ actionId: 'a1', approve: false }], thread, store as never, ctx)
    expect(run).not.toHaveBeenCalled()
    expect(store.claimAction).not.toHaveBeenCalled()
    expect(store.updateAction).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({
        status: 'declined',
        payload: { executor: 'de.prueba', data: null },
      }),
    )
  })

  it('si pide mirarlo de nuevo, el botón dice el número nuevo y se puede volver a confirmar', async () => {
    run.mockResolvedValue({
      ok: false,
      kind: 'review',
      message: 'La lista cambió',
      warnings: [{ key: 'reach_changed', title: 'Ahora le llega a 50', body: null }],
      ticket: {
        total: { label: 'Le llega a', value: '50 personas' },
        confirmLabel: 'Mandar a 50 personas',
      },
      payload: { promised_reach: 50 },
    })
    const store = fakeStore()
    const outcome = await applyDecisions(approve, thread, store as never, ctx)
    expect(store.updateAction).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({
        decided_at: null,
        payload: { executor: 'de.prueba', data: { promised_reach: 50 } },
        ticket: expect.objectContaining({
          status: 'pending',
          confirmLabel: 'Mandar a 50 personas',
          total: { label: 'Le llega a', value: '50 personas' },
        }),
      }),
    )
    expect(outcome.stillWaiting).toBe(true)
  })
})

describe('un tique que abre WhatsApp', () => {
  const withSend = {
    ...action,
    ticket: {
      ...ticket,
      confirmLabel: 'Mandar por WhatsApp',
      send: { href: 'https://wa.me/5493515551234?text=Hola', text: 'Hola' },
    },
  }
  const storeWith = () => ({
    ...fakeStore(),
    action: vi.fn(async () => withSend),
    threadActions: vi.fn(async () => [withSend]),
  })

  it.each([
    ['hecho', true, 'done'],
    ['con «No»', false, 'declined'],
  ] as const)('%s, el link con el teléfono del proveedor no queda guardado', async (_name, yes, status) => {
    run.mockResolvedValue(done)
    const store = storeWith()
    await applyDecisions([{ actionId: 'a1', approve: yes }], thread, store as never, ctx)
    expect(store.updateAction).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ status, ticket: expect.objectContaining({ send: null }) }),
    )
  })

  it('sin efecto, tampoco', async () => {
    const store = storeWith()
    await supersedePending(thread, store as never)
    expect(store.updateAction).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({
        status: 'superseded',
        ticket: expect.objectContaining({ send: null }),
      }),
    )
  })
})

describe('seguir hablando sin confirmar', () => {
  it('deja el tique sin efecto y sin lo que se iba a hacer', async () => {
    const store = fakeStore()
    await supersedePending(thread, store as never)
    expect(store.updateAction).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({
        status: 'superseded',
        payload: { executor: 'de.prueba', data: null },
      }),
    )
  })
})
