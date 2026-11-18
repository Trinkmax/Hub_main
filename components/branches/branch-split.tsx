'use client'

import { branchShortLabel } from '@/lib/branches/types'
import { cn } from '@/lib/utils'
import { useBranchScope } from './branch-scope-provider'

/**
 * La parte de cada sucursal en un número de «Todas»: una barrita fina debajo del número, un tramo por sucursal en su
 * color, y al pasar el mouse (o con el lector de pantalla) cuánto es cada una. Solo aparece mirando «Todas».
 */
export function BranchSplit({
  values,
  format = (value) => value.toLocaleString('es-AR'),
  className,
}: {
  /** Por id de sucursal. Las que no están cuentan 0. */
  values: Readonly<Record<string, number>>
  format?: (value: number) => string
  className?: string
}) {
  const context = useBranchScope()
  if (!context?.scope.isAll || !context.scope.multi) return null
  const parts = context.scope.branches.map((branch) => ({
    branch,
    value: Math.max(0, values[branch.id] ?? 0),
  }))
  const total = parts.reduce((sum, part) => sum + part.value, 0)
  const label = parts
    .map((part) => `${branchShortLabel(part.branch)}: ${format(part.value)}`)
    .join(' · ')
  return (
    <div className={cn('mt-2', className)} title={label}>
      <div className="flex h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        {total > 0
          ? parts.map((part) =>
              part.value > 0 ? (
                <span
                  key={part.branch.id}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{
                    width: `${(part.value / total) * 100}%`,
                    backgroundColor: part.branch.color,
                  }}
                />
              ) : null,
            )
          : null}
      </div>
      <p className="sr-only">{label}</p>
    </div>
  )
}
