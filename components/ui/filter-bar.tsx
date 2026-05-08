import { Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function FilterBar({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-border/60 bg-card/40 p-2 sm:flex-row sm:items-center',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function FilterSearch({
  name = 'q',
  placeholder = 'Buscar…',
  defaultValue,
  className,
}: {
  name?: string
  placeholder?: string
  defaultValue?: string
  className?: string
}) {
  return (
    <label className={cn('relative flex flex-1 items-center', className)}>
      <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
      <input
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-transparent bg-background/40 pl-9 pr-3 text-sm shadow-none outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/40"
      />
    </label>
  )
}
