import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { RateLimitedError, rateLimit } from '@/lib/rate-limit'
import { texContext } from '@/lib/tex/context'
import { applyDecisions, supersedePending } from '@/lib/tex/decide'
import {
  plainAnswer,
  type StoredBlock,
  type StoredMessage,
  storedBlocks,
  toDisplayItems,
} from '@/lib/tex/display'
import { texEnabled } from '@/lib/tex/enabled'
import { resultBlock, runTexLoop, unansweredToolUses } from '@/lib/tex/loop'
import {
  encodeTexEvent,
  type TexDecision,
  type TexEvent,
  type TexHistory,
  texRequestSchema,
} from '@/lib/tex/protocol'
import { attachmentBlock, readTexAttachment } from '@/lib/tex/read-attachment'
import { texAreasFor, texScreensForContext, texStepLabel, texToolsFor } from '@/lib/tex/registry'
import { TexStore, type TexThread } from '@/lib/tex/store'
import { contextBlock, screenHash, texSystemFor, whoIsTalking } from '@/lib/tex/system-prompt'
import type { TexTool, TexToolContext } from '@/lib/tex/tools/types'

/**
 * La charla con Tex, desde cualquier sección del panel. Es una ruta y no una server action porque responde de a poco (SSE) y porque
 * Next corre las server actions de a una por navegador: una charla larga frenaría el resto de la
 * pantalla.
 *
 * - Corre con la sesión de la persona: nunca `service_role`. Lo que puede ver y hacer lo deciden la
 *   RLS, las RPC y las acciones de siempre.
 * - `POST`: un mensaje, lo que decidió sobre los tiques o seguir un turno cortado.
 * - `GET`: lo que hay que dibujar de la charla actual.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Margen para soltar el pedido antes de que lo corte Vercel: el navegador lo sigue solo. */
const TURN_BUDGET_MS = 48_000
/** 40 mensajes cada 5 minutos por persona: alcanza de sobra y frena un error que se repite. */
const RATE_LIMIT = { limit: 40, windowMs: 5 * 60 * 1000 }

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/** Para el log: solo lo que seguro no trae datos de la charla (CLAUDE.md §9). */
function logText(error: unknown): string {
  if (!(error instanceof Error)) return 'desconocido'
  return error.message.startsWith('tex.store.') ? error.message : error.name
}

/** Lo último que dijo la persona (sin resultados de herramientas), para seguir en otra charla. */
function lastUserWords(history: readonly StoredMessage[]): StoredBlock[] | null {
  const last = history.at(-1)
  if (last?.role !== 'user') return null
  const blocks = storedBlocks(last.content).filter((block) => block.type === 'text')
  return blocks.length > 0 ? blocks : null
}

async function authorize(request: Request) {
  const slug = new URL(request.url).searchParams.get('slug')
  if (!slug || slug.length > 80) {
    return { ok: false as const, response: jsonError('Falta el bar.', 400) }
  }
  const auth = await texContext(slug)
  if (!auth.ok) return { ok: false as const, response: jsonError(auth.message, auth.status) }
  if (!texEnabled()) {
    return { ok: false as const, response: jsonError('Tex no está prendido.', 404) }
  }
  return { ok: true as const, ctx: auth.ctx }
}

/** Las instrucciones para esta persona: sus áreas, sus herramientas y sus pantallas. */
function systemFor(ctx: TexToolContext, tools: readonly TexTool[]): string {
  const usable = new Set(tools.map((tool) => tool.name))
  return texSystemFor(
    texAreasFor(ctx).map((area) => ({
      id: area.id,
      label: area.label,
      summary: area.summary,
      tools: area.tools.map((tool) => tool.name).filter((name) => usable.has(name)),
    })),
    texScreensForContext(ctx),
  )
}

