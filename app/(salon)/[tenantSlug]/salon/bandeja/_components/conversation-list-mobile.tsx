'use client'

import Link from 'next/link'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import type { ConversationListRow } from '@/lib/bandeja/queries'
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

/**
 * Lista vertical mobile-first de conversaciones — touch-friendly (rows altos),
 * tap navega al detalle como ruta separada (no split pane).
 */
export function ConversationListMobile({
  conversations,
  tenantSlug,
}: {
  conversations: ConversationListRow[]
  tenantSlug: string
}) {
  return (
    <ul className="card-hairline divide-y divide-border/50 overflow-hidden rounded-xl border border-border/70 bg-card">
      {conversations.map((c) => {
        const display = c.customer_name ?? c.external_user_id
        const initials = (display || '?').charAt(0).toUpperCase()
        const channelKey = c.channel_type === 'whatsapp' ? 'WA' : 'IG'
        const unread = c.unread_count > 0
        return (
          <li key={c.id}>
            <Link
              href={`/${tenantSlug}/salon/bandeja/${c.id}`}
              className="flex items-start gap-3 px-4 py-3.5 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[--cream-tint] active:bg-[--cream-tint]"
            >
              <div className="relative shrink-0">
                <Avatar className="size-11">
                  <AvatarFallback className="bg-secondary text-sm font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    'absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-card px-1 text-[9px] font-bold leading-none',
                    c.channel_type === 'whatsapp'
                      ? 'bg-success text-success-foreground'
                      : 'bg-warning text-warning-foreground',
                  )}
                  aria-hidden
                >
                  {channelKey}
                </span>
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      'truncate',
                      unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/90',
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
                      'truncate text-sm',
                      unread ? 'font-medium text-foreground/85' : 'text-muted-foreground',
                    )}
                  >
                    {c.preview ?? '—'}
                  </span>
                  {unread ? (
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold tabular-nums text-primary-foreground">
                      {c.unread_count}
                    </span>
                  ) : null}
                </div>
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
