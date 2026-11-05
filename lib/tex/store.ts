import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type { StoredBlock, StoredMessage } from './display'
import type { TexActionStatus, TexTicket } from './protocol'

/**
 * Las charlas con Tex en la base. Todo con la sesión de la persona: la RLS deja ver solo sus charlas.
 * Los mensajes solo se agregan, nunca se editan: la API de Claude rechaza una historia cambiada.
 */

/** Una charla sin mensajes hace este rato se da por terminada. */
const THREAD_IDLE_MS = 12 * 60 * 60 * 1000
/**
 * Con más contexto que esto se arranca otra charla. Lo fijo (instrucciones y herramientas) ya son unos
 * 60.000 tokens y va casi todo del caché; pasar los 100.000 quintuplica la tarifa, pero de una cifra
 * chiquita: importa más no cortarle la charla a nadie.
 */
const THREAD_MAX_CONTEXT_TOKENS = 140_000
const APPEND_RETRIES = 2

/** Lo que espera una confirmación: el resto de los resultados de ese turno de herramientas. */
export type TexPending = {
  /** El orden de los `tool_use` del turno: los resultados tienen que volver en ese orden. */
  order: string[]
  results: Record<string, StoredBlock>
  waiting: string[]
}

export type TexThread = {
  id: string
  title: string | null
  pending: TexPending | null
  lastScreenHash: string | null
  updatedAt: string
  lastContextTokens: number
}

export type TexActionRow = {
  id: string
  threadId: string
  toolUseId: string
  kind: string
  status: TexActionStatus
  payload: { executor: string; data: unknown }
  ticket: TexTicket
  documentId: string | null
}

type ThreadRow = {
  id: string
  title: string | null
  pending: TexPending | null
  last_screen_hash: string | null
  updated_at: string
  last_context_tokens: number
}

type ActionRow = {
  id: string
  thread_id: string
  tool_use_id: string
  kind: string
  status: TexActionStatus
  payload: { executor: string; data: unknown }
  ticket: TexTicket
  document_id: string | null
}

const THREAD_COLUMNS = 'id,title,pending,last_screen_hash,updated_at,last_context_tokens'
const ACTION_COLUMNS = 'id,thread_id,tool_use_id,kind,status,payload,ticket,document_id'

function toThread(row: ThreadRow): TexThread {
  return {
    id: row.id,
    title: row.title,
    pending: row.pending,
    lastScreenHash: row.last_screen_hash,
    updatedAt: row.updated_at,
    lastContextTokens: row.last_context_tokens,
  }
}

function toAction(row: ActionRow): TexActionRow {
  return {
    id: row.id,
    threadId: row.thread_id,
    toolUseId: row.tool_use_id,
    kind: row.kind,
    status: row.status,
    payload: row.payload,
    ticket: row.ticket,
    documentId: row.document_id,
  }
}

/** Error de la base, sin datos de la charla (CLAUDE.md §9). */
function fail(op: string, error: { code?: string | null }): Error {
  return new Error(`tex.store.${op}: ${error.code || 'red'}`)
}

export function threadIsStale(thread: TexThread, now = Date.now()): boolean {
  if (thread.pending) return false
  if (thread.lastContextTokens > THREAD_MAX_CONTEXT_TOKENS) return true
  return now - new Date(thread.updatedAt).getTime() > THREAD_IDLE_MS
}

export class TexStore {
  constructor(
    private readonly supabase: SupabaseClient,
    readonly tenantId: string,
    readonly userId: string,
  ) {}

  static async open(tenantId: string, userId: string): Promise<TexStore> {
    return new TexStore(await createClient(), tenantId, userId)
  }

  /** La charla de esta persona: la pedida o la última, si no quedó vieja. */
  async currentThread(requested: string | null): Promise<TexThread | null> {
    let query = this.supabase
      .from('acc_tex_threads')
      .select(THREAD_COLUMNS)
      .eq('tenant_id', this.tenantId)
      .eq('user_id', this.userId)
    query = requested
      ? query.eq('id', requested)
      : query.order('updated_at', { ascending: false }).limit(1)
    const { data, error } = await query.maybeSingle()
    if (error) throw fail('currentThread', error)
    if (!data) return null
    const thread = toThread(data as ThreadRow)
    return threadIsStale(thread) ? null : thread
  }

  async createThread(title: string | null): Promise<TexThread> {
    const { data, error } = await this.supabase
      .from('acc_tex_threads')
      .insert({
        tenant_id: this.tenantId,
        user_id: this.userId,
        title: title ? title.slice(0, 120) : null,
      })
      .select(THREAD_COLUMNS)
      .single()
    if (error) throw fail('createThread', error)
    return toThread(data as ThreadRow)
  }

