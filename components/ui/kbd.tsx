import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Kbd({ className, children, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 select-none items-center justify-center gap-0.5 rounded border border-border bg-muted/60 px-1.5 font-mono text-[10px] font-medium text-muted-foreground tracking-tight shadow-2xs',
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  )
}
