import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type Breadcrumb = { label: string; href?: string }

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  children,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={cn('flex flex-col gap-4 pb-2', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="space-y-2">
          {eyebrow ? (
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {eyebrow}
            </div>
          ) : null}
          <h1 className="font-serif text-3xl font-semibold leading-tight tracking-[-0.015em] text-balance sm:text-[34px]">
            {title}
          </h1>
          {description ? (
            // div (no <p>): description acepta ReactNode y varios loading.tsx le
            // pasan <Skeleton> (un div) — div dentro de p es HTML inválido y
            // dispara errores de hidratación.
            <div className="max-w-2xl text-sm text-muted-foreground text-pretty">{description}</div>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}
