import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * El sello: «PAGADO», «DEBE = HABER». Es la marca de los papeles de oficina; con `thud` cae de golpe
 * cuando recién se hizo (solo ahí: un sello que se mueve siempre es ruido).
 */
export function Stamp({
  tone = 'ok',
  thud = false,
  className,
  children,
}: {
  tone?: 'ok' | 'warn' | 'bad'
  thud?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-block -rotate-3 rounded-[4px] border-[1.5px] border-current px-1.5 py-px text-[11px] font-bold tracking-wider whitespace-nowrap uppercase',
        tone === 'ok' && 'text-success',
        tone === 'warn' && 'text-warning-text',
        tone === 'bad' && 'text-destructive',
        thud && 'adm-thud',
        className,
      )}
    >
      {children}
    </span>
  )
}
