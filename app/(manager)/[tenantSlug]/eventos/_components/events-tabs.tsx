import Link from 'next/link'
import { cn } from '@/lib/utils'

const items: { key: 'upcoming' | 'past' | 'drafts'; label: string; ownerOnly?: boolean }[] = [
  { key: 'upcoming', label: 'Próximos' },
  { key: 'past', label: 'Pasados' },
  { key: 'drafts', label: 'Borradores', ownerOnly: true },
]

export function EventsTabs({
  tenantSlug,
  current,
  showDrafts,
}: {
  tenantSlug: string
  current: 'upcoming' | 'past' | 'drafts'
  showDrafts: boolean
}) {
  return (
    <nav className="flex gap-1 rounded-xl border border-border/60 bg-card/40 p-1 w-fit">
      {items
        .filter((it) => !it.ownerOnly || showDrafts)
        .map((it) => {
          const active = it.key === current
          return (
            <Link
              key={it.key}
              href={`/${tenantSlug}/eventos?tab=${it.key}`}
              className={cn(
                'rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {it.label}
            </Link>
          )
        })}
    </nav>
  )
}
