import 'server-only'

import Anthropic from '@anthropic-ai/sdk'
import type { StoredBlock, StoredMessage } from './display'
import { storedBlocks } from './display'
import { TEX_MODEL } from './model'
import type { TexEvent, TexMood, TexTicket } from './protocol'
import type { TexPending, TexStore, TexThread } from './store'
import {
  type TexTool,
  type TexToolContext,
  type TexToolResult,
  texApiTools,
  zodIssuesText,
} from './tools/types'

/**
 * El ciclo de Tex: pregunta, herramientas, pregunta, hasta que termina o hasta que espera un toque.
 *
 * Es un ciclo propio y no el «tool runner» del SDK porque se corta en el medio: cuando Tex prepara un
 * tique, el pedido HTTP termina y la charla queda esperando a la persona, a veces por horas. Al
 * confirmar llega otro pedido, se ejecuta y el ciclo sigue desde la base.
 */

const MAX_TOKENS = 16_000
/** Rondas de herramientas por turno: tope contra un Tex que da vueltas. */
const MAX_ROUNDS = 12
/** Lo que puede leer Tex de una sola herramienta. */
const MAX_TOOL_RESULT_CHARS = 14_000
/** Reintentos si llegó JSON roto en la entrada de una herramienta. */
const MAX_JSON_RETRIES = 2

/** `history_rejected`: la API no aceptó la charla guardada; no se dijo nada ni se guardó nada. */
export type TexLoopOutcome = 'finished' | 'history_rejected'

export type TexLoopDeps = {
  client: Pick<Anthropic, 'messages'>
  store: Pick<TexStore, 'append' | 'updateThread' | 'addUsage' | 'insertAction'>
  tools: readonly TexTool[]
  /** Las instrucciones para esta persona. */
  system: string
  ctx: TexToolContext
  emit: (event: TexEvent) => void
  /** Cuándo hay que soltar el pedido (Vercel lo corta a los 60 s). */
  deadline: number
  signal?: AbortSignal
  now?: () => number
  newId?: () => string
}

