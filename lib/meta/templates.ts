import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import type { Database, Json, TemplateStatus } from '@/types/database'
import { decryptToken } from './crypto'
import { graphUrl } from './env'
import { metaFetch } from './http'

type ChannelRow = Database['public']['Tables']['channels']['Row']

type MetaTemplateStatus =
  | 'APPROVED'
  | 'IN_APPEAL'
  | 'PENDING'
  | 'REJECTED'
  | 'PENDING_DELETION'
  | 'DELETED'
  | 'DISABLED'
  | 'PAUSED'
  | 'LIMIT_EXCEEDED'

type MetaTemplate = {
  id: string
  name: string
  language: string
  category: string
  status: MetaTemplateStatus
  components?: unknown
}

type ListResponse = {
  data?: MetaTemplate[]
  paging?: { next?: string }
}

function mapStatus(s: MetaTemplateStatus): TemplateStatus {
  switch (s) {
    case 'APPROVED':
      return 'approved'
    case 'PENDING':
    case 'IN_APPEAL':
      return 'pending'
    case 'REJECTED':
      return 'rejected'
    case 'DISABLED':
    case 'PAUSED':
    case 'LIMIT_EXCEEDED':
    case 'PENDING_DELETION':
    case 'DELETED':
      return 'disabled'
    default:
      return 'pending'
  }
}

export async function syncTemplates(channel: ChannelRow): Promise<{ synced: number }> {
  if (channel.type !== 'whatsapp') return { synced: 0 }
  if (!channel.encrypted_access_token) {
    throw new Error('Channel has no token; reconnect required')
  }

  const accessToken = await decryptToken(channel.encrypted_access_token)
  const service = createServiceClient()
  const now = new Date().toISOString()

  let next: string | null = graphUrl(
    `${channel.external_account_id}/message_templates?fields=id,name,language,category,status,components&limit=200`,
  )
  let synced = 0

  while (next) {
    const res: ListResponse = await metaFetch<ListResponse>(next, { accessToken })
    const items = res.data ?? []
    for (const t of items) {
      const { error } = await service.from('message_templates').upsert(
        {
          tenant_id: channel.tenant_id,
          channel_id: channel.id,
          meta_template_id: t.id,
          name: t.name,
          language: t.language,
          category: t.category,
          components: (t.components ?? []) as Json,
          status: mapStatus(t.status),
          last_synced_at: now,
        },
        { onConflict: 'channel_id,name,language' },
      )
      if (error) throw new Error(`Template upsert failed: ${error.message}`)
      synced += 1
    }
    next = res.paging?.next ?? null
  }

  return { synced }
}
