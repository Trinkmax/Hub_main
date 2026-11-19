'use client'

import { cn } from '@/lib/utils'
import { BranchAwning } from './awning'
import { useBranchScope } from './branch-scope-provider'

/**
 * «De todo el bar»: al lado de un número que NO se separa por sucursal (los clientes, el club) cuando se está
 * mirando una sola. Así nadie lee «1.712 clientes» como «clientes del Cerro». En «Todas» o en un bar de una
 * sucursal no hace falta y no aparece.
 */
export function BranchShared({ className }: { className?: string }) {
  const context = useBranchScope()
  if (!context?.scope.multi || context.scope.isAll) return null
  return (
    <span
      className={cn(
        'mt-1 flex w-fit items-center gap-1 text-[11px] font-medium text-muted-foreground',
        className,
      )}
    >
      <BranchAwning
        colors={context.scope.branches.map((branch) => branch.color)}
        muted
        className="h-2 w-3.5"
      />
      De todo el bar
    </span>
  )
}
