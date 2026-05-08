import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Section({
  title,
  description,
  actions,
  className,
  children,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('space-y-3', className)}>
      {(title || actions) && (
        <header className="flex items-end justify-between gap-3">
          <div className="space-y-0.5">
            {title ? (
              <h2 className="font-display text-base font-semibold tracking-tight">{title}</h2>
            ) : null}
            {description ? (
              <p className="text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      )}
      {children}
    </section>
  )
}
