import 'server-only'

import { previewAudience } from '@/lib/audiences/actions'
import { type AudienceFilter, audienceFilterSchema } from '@/lib/audiences/schemas'
import { type ConversationDetail, getConversation, listConversations } from '@/lib/bandeja/queries'
import { visibleTemplates } from '@/lib/meta/template-visibility'
import { createClient } from '@/lib/supabase/server'
import type { TexToolContext } from '../types'
import { type AudienceReach, blockedFilter, optedInFilter, reachOf } from './_broadcast-values'
import {
  CONVERSATIONS_READ,
  type CustomerFlags,
  conversationNoMatchText,
  pickConversation,
} from './_chat-values'
import type { ChannelLike, TemplateRow } from './_template-values'

/**
 * Lo que varias herramientas del área necesitan leer. Todo con la sesión de la persona y filtrado por
 * bar: la RLS vuelve a decidir, y nada de acá toca el cliente de servicio.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Lo que se puede saber de un canal. Los tokens ni siquiera se piden. */
export const CHANNEL_COLUMNS =
  'id, type, status, display_name, connected_at, token_expires_at, last_error'

const TEMPLATE_COLUMNS =
  'id, name, language, category, status, channel_id, components, variable_hints, last_synced_at'

/** Lo máximo que devuelve la API de la base de una vez: una lectura que llega a esto puede estar cortada. */
export const API_ROWS_CAP = 1000

export type Found<T> = { ok: true; value: T } | { ok: false; message: string }

/** Las plantillas como las ve el bar: sin las de muestra de Meta ni las que no son en español. */
export async function listTemplates(ctx: Pick<TexToolContext, 'tenantId'>): Promise<TemplateRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('message_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('tenant_id', ctx.tenantId)
    .order('name', { ascending: true })
  if (error) throw new Error('tex.mensajeria.listTemplates')
  return visibleTemplates((data ?? []) as TemplateRow[])
}

export async function channelOf(
  ctx: Pick<TexToolContext, 'tenantId'>,
  channelId: string,
): Promise<ChannelLike> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('channels')
    .select('id, type, status')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', channelId)
    .maybeSingle()
  if (error) throw new Error('tex.mensajeria.channelOf')
  return (data ?? null) as ChannelLike
}

/** Si acepta promos y si está en «No contactar». Sin ficha (o borrada), `null`. */
export async function customerFlags(
  ctx: Pick<TexToolContext, 'tenantId'>,
  customerId: string | null,
): Promise<CustomerFlags | null> {
  if (!customerId) return null
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('customers')
    .select('opt_in_marketing, is_blocked')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', customerId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error('tex.mensajeria.customerFlags')
  return (data ?? null) as CustomerFlags | null
}

/** Una conversación por su id, su nombre o sus últimos dígitos. */
export async function findConversation(
  ctx: Pick<TexToolContext, 'tenantId'>,
  wanted: string,
): Promise<Found<ConversationDetail>> {
  const value = wanted.trim()
  if (!UUID_RE.test(value)) {
    const list = await listConversations(ctx.tenantId, { limit: CONVERSATIONS_READ })
    const match = pickConversation(list.rows, value)
    if (!match.ok) return { ok: false, message: conversationNoMatchText(match, value) }
    const found = await getConversation(ctx.tenantId, match.value.id)
    return found ? { ok: true, value: found } : { ok: false, message: 'Esa conversación no está.' }
  }
  const found = await getConversation(ctx.tenantId, value)
  return found ? { ok: true, value: found } : { ok: false, message: 'Esa conversación no está.' }
}

/**
 * ¿Salió recién el mismo mensaje? Un doble toque o el mismo tique armado dos veces no le puede llegar
 * dos veces a un cliente. Se compara acá y no en la consulta: un mensaje largo no entra en una URL. No
 * es una traba de la base: dos pedidos al mismo instante podrían pasar.
 */
export async function sameMessageJustSent(
  ctx: Pick<TexToolContext, 'tenantId'>,
  conversationId: string,
  content: string,
  nowMs: number,
): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('messages')
    .select('content')
    .eq('tenant_id', ctx.tenantId)
    .eq('conversation_id', conversationId)
    .eq('direction', 'outbound')
    .neq('status', 'failed')
    .gte('created_at', new Date(nowMs - 2 * 60 * 1000).toISOString())
    .limit(20)
  if (error) throw new Error('tex.mensajeria.sameMessageJustSent')
  return ((data ?? []) as Array<{ content: string | null }>).some((row) => row.content === content)
}

/**
 * Los que aceptan promos pero están en «No contactar»: la audiencia no tiene esa condición, así que se
 * restan. `null`: son demasiados para leerlos, y un número a ojo no sirve.
 */
export async function readBlockedIds(
  ctx: Pick<TexToolContext, 'tenantId'>,
): Promise<string[] | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('customers')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('is_blocked', true)
    .eq('opt_in_marketing', true)
    .is('deleted_at', null)
    .limit(API_ROWS_CAP)
  if (error) throw new Error('tex.mensajeria.readBlockedIds')
  const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id)
  return ids.length >= API_ROWS_CAP ? null : ids
}

/**
 * A cuántas personas le llega una lista, con las reglas de `materializeBroadcast`: de la audiencia,
 * los que aceptan promos y no están en «No contactar». Se cuenta con `previewAudience`, la acción que
 * usa el constructor de audiencias, porque la función de la base está cerrada para la sesión. El número
 * guardado en la audiencia no sirve: no se recalcula solo y puede estar muy viejo.
 */
export async function audienceReach(
  ctx: Pick<TexToolContext, 'tenantId' | 'slug'>,
  rawFilter: unknown,
  knownBlockedIds?: readonly string[] | null,
): Promise<Found<AudienceReach>> {
  const unreadable = {
    ok: false as const,
    message:
      'No pude contar a cuánta gente le llega esa lista: se revisa en Mensajería › Audiencias (ir_a a mensajeria.audiencias).',
  }
  const parsed = audienceFilterSchema.safeParse(rawFilter)
  if (!parsed.success) return unreadable
  const filter: AudienceFilter = parsed.data
  const blockedIds = knownBlockedIds === undefined ? await readBlockedIds(ctx) : knownBlockedIds
  if (blockedIds === null) return unreadable

  const [all, optedIn, optedInBlocked] = await Promise.all([
    previewAudience(ctx.slug, filter),
    previewAudience(ctx.slug, optedInFilter(filter)),
    blockedIds.length > 0
      ? previewAudience(ctx.slug, blockedFilter(filter, [...blockedIds]))
      : Promise.resolve({ ok: true as const, total: 0, sample: [] }),
  ])
  if (!all.ok || !optedIn.ok || !optedInBlocked.ok) return unreadable
  return { ok: true, value: reachOf(all.total, optedIn.total, optedInBlocked.total) }
}
