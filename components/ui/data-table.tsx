import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function DataTableShell({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'card-hairline relative overflow-hidden rounded-xl border border-border/70 bg-card',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function DataTableScroll({
  children,
  maxHeight,
}: {
  children: ReactNode
  maxHeight?: string
}) {
  return (
    <div
      className="overflow-x-auto overflow-y-auto"
      style={maxHeight ? { maxHeight } : undefined}
    >
      {children}
    </div>
  )
}

export function DataTableRoot({ children }: { children: ReactNode }) {
  return <table className="w-full text-sm">{children}</table>
}

export function DataTableHead({
  children,
  sticky = false,
}: {
  children: ReactNode
  sticky?: boolean
}) {
  return (
    <thead
      className={cn(
        'border-b border-border/60 bg-secondary/40 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground',
        sticky && 'sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-secondary/70',
      )}
    >
      {children}
    </thead>
  )
}

export function DataTableHeader({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  return (
    <th scope="col" className={cn('px-4 py-2.5 font-semibold', className)}>
      {children}
    </th>
  )
}

export function DataTableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border/60">{children}</tbody>
}

export function DataTableRow({
  className,
  children,
  onClick,
}: {
  className?: string
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
        onClick
          ? 'cursor-pointer hover:bg-[--cream-tint]'
          : 'hover:bg-[--cream-tint]',
        className,
      )}
    >
      {children}
    </tr>
  )
}

export function DataTableCell({
  className,
  children,
  colSpan,
}: {
  className?: string
  children: ReactNode
  colSpan?: number
}) {
  return (
    <td colSpan={colSpan} className={cn('px-4 py-3 align-middle', className)}>
      {children}
    </td>
  )
}

export function DataTableFooter({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-t border-border/60 bg-secondary/30 px-4 py-2.5 text-xs text-muted-foreground',
        className,
      )}
    >
      {children}
    </div>
  )
}