export async function GET(request: Request) {
  const auth = await authorize(request)
  if (!auth.ok) return auth.response
  const { ctx } = auth
  try {
    const store = await TexStore.open(ctx.tenantId, ctx.userId)
    const thread = await store.currentThread(null)
    if (!thread) return NextResponse.json({ threadId: null, items: [] } satisfies TexHistory)
    const [messages, actions] = await Promise.all([
      store.messages(thread.id),
      store.threadActions(thread.id),
    ])
    const tickets = new Map(actions.map((a) => [a.toolUseId, a.ticket]))
    return NextResponse.json({
      threadId: thread.id,
      items: toDisplayItems(messages, tickets, texStepLabel),
    } satisfies TexHistory)
  } catch (error) {
    console.error('[tex.history]', logText(error))
    return jsonError('No pude traer la charla.', 500)
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request)
  if (!auth.ok) return auth.response
  const { ctx } = auth

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return jsonError('No entendí el pedido.', 400)
  }
  const parsed = texRequestSchema.safeParse(raw)
  if (!parsed.success) return jsonError('No entendí el pedido.', 400)
  const body = parsed.data
  // Leer papeles sirve para cargarlos: es de quien carga en Administración.
  if (body.attachment && !ctx.access.write) {
    return jsonError('No podés pasarme archivos: es para quien carga en Administración.', 403)
  }

  try {
    rateLimit({ key: `tex:${ctx.userId}`, ...RATE_LIMIT })
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return jsonError('Son muchos mensajes seguidos. Esperá un minuto.', 429)
    }
    throw error
  }

  const startedAt = Date.now()
  const early: TexEvent[] = []
  let thread: TexThread
  let store: TexStore
  let shouldRun = false
  /** La charla, tal como va quedando: el ciclo la sigue en memoria. */
  let history: StoredMessage[] = []
  /** Lo que escribió, con el adjunto: se guarda adentro del stream, porque leer la foto tarda. */
  let withAttachment: { blocks: unknown[]; leading: unknown[] } | null = null

  // Todo lo que escribe va ANTES de abrir el stream: así `revalidatePath` se aplica al responder.
  try {
    store = await TexStore.open(ctx.tenantId, ctx.userId)
    const requested = body.fresh ? null : body.threadId
    const existing = body.fresh ? null : await store.currentThread(requested)
    if (existing) {
      thread = existing
    } else {
      if (body.decisions.length > 0 || body.resume) {
        return jsonError('Esa charla ya terminó. Escribime de nuevo.', 409)
      }
      thread = await store.createThread(body.message ? body.message.slice(0, 80) : null)
    }
    if (thread.id !== body.threadId) {
      early.push({ type: 'thread', threadId: thread.id, fresh: !existing })
    }

    const messages: StoredMessage[] = await store.messages(thread.id)
    history = messages
    const appendUser = async (content: unknown) => {
      await store.append(thread.id, history.length, 'user', content)
      history = [
        ...history,
        { id: String(history.length), role: 'user', content: content as StoredMessage['content'] },
      ]
    }

    let decisions: readonly TexDecision[] = body.decisions
    if (body.message && thread.pending) {
      const answer = plainAnswer(body.message)
      if (answer) {
        const actions = await store.threadActions(thread.id)
        decisions = actions
          .filter((a) => a.status === 'pending' && thread.pending?.waiting.includes(a.toolUseId))
          .map((a) => ({ actionId: a.id, approve: answer === 'yes' }))
      }
    }

    if (decisions.length > 0) {
      const outcome = await applyDecisions(decisions, thread, store, ctx)
      early.push(...outcome.events)
      if (outcome.stillWaiting) {
        early.push({ type: 'done', waiting: true })
      } else if (outcome.results) {
        await appendUser(outcome.results)
        shouldRun = true
      } else {
        early.push({ type: 'done', waiting: false })
      }
    } else if (body.message) {
      const leading: unknown[] = []
      if (thread.pending) {
        const superseded = await supersedePending(thread, store)
        leading.push(...superseded.results)
        early.push(...superseded.events)
      } else {
        // Un pedido que se cortó dejó herramientas sin responder: la API no deja seguir sin eso.
        for (const useId of unansweredToolUses(messages)) {
          leading.push(resultBlock(useId, 'Se cortó antes de terminar y no se hizo.', true))
        }
      }
      const hash = screenHash(body.screen)
      const context = contextBlock({
        barName: ctx.tenantName,
        today: ctx.today,
        who: whoIsTalking(ctx.role, ctx.access.write),
        screen: body.screen,
        sameScreen: hash !== null && hash === thread.lastScreenHash,
      })
      const said = [
        { type: 'text', text: body.message },
        { type: 'text', text: context },
      ]
      if (body.attachment) {
        withAttachment = { blocks: said, leading }
      } else {
        await appendUser([...leading, ...said])
      }
      if (hash !== thread.lastScreenHash) {
        await store.updateThread(thread.id, { last_screen_hash: hash })
      }
      shouldRun = true
    } else if (body.resume) {
      if (thread.pending) {
        early.push({ type: 'done', waiting: true })
      } else {
        const dangling = unansweredToolUses(messages)
        if (dangling.length > 0) {
          await appendUser(
            dangling.map((useId) =>
              resultBlock(useId, 'Se cortó antes de terminar y no se hizo.', true),
            ),
          )
        }
        // Terminar en un mensaje de Tex no se puede: la API lo toma como que le completen la frase.
        shouldRun = dangling.length > 0 || messages.at(-1)?.role === 'user'
        if (!shouldRun) early.push({ type: 'done', waiting: false })
      }
    }
  } catch (error) {
    console.error('[tex.turn]', logText(error))
    return jsonError('Se me trabó algo. Probá de nuevo.', 500)
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const emit = (event: TexEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(encodeTexEvent(event)))
        } catch {
          closed = true
        }
      }
      for (const event of early) emit(event)
      if (shouldRun) {
        try {
          const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
          if (withAttachment && body.attachment) {
            const { name, mime, data } = body.attachment
            emit({ type: 'mood', mood: 'reading' })
            emit({ type: 'step', id: 'adjunto', label: `Leyendo ${name}`, state: 'running' })
            let reading: Awaited<ReturnType<typeof readTexAttachment>> = null
            try {
              reading = await readTexAttachment(client, { mime, data })
            } catch (error) {
              console.error('[tex.adjunto]', error instanceof Error ? error.name : 'desconocido')
            }
            emit({
              type: 'step',
              id: 'adjunto',
              label: reading ? `Leí ${name}` : `No pude leer ${name}`,
              state: reading ? 'done' : 'error',
            })
            const [said, ...rest] = withAttachment.blocks
            const content = [
              ...withAttachment.leading,
              said,
              { type: 'text', text: attachmentBlock(name, reading) },
              ...rest,
            ]
            await store.append(thread.id, history.length, 'user', content)
            history = [
              ...history,
              {
                id: String(history.length),
                role: 'user',
                content: content as StoredMessage['content'],
              },
            ]
          }
          const tools = texToolsFor(ctx)
          const deps = {
            client,
            store,
            tools,
            system: systemFor(ctx, tools),
            ctx,
            emit,
            deadline: startedAt + TURN_BUDGET_MS,
            signal: request.signal,
          }
          const outcome = await runTexLoop(thread, history, deps)
          if (outcome === 'history_rejected') {
            // La API exige la historia intacta, y una versión nueva del sistema la cambia. Lo que dijo
            // la persona sigue en otra charla; ella ni se entera.
            console.warn('[tex.history] charla rechazada: sigue en otra')
            const said = lastUserWords(history)
            if (said) {
              const fresh = await store.createThread(null)
              emit({ type: 'thread', threadId: fresh.id, fresh: true })
              await store.append(fresh.id, 0, 'user', said)
              const again = await runTexLoop(
                fresh,
                [{ id: '0', role: 'user', content: said }],
                deps,
              )
              if (again === 'history_rejected') {
                emit({ type: 'mood', mood: 'sad' })
                emit({
                  type: 'error',
                  message: 'Se me trabó algo. Probá de nuevo en un rato.',
                  retry: false,
                })
              }
            } else {
              // Era la respuesta a un tique: lo hecho, hecho está. Lo próximo arranca en otra charla.
              emit({ type: 'mood', mood: 'listening' })
              emit({ type: 'done', waiting: false })
            }
          }
        } catch (error) {
          console.error('[tex.stream]', logText(error))
          emit({ type: 'mood', mood: 'sad' })
          emit({
            type: 'error',
            message: 'Algo no salió. Probá de nuevo: no se perdió nada.',
            retry: true,
          })
        }
      }
      closed = true
      try {
        controller.close()
      } catch {
        // Ya se cerró: la persona se fue de la página.
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
