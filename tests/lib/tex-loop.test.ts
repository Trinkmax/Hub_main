import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { StoredMessage } from '@/lib/tex/display'
import { friendlyApiError, runTexLoop, toolResultContent, unansweredToolUses } from '@/lib/tex/loop'
import type { TexEvent } from '@/lib/tex/protocol'
import type { TexPending, TexThread } from '@/lib/tex/store'
import { defineTool, type TexToolContext } from '@/lib/tex/tools/types'

const CTX: TexToolContext = {
  slug: 'hub',
  tenantId: 't',
  tenantName: 'HUB',
  userId: 'u',
  isAccountant: false,
  access: { read: true, write: true, admin: false },
  today: '2026-11-05',
}

const THREAD: TexThread = {
  id: 'th',
  title: null,
  pending: null,
  lastScreenHash: null,
  updatedAt: new Date().toISOString(),
  lastContextTokens: 0,
}

type Block = Anthropic.ContentBlock

function message(content: unknown[], stop: string): Anthropic.Message {
  return {
    id: 'm',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: content as Block[],
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 90,
      cache_creation_input_tokens: 0,
    },
  } as unknown as Anthropic.Message
}

/** Un cliente que contesta con un libreto, en orden, y guarda lo que le pidieron. */
function fakeClient(turns: Anthropic.Message[], fail?: unknown) {
  const asked: Array<Record<string, unknown>> = []
  let index = 0
  const client = {
    messages: {
      stream: (params: Record<string, unknown>) => {
        asked.push(params)
        if (fail) throw fail
        const turn = turns[index] as Anthropic.Message
        index += 1
        return {
          async *[Symbol.asyncIterator]() {
            for (const block of turn.content) {
              if (block.type === 'text') {
                yield {
                  type: 'content_block_delta',
                  delta: { type: 'text_delta', text: block.text },
                }
              }
            }
          },
          finalMessage: async () => turn,
        }
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>
  return { client, asked }
}

function fakeStore() {
  const saved: Array<{ role: string; content: unknown }> = []
  const store = {
    saved,
    pending: null as TexPending | null,
    actions: [] as Array<Record<string, unknown>>,
    append: async (_thread: string, _seq: number, role: 'user' | 'assistant', content: unknown) => {
      saved.push({ role, content })
    },
    updateThread: async (_thread: string, patch: { pending?: TexPending | null }) => {
      if ('pending' in patch) store.pending = patch.pending ?? null
    },
    addUsage: vi.fn(async () => undefined),
    insertAction: async (action: Record<string, unknown>) => {
      store.actions.push(action)
    },
  }
  return store
}

const read = defineTool({
  name: 'ver_algo',
  description: 'x',
  input: z.object({ cuanto: z.number() }),
  need: 'read',
  doing: () => 'Mirando',
  done: () => 'Miré',
  run: async (input) => ({ kind: 'data', data: { doble: input.cuanto * 2 } }),
})

const write = defineTool({
  name: 'preparar_algo',
  description: 'x',
  input: z.object({}),
  need: 'write',
  doing: () => 'Preparando',
  done: () => 'Preparé',
  run: async () => ({
    kind: 'prepared',
    prepared: {
      executor: 'document',
      payload: { a: 1 },
      ticket: {
        kind: 'algo',
        title: 'Algo',
        subtitle: null,
        rows: [],
        total: null,
        entry: [],
        warnings: [],
        confirmLabel: 'Hacerlo',
      },
    },
  }),
})

const roto = defineTool({
  name: 'roto',
  description: 'x',
  input: z.object({}),
  need: 'read',
  doing: () => 'Mirando',
  done: () => 'Miré',
  run: async () => {
    throw new Error('datos privados: Juan Pérez')
  },
})

const navega = defineTool({
  name: 'navega',
  description: 'x',
  input: z.object({}),
  need: 'read',
  doing: () => 'Yendo',
  done: () => 'Fui',
  run: async () => ({
    kind: 'data',
    data: { listo: true },
    events: [{ type: 'navigate', href: '/hub/administracion/ventas', label: 'Ventas' }],
  }),
})

async function run(
  turns: Anthropic.Message[],
  options: { deadline?: number; fail?: unknown } = {},
) {
  const { client, asked } = fakeClient(turns, options.fail)
  const store = fakeStore()
  const events: TexEvent[] = []
  await store.append('th', 0, 'user', [{ type: 'text', text: 'hola' }])
  const history: StoredMessage[] = [
    { id: '0', role: 'user', content: [{ type: 'text', text: 'hola' }] },
  ]
  await runTexLoop(THREAD, history, {
    client,
    store,
    tools: [read, write, roto, navega],
    ctx: CTX,
    emit: (e) => events.push(e),
    deadline: options.deadline ?? Date.now() + 60_000,
    newId: () => 'accion-1',
  })
  return { store, events, asked }
}

const toolUse = (id: string, name: string, input: unknown = {}) => ({
  type: 'tool_use',
  id,
  name,
  input,
})

describe('el ciclo de Tex', () => {
  it('pide con Haiku 5.5, con caché, sin parámetros que la API rechaza', async () => {
    const { asked } = await run([message([{ type: 'text', text: 'Hola' }], 'end_turn')])
    const params = asked[0] as Record<string, unknown>
    expect(params.model).toBe('claude-haiku-5-5')
    expect(params.output_config).toEqual({ effort: 'medium' })
    expect(params.temperature).toBeUndefined()
    expect(params.top_p).toBeUndefined()
    expect(params.tool_choice).toBeUndefined()
    const system = params.system as Array<{ cache_control?: unknown }>
    expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' })
    const tools = params.tools as Array<{ eager_input_streaming?: boolean }>
    expect(tools.every((t) => t.eager_input_streaming)).toBe(true)
  })

  it('cada ronda le manda a la API la charla entera, en orden', async () => {
    const { asked } = await run([
      message([toolUse('t1', 'ver_algo', { cuanto: 1 })], 'tool_use'),
      message([{ type: 'text', text: 'Listo' }], 'end_turn'),
    ])
    const roles = (params: Record<string, unknown>) =>
      (params.messages as Array<{ role: string }>).map((m) => m.role)
    expect(roles(asked[1] as Record<string, unknown>)).toEqual(['user', 'assistant', 'user'])
  })

  it('anota lo consumido una sola vez por turno', async () => {
    const { store } = await run([
      message([toolUse('t1', 'ver_algo', { cuanto: 1 })], 'tool_use'),
      message([{ type: 'text', text: 'Listo' }], 'end_turn'),
    ])
    expect(store.addUsage).toHaveBeenCalledTimes(1)
    expect(store.addUsage).toHaveBeenCalledWith('th', {
      input: 20,
      cached: 180,
      output: 10,
      context: 100,
    })
  })

  it('una respuesta de texto se transmite y termina', async () => {
    const { events, store } = await run([message([{ type: 'text', text: 'Hola' }], 'end_turn')])
    expect(events).toContainEqual({ type: 'text', delta: 'Hola' })
    expect(events.at(-1)).toEqual({ type: 'done', waiting: false })
    expect(store.saved.at(-1)?.role).toBe('assistant')
  })

  it('usa la herramienta, le da el resultado y sigue', async () => {
    const { events, store, asked } = await run([
      message([toolUse('t1', 'ver_algo', { cuanto: 21 })], 'tool_use'),
      message([{ type: 'text', text: 'Son 42' }], 'end_turn'),
    ])
    expect(asked).toHaveLength(2)
    expect(events).toContainEqual({ type: 'step', id: 't1', label: 'Mirando', state: 'running' })
    expect(events).toContainEqual({ type: 'step', id: 't1', label: 'Miré', state: 'done' })
    const result = store.saved[2]?.content as Array<{ tool_use_id: string; content: string }>
    expect(result[0]).toMatchObject({ tool_use_id: 't1', content: '{"doble":42}' })
  })

  it('lo que dice en otra ronda va en otro párrafo', async () => {
    const { events } = await run([
      message(
        [{ type: 'text', text: 'Miro' }, toolUse('t1', 'ver_algo', { cuanto: 1 })],
        'tool_use',
      ),
      message([{ type: 'text', text: 'Listo' }], 'end_turn'),
    ])
    const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('')
    expect(text).toBe('Miro\n\nListo')
  })

  it('una entrada que no valida no corre: vuelve como error para que corrija', async () => {
    const { store } = await run([
      message([toolUse('t1', 'ver_algo', { cuanto: 'mucho' })], 'tool_use'),
      message([{ type: 'text', text: 'Perdón' }], 'end_turn'),
    ])
    const result = store.saved[2]?.content as Array<{ is_error?: boolean; content: string }>
    expect(result[0]?.is_error).toBe(true)
    expect(result[0]?.content).toContain('cuanto')
  })

  it('una herramienta que no existe tampoco', async () => {
    const { store } = await run([
      message([toolUse('t1', 'borrar_todo')], 'tool_use'),
      message([{ type: 'text', text: 'Perdón' }], 'end_turn'),
    ])
    const result = store.saved[2]?.content as Array<{ is_error?: boolean }>
    expect(result[0]?.is_error).toBe(true)
  })

  it('si una herramienta explota, Tex lo sabe pero no ve el error crudo', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { store, events } = await run([
      message([toolUse('t1', 'roto')], 'tool_use'),
      message([{ type: 'text', text: 'No pude' }], 'end_turn'),
    ])
    const result = store.saved[2]?.content as Array<{ is_error?: boolean; content: string }>
    expect(result[0]?.is_error).toBe(true)
    expect(result[0]?.content).not.toContain('Juan')
    expect(JSON.stringify(spy.mock.calls)).not.toContain('Juan')
    expect(events).toContainEqual({ type: 'step', id: 't1', label: 'Miré', state: 'error' })
    spy.mockRestore()
  })

  it('preparar algo NO sigue: guarda el tique y espera a la persona', async () => {
    const { events, store, asked } = await run([
      message([toolUse('t1', 'preparar_algo')], 'tool_use'),
    ])
    expect(asked).toHaveLength(1)
    expect(events.at(-1)).toEqual({ type: 'done', waiting: true })
    expect(events.find((e) => e.type === 'ticket')).toMatchObject({
      ticket: { actionId: 'accion-1', status: 'pending', title: 'Algo' },
    })
    expect(store.pending).toEqual({ order: ['t1'], results: {}, waiting: ['t1'] })
    expect(store.actions[0]).toMatchObject({
      id: 'accion-1',
      toolUseId: 't1',
      payload: { executor: 'document', data: { a: 1 } },
    })
    // Lo último guardado es de Tex: todavía no hay resultado para ese tique.
    expect(store.saved.at(-1)?.role).toBe('assistant')
  })

  it('si en la misma ronda mira y prepara, guarda lo mirado para cuando confirme', async () => {
    const { store } = await run([
      message(
        [toolUse('t1', 'ver_algo', { cuanto: 2 }), toolUse('t2', 'preparar_algo')],
        'tool_use',
      ),
    ])
    expect(store.pending?.order).toEqual(['t1', 't2'])
    expect(store.pending?.waiting).toEqual(['t2'])
    expect(store.pending?.results.t1).toMatchObject({ tool_use_id: 't1', content: '{"doble":4}' })
  })

  it('lo que mueve la pantalla sale como evento', async () => {
    const { events } = await run([
      message([toolUse('t1', 'navega')], 'tool_use'),
      message([{ type: 'text', text: 'Ahí está' }], 'end_turn'),
    ])
    expect(events).toContainEqual({
      type: 'navigate',
      href: '/hub/administracion/ventas',
      label: 'Ventas',
    })
  })

  it('una entrada cortada por max_tokens no se ejecuta', async () => {
    const { store, events } = await run([
      message([toolUse('t1', 'preparar_algo')], 'max_tokens'),
      message([{ type: 'text', text: 'Dale de a poco' }], 'end_turn'),
    ])
    expect(events.some((e) => e.type === 'ticket')).toBe(false)
    expect(store.actions).toHaveLength(0)
    const result = store.saved[2]?.content as Array<{ is_error?: boolean }>
    expect(result[0]?.is_error).toBe(true)
  })

  it('si la API se niega, no se ejecuta nada y se dice en una línea', async () => {
    const { events, store } = await run([message([toolUse('t1', 'preparar_algo')], 'refusal')])
    expect(store.actions).toHaveLength(0)
    expect(events.some((e) => e.type === 'text' && e.delta.includes('no lo puedo hacer'))).toBe(
      true,
    )
    expect(events.at(-1)).toEqual({ type: 'done', waiting: false })
  })

  it('si se acaba el tiempo, avisa para seguir en otro pedido', async () => {
    const { events, asked } = await run([], { deadline: Date.now() - 1 })
    expect(asked).toHaveLength(0)
    expect(events).toEqual([{ type: 'continue' }])
  })

  it('no da vueltas para siempre', async () => {
    const turns = Array.from({ length: 30 }, () =>
      message([toolUse('t1', 'ver_algo', { cuanto: 1 })], 'tool_use'),
    )
    const { events, asked } = await run(turns)
    expect(asked.length).toBeLessThanOrEqual(12)
    expect(events.at(-1)).toMatchObject({ type: 'error' })
  })
})

describe('una charla que la API ya no acepta', () => {
  it('no asusta a nadie: avisa a quien llama para que siga en otra', async () => {
    const bad = new Anthropic.BadRequestError(400, {}, 'history changed', new Headers())
    const { client } = fakeClient([], bad)
    const store = fakeStore()
    const events: TexEvent[] = []
    const outcome = await runTexLoop(THREAD, [{ id: '0', role: 'user', content: 'hola' }], {
      client,
      store,
      tools: [read],
      ctx: CTX,
      emit: (e) => events.push(e),
      deadline: Date.now() + 60_000,
    })
    expect(outcome).toBe('history_rejected')
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(store.saved).toHaveLength(0)
  })
})

describe('los errores de la API', () => {
  const headers = new Headers()
  it('nunca muestran el texto crudo', () => {
    const auth = new Anthropic.AuthenticationError(
      401,
      { error: 'sk-ant-secreto' },
      'sk-ant-secreto',
      headers,
    )
    expect(friendlyApiError(auth).message).not.toContain('sk-ant')
    expect(friendlyApiError(auth).retry).toBe(false)
  })

  it('el límite de pedidos y la red se pueden reintentar', () => {
    expect(friendlyApiError(new Anthropic.RateLimitError(429, {}, 'x', headers)).retry).toBe(true)
    expect(friendlyApiError(new Error('red')).retry).toBe(true)
  })

  it('una historia rechazada ofrece empezar otra charla', () => {
    expect(friendlyApiError(new Anthropic.BadRequestError(400, {}, 'x', headers)).restart).toBe(
      true,
    )
  })
})

describe('las herramientas sin responder de un pedido que se cortó', () => {
  it('se encuentran para poder seguir', () => {
    expect(
      unansweredToolUses([
        { id: '1', role: 'user', content: 'hola' },
        {
          id: '2',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }],
        },
      ]),
    ).toEqual(['t1'])
    expect(unansweredToolUses([{ id: '1', role: 'user', content: 'hola' }])).toEqual([])
    expect(unansweredToolUses([])).toEqual([])
  })
})

describe('lo que lee Tex de una herramienta', () => {
  it('tiene un tope y avisa que se cortó', () => {
    const text = toolResultContent({ filas: 'x'.repeat(20_000) })
    expect(text.length).toBeLessThan(15_000)
    expect(text).toContain('cortado')
  })
})
