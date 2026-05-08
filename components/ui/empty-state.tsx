import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card/50 px-6 py-14 text-center',
        className,
      )}
    >
      {Icon ? (
        <div className="mb-5 flex size-14 items-center justify-center rounded-full border border-primary/20 bg-[--cream-tint] text-primary shadow-2xs">
          <Icon className="size-6" aria-hidden />
        </div>
      ) : null}
      <p className="font-serif text-lg font-semibold tracking-tight text-foreground">{title}</p>
      {description ? (
        <p className="mt-2 max-w-sm text-sm text-muted-foreground text-pretty">{description}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}
