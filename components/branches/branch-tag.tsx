'use client'

import { branchShortLabel } from '@/lib/branches/types'
import { cn } from '@/lib/utils'
import { BranchAwning } from './awning'
import { useBranchScope } from './branch-scope-provider'
import './branches.css'

/**
 * De qué sucursal es un renglón: el toldito y el nombre corto, al final de la primera línea (sin columna nueva).
 * Solo aparece cuando hace falta: mirando «Todas» con más de una sucursal (`when="all"`, lo normal) o siempre
 * (`when="always"`, por ejemplo en la ficha de un cliente que vino a las dos).
 */
export function BranchTag({
  branchId,
  when = 'all',
  className,
}: {
  branchId: string | null | undefined
  when?: 'all' | 'always'
  className?: string
}) {
  const context = useBranchScope()
  if (!context || !branchId || !context.scope.multi) return null
  if (when === 'all' && !context.scope.isAll) return null
  const branch = context.byId.get(branchId)
  if (!branch) return null
  return (
    <span
      className={cn(
        'inline-flex max-w-[9rem] shrink-0 items-center gap-1 rounded-full border border-border/70 bg-background/60 py-0.5 pr-1.5 pl-1 align-middle text-[11px] leading-none font-medium text-foreground/80',
        className,
      )}
      title={branch.name}
    >
      <BranchAwning colors={[branch.color]} className="h-2.5 w-[0.95rem]" />
      <span className="truncate">{branchShortLabel(branch)}</span>
    </span>
  )
}