  async messages(threadId: string): Promise<StoredMessage[]> {
    const { data, error } = await this.supabase
      .from('acc_tex_messages')
      .select('id,role,content')
      .eq('tenant_id', this.tenantId)
      .eq('thread_id', threadId)
      .order('seq', { ascending: true })
    if (error) throw fail('messages', error)
    return (data ?? []) as StoredMessage[]
  }

  async append(
    threadId: string,
    seq: number,
    role: 'user' | 'assistant',
    content: unknown,
  ): Promise<void> {
    // Perder un mensaje rompe la charla: si falla la red, se reintenta. Si el reintento choca con su
    // propio `seq`, el primero había entrado y solo se perdió la respuesta.
    for (let attempt = 0; ; attempt += 1) {
      const { error } = await this.supabase.from('acc_tex_messages').insert({
        thread_id: threadId,
        tenant_id: this.tenantId,
        user_id: this.userId,
        seq,
        role,
        content,
      })
      if (!error || (attempt > 0 && error.code === '23505')) return
      // Sin código de Postgres es la red, no un rechazo de la base.
      if (error.code || attempt >= APPEND_RETRIES) throw fail('append', error)
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    }
  }

  async updateThread(
    threadId: string,
    patch: Partial<{
      title: string
      pending: TexPending | null
      last_screen_hash: string | null
      last_context_tokens: number
    }>,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('acc_tex_threads')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('tenant_id', this.tenantId)
      .eq('id', threadId)
    if (error) throw fail('updateThread', error)
  }

  /** Suma lo consumido en un turno. Lo que no se pudo sumar no frena la charla. */
  async addUsage(
    threadId: string,
    usage: { input: number; cached: number; output: number; context: number },
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('acc_tex_threads')
      .select('input_tokens,cached_tokens,output_tokens')
      .eq('tenant_id', this.tenantId)
      .eq('id', threadId)
      .maybeSingle()
    if (error || !data) return
    const row = data as { input_tokens: number; cached_tokens: number; output_tokens: number }
    await this.supabase
      .from('acc_tex_threads')
      .update({
        input_tokens: Number(row.input_tokens) + usage.input,
        cached_tokens: Number(row.cached_tokens) + usage.cached,
        output_tokens: Number(row.output_tokens) + usage.output,
        last_context_tokens: usage.context,
      })
      .eq('tenant_id', this.tenantId)
      .eq('id', threadId)
  }

  async insertAction(input: {
    id: string
    threadId: string
    toolUseId: string
    kind: string
    payload: { executor: string; data: unknown }
    ticket: TexTicket
  }): Promise<void> {
    const { error } = await this.supabase.from('acc_tex_actions').insert({
      id: input.id,
      thread_id: input.threadId,
      tenant_id: this.tenantId,
      user_id: this.userId,
      tool_use_id: input.toolUseId,
      kind: input.kind,
      payload: input.payload,
      ticket: input.ticket,
    })
    if (error) throw fail('insertAction', error)
  }

  async action(actionId: string): Promise<TexActionRow | null> {
    const { data, error } = await this.supabase
      .from('acc_tex_actions')
      .select(ACTION_COLUMNS)
      .eq('tenant_id', this.tenantId)
      .eq('user_id', this.userId)
      .eq('id', actionId)
      .maybeSingle()
    if (error) throw fail('action', error)
    return data ? toAction(data as ActionRow) : null
  }

  async threadActions(threadId: string): Promise<TexActionRow[]> {
    const { data, error } = await this.supabase
      .from('acc_tex_actions')
      .select(ACTION_COLUMNS)
      .eq('tenant_id', this.tenantId)
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
    if (error) throw fail('threadActions', error)
    return ((data ?? []) as ActionRow[]).map(toAction)
  }

  /**
   * Toma un tique para hacerlo. Con dos pedidos a la vez (dos pestañas, un reintento) solo uno lo consigue: la base
   * vuelve a mirar el `where` cuando se libera la fila, así el mismo mensaje o el mismo pago no sale dos veces.
   * Si el pedido se corta después de tomarlo, el tique no se vuelve a hacer: la persona sigue hablando y Tex
   * mira cómo quedó, porque no hay forma de saber si llegó a escribirse.
   */
  async claimAction(actionId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('acc_tex_actions')
      .update({ decided_at: new Date().toISOString() })
      .eq('tenant_id', this.tenantId)
      .eq('user_id', this.userId)
      .eq('id', actionId)
      .eq('status', 'pending')
      .is('decided_at', null)
      .select('id')
    if (error) throw fail('claimAction', error)
    return (data ?? []).length > 0
  }

  async updateAction(
    actionId: string,
    patch: Partial<{
      status: TexActionStatus
      payload: { executor: string; data: unknown }
      ticket: TexTicket
      result: unknown
      document_id: string | null
      decided_at: string | null
    }>,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('acc_tex_actions')
      .update(patch)
      .eq('tenant_id', this.tenantId)
      .eq('user_id', this.userId)
      .eq('id', actionId)
    if (error) throw fail('updateAction', error)
  }
}
