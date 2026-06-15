'use client'

import Link from 'next/link'
import type { ConversationTag } from '@/lib/conversation-tags/queries'
import { cn } from '@/lib/utils'

export function TagFilterBar({
  tags,
  tenantSlug,
  activeTagId,
}: {
  tags: ConversationTag[]
  tenantSlug: string
  activeTagId: string | null
}) {
  if (tags.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 border-b border-border/60 px-3 py-2">
      <Link
        href={`/${tenantSlug}/bandeja`}
        className={cn(
          'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
          activeTagId === null
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground',
        )}
        aria-current={activeTagId === null ? 'page' : undefined}
      >
        Todas
      </Link>
      {tags.map((tag) => {
        const isActive = activeTagId === tag.id
        return (
          <Link
            key={tag.id}
            href={`/${tenantSlug}/bandeja?tag=${tag.id}`}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
              isActive ? 'ring-2 ring-offset-1 ring-offset-background' : 'hover:opacity-80',
            )}
            style={{
              backgroundColor: isActive ? tag.color : `${tag.color}26`,
              color: isActive ? '#fff' : tag.color,
            }}
            aria-current={isActive ? 'page' : undefined}
          >
            <span
              className="size-1.5 rounded-full shrink-0"
              style={{ backgroundColor: isActive ? '#fff' : tag.color }}
              aria-hidden
            />
            {tag.name}
          </Link>
        )
      })}
    </div>
  )
}
