import 'server-only'

import { undoDocument } from '@/lib/accounting/actions/documents'
import { logAudit } from '@/lib/audit'
import { resultBlock, toolResultContent } from './loop'
import type { TexDecision, TexEvent, TexTicket } from './protocol'
import { texExecutor } from './registry'
import type { TexActionRow, TexPending, TexStore, TexThread } from './store'
import type { TexToolContext } from './tools/types'

/**
 * Lo único que escribe en los datos del bar: lo que la persona confirmó con un toque (o con un «sí»
 * escrito). Corre antes de abrir el stream, para que `revalidatePath` se aplique al terminar el pedido.
 */

export type DecisionsOutcome = {
  events: TexEvent[]
  /** Quedaron tiques sin decidir: Tex no sigue hasta entonces. */
  stillWaiting: boolean
  /** Si ya no queda nada esperando, los resultados para mandarle a Tex. */
  results: unknown[] | null
}

function auditPayload(action: TexActionRow, ticket: TexTicket): Record<string, unknown> {
  // Sin importes ni nombres: el tique queda en `acc_tex_actions`.
  return { kind: action.kind, status: ticket.status, action_id: action.id }
}

/**
 * Lo que se iba a hacer ya no hace falta una vez decidido, y puede traer el teléfono de un cliente: solo queda el
 * tique, que es lo que se le mostró a la persona.
 */
function spentPayload(action: TexActionRow): TexActionRow['payload'] {
  return { executor: action.payload.executor, data: null }
}

/** Otro pedido ya tomó este tique. */
const ALREADY_TAKEN = Symbol('ya tomado')

async function runDecision(
  decision: TexDecision,
  action: TexActionRow,
  store: Pick<TexStore, 'updateAction' | 'claimAction'>,
  ctx: TexToolContext,
): Promise<
  | { ticket: TexTicket; result: unknown | null; isError: boolean; wrote: boolean }
  | typeof ALREADY_TAKEN
> {
  const decidedAt = new Date().toISOString()
  const payload = spentPayload(action)

  if (!decision.approve) {
    const ticket: TexTicket = { ...action.ticket, status: 'declined' }
    await store.updateAction(action.id, {
      status: 'declined',
      ticket,
      payload,
      decided_at: decidedAt,
    })
    return {
      ticket,
      result: {
        hecho: false,
        motivo: 'Tocó «No». No se hizo nada.',
        que_sigue:
          'Decile en pocas palabras, de vos, que no se hizo. No ofrezcas volver a prepararlo.',
      },
      isError: false,
      wrote: false,
    }
  }

  if (!(await store.claimAction(action.id))) return ALREADY_TAKEN

  const executor = texExecutor(action.payload.executor)
  if (!executor) {
    const ticket: TexTicket = {
      ...action.ticket,
      status: 'failed',
      error: 'Este tique ya no se puede hacer.',
    }
    await store.updateAction(action.id, {
      status: 'failed',
      ticket,
      payload,
      decided_at: decidedAt,
    })
    return { ticket, result: ticket.error, isError: true, wrote: false }
  }

  const execution = await executor.run(action.payload.data, ctx)

  if (execution.ok) {
    const ticket: TexTicket = {
      ...action.ticket,
      status: 'done',
      warnings: [],
      result: {
        message: execution.message,
        href: execution.href,
        point: execution.point,
        undoUntil: execution.undoUntil,
        documentId: execution.documentId ?? null,
      },
      error: null,
    }
    await store.updateAction(action.id, {
      status: 'done',
      ticket,
      payload,
      result: execution.data ?? null,
      document_id: execution.documentId ?? null,
      decided_at: decidedAt,
    })
    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'tex.action.done',
      entity: 'acc_tex_action',
      entityId: action.id,
      payload: auditPayload(action, ticket),
    })
    return {
      ticket,
      result: {
        hecho: true,
        mensaje: execution.message,
        ...(execution.documentId ? { comprobante_id: execution.documentId } : {}),
        ...(execution.data ? { datos: execution.data } : {}),
        que_sigue:
          'Contalo en una línea. Si ayuda a verlo, llevá a la persona a la pantalla con ir_a y señalá lo que cambió.',
      },
      isError: false,
      wrote: true,
    }
  }

  if (execution.kind === 'review') {
    // Sigue pendiente, con lo nuevo a la vista: la persona lo tiene que ver antes de seguir.
    const ticket: TexTicket = {
      ...action.ticket,
      ...execution.ticket,
      status: 'pending',
      warnings: execution.warnings,
      entry: execution.entry ?? action.ticket.entry,
    }
    await store.updateAction(action.id, {
      ticket,
      payload: { executor: action.payload.executor, data: execution.payload },
      // Se vuelve a poder confirmar.
      decided_at: null,
    })
    return { ticket, result: null, isError: false, wrote: false }
  }

  const ticket: TexTicket = { ...action.ticket, status: 'failed', error: execution.message }
  await store.updateAction(action.id, {
    status: 'failed',
    ticket,
    payload,
    result: { error: execution.message },
    decided_at: decidedAt,
  })
  return { ticket, result: execution.message, isError: true, wrote: false }
}

