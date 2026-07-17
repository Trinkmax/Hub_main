'use client'

import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import type { ConversationListRow } from '@/lib/bandeja/queries'
import { buildListHref } from '@/lib/bandeja/utils'
import { formatPhoneForDisplay } from '@/lib/phone'
import { createClient } from '@/lib/supabase/browser'
import { cn } from '@/lib/utils'

function formatRelative(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'ahora'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  if (diff < 86_400_000 * 7) return `${Math.floor(diff / 86_400_000)}d`
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
}

export function ConversationList({
  conversations,
  tenantSlug,
  tenantId,
  selectedId,
  hasMore,
  currentN,
  selectedTag,
}: {
  conversations: ConversationListRow[]
  tenantSlug: string
  tenantId: string
  selectedId: string | null
  hasMore: boolean
  currentN: number
  selectedTag: string | null
}) {
  const router = useRouter()

  // Live updates: refresh the list whenever any conversation in this tenant changes
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`conversations-list:${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          router.refresh()
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [tenantId, router])

  if (conversations.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-10 text-center text-xs text-muted-foreground">
        Cuando un cliente te escriba, la charla aparece acá.
      </div>
    )
  }

  const loadMoreHref = buildListHref(tenantSlug, {
    n: currentN + 30,
    c: selectedId,
    tag: selectedTag,
  })

  return (
    <ul className="divide-y divide-border/40 overflow-y-auto">
      {conversations.map((c) => {
        const active = c.id === selectedId
        const display =
          c.customer_name ??
          (c.channel_type === 'whatsapp'
            ? formatPhoneForDisplay(c.external_user_id)
            : 'Cliente de Instagram')
        const initials = (display || '?').charAt(0).toUpperCase()
        const channelKey = c.channel_type === 'whatsapp' ? 'WA' : 'IG'
        return (
          <li key={c.id}>
            <Link
              href={`/${tenantSlug}/mensajeria/inbox?c=${c.id}`}
              className={cn(
                'flex items-start gap-3 px-3 py-3 transition-colors',
                active ? 'bg-primary/10' : 'hover:bg-secondary/40',
              )}
            >
              <div className="relative shrink-0">
                <Avatar className="size-9">
                  <AvatarFallback className="bg-secondary text-xs font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span
                  title={c.channel_type === 'whatsapp' ? 'WhatsApp' : 'Instagram'}
                  className={cn(
                    'absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-card px-0.5 text-[8px] font-bold leading-none',
                    c.channel_type === 'whatsapp'
                      ? 'bg-success text-success-foreground'
                      : 'bg-warning text-warning-foreground',
                  )}
                >
                  {channelKey}
                </span>
              </div>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      'truncate text-sm',
                      c.unread_count > 0 ? 'font-semibold text-foreground' : 'font-medium',
                    )}
                  >
                    {display}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {formatRelative(c.last_message_at)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      'truncate text-xs',
                      c.unread_count > 0
                        ? 'text-foreground/80 font-medium'
                        : 'text-muted-foreground',
                    )}
                  >
                    {c.preview ?? '—'}
                  </span>
                  {c.unread_count > 0 ? (
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold tabular-nums text-primary-foreground">
                      {c.unread_count}
                    </span>
                  ) : null}
                </div>
                {c.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {c.tags.map((tag) => (
                      <span
                        key={tag.id}
                        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium leading-5"
                        style={{ backgroundColor: `${tag.color}26`, color: tag.color }}
                      >
                        <span
                          className="size-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: tag.color }}
                          aria-hidden
                        />
                        {tag.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </Link>
          </li>
        )
      })}
      {hasMore ? (
        <li>
          <Link
            href={loadMoreHref}
            className="flex w-full items-center justify-center gap-1.5 px-3 py-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            <ChevronDown className="size-3.5" aria-hidden />
            Cargar más conversaciones
          </Link>
        </li>
      ) : null}
    </ul>
  )
}
