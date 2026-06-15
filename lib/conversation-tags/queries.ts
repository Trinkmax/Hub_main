import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type ConversationTag = {
  id: string
  name: string
  color: string
}

/** Todos los tags del vocabulario del tenant, ordenados por nombre. */
export async function listConversationTags(tenantId: string): Promise<ConversationTag[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('conversation_tags')
    .select('id, name, color')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })

  if (error) {
    console.error('[conversation-tags.listConversationTags]', error.message)
    return []
  }
  return (data ?? []) as ConversationTag[]
}

/**
 * Fetch en batch las etiquetas asignadas a un conjunto de conversaciones.
 * Devuelve un Map<conversationId, ConversationTag[]>.
 * Una sola query — sin N+1.
 */
export async function getTagsForConversationIds(
  tenantId: string,
  conversationIds: string[],
): Promise<Map<string, ConversationTag[]>> {
  const result = new Map<string, ConversationTag[]>()
  if (conversationIds.length === 0) return result

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('conversation_tag_assignments')
    .select(
      `
      conversation_id,
      tag:conversation_tags!inner(id, name, color, tenant_id)
    `,
    )
    .in('conversation_id', conversationIds)

  if (error) {
    console.error('[conversation-tags.getTagsForConversationIds]', error.message)
    return result
  }

  type Row = {
    conversation_id: string
    tag: { id: string; name: string; color: string; tenant_id: string } | null
  }

  for (const row of (data ?? []) as unknown as Row[]) {
    const tag = row.tag
    // Filtramos por tenant_id para no mezclar datos de otro tenant (doble check de seguridad)
    if (!tag || tag.tenant_id !== tenantId) continue
    const existing = result.get(row.conversation_id) ?? []
    existing.push({ id: tag.id, name: tag.name, color: tag.color })
    result.set(row.conversation_id, existing)
  }

  return result
}