/** Aplica lo que decidió la persona sobre los tiques que tenía adelante. */
export async function applyDecisions(
  decisions: readonly TexDecision[],
  thread: TexThread,
  store: Pick<TexStore, 'action' | 'updateAction' | 'updateThread' | 'claimAction'>,
  ctx: TexToolContext,
): Promise<DecisionsOutcome> {
  const events: TexEvent[] = []
  const pending: TexPending | null = thread.pending
  if (!pending) {
    return {
      events: [{ type: 'error', message: 'Ese tique ya no está pendiente.', retry: false }],
      stillWaiting: false,
      results: null,
    }
  }
  const results = { ...pending.results }
  let waiting = [...pending.waiting]
  let wrote = false
  let decided = false

  for (const decision of decisions) {
    const action = await store.action(decision.actionId)
    if (!action || action.threadId !== thread.id || action.status !== 'pending') continue
    if (!waiting.includes(action.toolUseId)) continue
    const outcome = await runDecision(decision, action, store, ctx)
    if (outcome === ALREADY_TAKEN) continue
    decided = true
    events.push({ type: 'ticket', ticket: outcome.ticket })
    wrote = wrote || outcome.wrote
    if (outcome.result === null) continue
    results[action.toolUseId] = resultBlock(
      action.toolUseId,
      typeof outcome.result === 'string' ? outcome.result : toolResultContent(outcome.result),
      outcome.isError,
    )
    waiting = waiting.filter((id) => id !== action.toolUseId)
  }

  if (wrote) {
    events.push({ type: 'mood', mood: 'happy' })
    events.push({ type: 'refresh' })
  }

  // Lo tomó otro pedido, y ese es el que sigue la charla: pisarle lo que está escribiendo la rompería.
  if (!decided) return { events, stillWaiting: true, results: null }

  if (waiting.length > 0) {
    await store.updateThread(thread.id, { pending: { order: pending.order, results, waiting } })
    return { events, stillWaiting: true, results: null }
  }
  await store.updateThread(thread.id, { pending: null })
  return { events, stillWaiting: false, results: pending.order.map((id) => results[id]) }
}

/**
 * La persona siguió hablando sin tocar los tiques: quedan sin efecto. Se le contesta a Tex para que
 * sepa que no se hizo nada; lo que escribió va en el mismo mensaje.
 */
export async function supersedePending(
  thread: TexThread,
  store: Pick<TexStore, 'action' | 'threadActions' | 'updateAction' | 'updateThread'>,
): Promise<{ results: unknown[]; events: TexEvent[] }> {
  const pending = thread.pending
  if (!pending) return { results: [], events: [] }
  const results = { ...pending.results }
  const events: TexEvent[] = []
  const actions = await store.threadActions(thread.id)
  for (const useId of pending.waiting) {
    results[useId] = resultBlock(
      useId,
      'No se hizo: la persona siguió hablando sin confirmar. Si todavía corresponde, volvé a prepararlo con lo que dijo.',
    )
    const action = actions.find((a) => a.toolUseId === useId)
    if (action) {
      const ticket: TexTicket = { ...action.ticket, status: 'superseded' }
      await store.updateAction(action.id, {
        status: 'superseded',
        ticket,
        payload: spentPayload(action),
        decided_at: new Date().toISOString(),
      })
      events.push({ type: 'ticket', ticket })
    }
  }
  await store.updateThread(thread.id, { pending: null })
  return { results: pending.order.map((id) => results[id]), events }
}

/** «Deshacer» del tique: los 10 minutos los controla la base. */
export async function undoAction(
  actionId: string,
  store: Pick<TexStore, 'action' | 'updateAction'>,
  ctx: TexToolContext,
): Promise<{ ok: boolean; message: string; ticket: TexTicket | null }> {
  const action = await store.action(actionId)
  if (!action || action.status !== 'done') {
    return { ok: false, message: 'Eso ya no se puede deshacer.', ticket: null }
  }
  if (!action.documentId)
    return { ok: false, message: 'Eso no se deshace desde acá.', ticket: null }
  const state = await undoDocument(ctx.slug, action.documentId)
  if (!state.ok) return { ok: false, message: state.message, ticket: null }
  const ticket: TexTicket = {
    ...action.ticket,
    status: 'undone',
    result: action.ticket.result ? { ...action.ticket.result, undoUntil: null } : null,
  }
  await store.updateAction(action.id, { status: 'undone', ticket })
  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'tex.action.undone',
    entity: 'acc_tex_action',
    entityId: action.id,
    payload: { kind: action.kind },
  })
  return { ok: true, message: state.message, ticket }
}