/** Lo que devuelve una herramienta, ya como texto para la API. */
export function toolResultContent(data: unknown, limit = MAX_TOOL_RESULT_CHARS): string {
  const text = JSON.stringify(data)
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}… (cortado: pedí menos filas o un período más corto)`
}

function resultBlock(
  toolUseId: string,
  content: string,
  isError = false,
): StoredBlock & {
  content: string
} {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content,
    ...(isError ? { is_error: true } : {}),
  }
}

/**
 * Si un pedido murió con herramientas sin responder, la API rechazaría lo que sigue: se les contesta
 * que se cortó. Se agrega, no se edita.
 */
export function unansweredToolUses(messages: readonly StoredMessage[]): string[] {
  const last = messages.at(-1)
  if (!last || last.role !== 'assistant') return []
  return storedBlocks(last.content)
    .filter((b) => b.type === 'tool_use' && b.id)
    .map((b) => b.id as string)
}

type ToolUse = Anthropic.ToolUseBlock

async function runOneTool(
  use: ToolUse,
  tool: TexTool | undefined,
  deps: TexLoopDeps,
): Promise<TexToolResult> {
  if (!tool) return { kind: 'error', message: `No existe la herramienta ${use.name}.` }
  const parsed = tool.input.safeParse(use.input)
  if (!parsed.success) {
    return { kind: 'error', message: `Revisá los datos: ${zodIssuesText(parsed.error)}` }
  }
  deps.emit({ type: 'mood', mood: tool.mood ?? 'reading' })
  deps.emit({ type: 'step', id: use.id, label: tool.doing(parsed.data), state: 'running' })
  let result: TexToolResult
  try {
    result = await tool.run(parsed.data, deps.ctx)
  } catch (error) {
    // Sin el contenido: puede traer datos de la charla (CLAUDE.md §9).
    console.error(`[tex.tool.${use.name}]`, error instanceof Error ? error.name : 'desconocido')
    const message =
      error instanceof Error && error.name === 'AccQueryError'
        ? error.message
        : 'No se pudo: falló la lectura.'
    result = { kind: 'error', message }
  }
  deps.emit({
    type: 'step',
    id: use.id,
    label: tool.done(parsed.data),
    state: result.kind === 'error' ? 'error' : 'done',
  })
  return result
}

/** Una ronda de herramientas. Lo que necesita un toque queda esperando en `pending`. */
async function runToolRound(
  uses: readonly ToolUse[],
  thread: TexThread,
  deps: TexLoopDeps,
): Promise<{ results: StoredBlock[]; pending: TexPending | null; tickets: TexTicket[] }> {
  const byName = new Map(deps.tools.map((t) => [t.name, t]))
  const outcomes = await Promise.all(uses.map((use) => runOneTool(use, byName.get(use.name), deps)))

  const results: Record<string, StoredBlock> = {}
  const waiting: string[] = []
  const tickets: TexTicket[] = []

  for (const [index, use] of uses.entries()) {
    const outcome = outcomes[index] as TexToolResult
    if (outcome.kind === 'error') {
      results[use.id] = resultBlock(use.id, outcome.message, true)
      continue
    }
    if (outcome.kind === 'data') {
      for (const event of outcome.events ?? []) deps.emit(event)
      results[use.id] = resultBlock(use.id, toolResultContent(outcome.data, outcome.limit))
      continue
    }
    const actionId = (deps.newId ?? crypto.randomUUID.bind(crypto))()
    const ticket: TexTicket = {
      ...outcome.prepared.ticket,
      actionId,
      status: 'pending',
      result: null,
      error: null,
    }
    await deps.store.insertAction({
      id: actionId,
      threadId: thread.id,
      toolUseId: use.id,
      kind: ticket.kind,
      payload: { executor: outcome.prepared.executor, data: outcome.prepared.payload },
      ticket,
    })
    waiting.push(use.id)
    tickets.push(ticket)
  }

  const order = uses.map((u) => u.id)
  if (waiting.length > 0) return { results: [], pending: { order, results, waiting }, tickets }
  return { results: order.map((id) => results[id] as StoredBlock), pending: null, tickets }
}

function apiMessages(messages: readonly StoredMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content as Anthropic.MessageParam['content'],
  }))
}

/** Un error de la API, en lo que tiene que ver y hacer la persona. Nunca el texto crudo. */
export function friendlyApiError(error: unknown): Extract<TexEvent, { type: 'error' }> {
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return {
      type: 'error',
      message:
        'No me puedo conectar: hay un problema con la clave de la API. Avisale a quien administra el sistema.',
      retry: false,
    }
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { type: 'error', message: 'Estoy con muchos pedidos. Probá en un minuto.', retry: true }
  }
  if (error instanceof Anthropic.BadRequestError) {
    return {
      type: 'error',
      message: 'Esta charla se me enredó. Empecemos otra: no se perdió nada de lo que cargaste.',
      retry: false,
      restart: true,
    }
  }
  if (error instanceof Anthropic.APIError) {
    return { type: 'error', message: 'Se me cortó la conexión. Probá de nuevo.', retry: true }
  }
  return {
    type: 'error',
    message: 'Algo no salió. Probá de nuevo: no se perdió nada.',
    retry: true,
  }
}

/**
 * Pide a Claude y sigue con las herramientas hasta que Tex termina, espera un toque o se acaba el
 * tiempo. `history` es la charla ya leída de la base: acá se va agrandando en memoria, porque cada
 * consulta de más se siente. Todo lo escrito en la base ya es definitivo: si este pedido se corta, el
 * siguiente sigue desde ahí.
 */
export async function runTexLoop(
  thread: TexThread,
  history: readonly StoredMessage[],
  deps: TexLoopDeps,
): Promise<TexLoopOutcome> {
  const consumed = { input: 0, cached: 0, output: 0, context: 0 }
  try {
    return await runRounds(thread, history, deps, consumed)
  } finally {
    // Lo consumido se anota una vez por turno, después de contestar.
    if (consumed.input + consumed.cached + consumed.output > 0) {
      await deps.store.addUsage(thread.id, {
        input: consumed.input,
        cached: consumed.cached,
        output: consumed.output,
        context: consumed.context,
      })
    }
  }
}

async function runRounds(
  thread: TexThread,
  history: readonly StoredMessage[],
  deps: TexLoopDeps,
  consumed: { input: number; cached: number; output: number; context: number },
): Promise<TexLoopOutcome> {
  const { client, store, tools, emit, signal } = deps
  const now = deps.now ?? Date.now
  const apiTools = texApiTools(tools)
  const messages: StoredMessage[] = [...history]
  let jsonRetries = 0
  /** Ya dijo algo en este turno: lo de la próxima ronda va en otro párrafo. */
  let saidSomething = false

  const save = async (role: 'user' | 'assistant', content: unknown) => {
    const seq = messages.length
    await store.append(thread.id, seq, role, content)
    messages.push({ id: String(seq), role, content: content as StoredMessage['content'] })
  }

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (now() > deps.deadline) {
      emit({ type: 'continue' })
      return 'finished'
    }
    emit({ type: 'mood', mood: 'thinking' })

    let message: Anthropic.Message
    try {
      const stream = client.messages.stream(
        {
          model: TEX_MODEL,
          max_tokens: MAX_TOKENS,
          system: [{ type: 'text', text: deps.system, cache_control: { type: 'ephemeral' } }],
          tools: apiTools,
          messages: apiMessages(messages),
          output_config: { effort: 'medium' },
          // Cachea también la charla: cada ronda reusa la anterior.
          cache_control: { type: 'ephemeral' },
        },
        { signal },
      )
      let spoke = false
      const askedAt = now()
      let firstByteMs: number | null = null
      for await (const event of stream) {
        firstByteMs ??= now() - askedAt
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          if (!spoke) {
            spoke = true
            emit({ type: 'mood', mood: 'listening' satisfies TexMood })
            if (saidSomething) emit({ type: 'text', delta: '\n\n' })
          }
          saidSomething = true
          emit({ type: 'text', delta: event.delta.text })
        }
      }
      message = await stream.finalMessage()
      jsonRetries = 0
      // Solo números: sirve para ver el costo y la demora en los logs, sin nada de la charla.
      console.info('[tex.turn]', {
        round,
        firstByteMs,
        totalMs: now() - askedAt,
        input: message.usage.input_tokens,
        cached: message.usage.cache_read_input_tokens ?? 0,
        created: message.usage.cache_creation_input_tokens ?? 0,
        output: message.usage.output_tokens,
        stop: message.stop_reason,
      })
    } catch (error) {
      if (signal?.aborted) return 'finished'
      // La API rechaza una charla si cambió algo de lo que ya se mandó: pasa con cada versión nueva de
      // las instrucciones o de las herramientas. Quien llama arranca otra, sin molestar a la persona.
      if (error instanceof Anthropic.BadRequestError && round === 0) return 'history_rejected'
      // JSON roto en la entrada de una herramienta: el turno no quedó guardado, se vuelve a pedir.
      if (!(error instanceof Anthropic.APIError) && jsonRetries < MAX_JSON_RETRIES) {
        jsonRetries += 1
        round -= 1
        continue
      }
      console.error('[tex.loop]', error instanceof Error ? error.name : 'desconocido')
      emit({ type: 'mood', mood: 'sad' })
      emit(friendlyApiError(error))
      return 'finished'
    }

    const usage = message.usage
    const cached = usage.cache_read_input_tokens ?? 0
    const created = usage.cache_creation_input_tokens ?? 0
    consumed.input += usage.input_tokens + created
    consumed.cached += cached
    consumed.output += usage.output_tokens
    consumed.context = usage.input_tokens + cached + created

    if (message.stop_reason === 'refusal') {
      emit({ type: 'mood', mood: 'sad' })
      emit({
        type: 'text',
        delta: 'Eso no lo puedo hacer. Si querés, contame de otra forma qué necesitás.',
      })
      emit({ type: 'done', waiting: false })
      return 'finished'
    }

    // Un turno sin contenido no se guarda: la API rechaza un mensaje vacío.
    if (message.content.length > 0) await save('assistant', message.content)

    // La búsqueda de herramientas corre del lado de la API: si se pausó, se le pide que siga.
    if (message.stop_reason === 'pause_turn') continue

    const uses = message.content.filter((b): b is ToolUse => b.type === 'tool_use')
    if (uses.length === 0) {
      emit({ type: 'mood', mood: 'listening' })
      emit({ type: 'done', waiting: false })
      return 'finished'
    }

    // Una entrada cortada por `max_tokens` puede parecer válida: no se ejecuta.
    if (message.stop_reason === 'max_tokens') {
      await save(
        'user',
        uses.map((u) =>
          resultBlock(u.id, 'Se cortó antes de terminar: hacelo en partes más chicas.', true),
        ),
      )
      continue
    }

    const round_ = await runToolRound(uses, thread, deps)
    if (round_.pending) {
      await store.updateThread(thread.id, { pending: round_.pending })
      for (const ticket of round_.tickets) emit({ type: 'ticket', ticket })
      emit({ type: 'mood', mood: 'listening' })
      emit({ type: 'done', waiting: true })
      return 'finished'
    }
    await save('user', round_.results)
  }

  emit({ type: 'mood', mood: 'sad' })
  emit({
    type: 'error',
    message: 'Di muchas vueltas y no llegué. Decime de otra forma qué necesitás.',
    retry: false,
  })
  return 'finished'
}

export type { ToolUse }
export { apiMessages, resultBlock }
