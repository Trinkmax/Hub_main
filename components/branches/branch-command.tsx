'use client'

import { Store } from 'lucide-react'
import { CommandGroup, CommandItem, CommandSeparator } from '@/components/ui/command'
import { BranchAwning } from './awning'
import { useBranchScope } from './branch-scope-provider'

/**
 * El grupo «Sucursal» del buscador (⌘K): «Ver Cerro», «Ver Alta Córdoba», «Ver todas». Solo con más de una sucursal;
 * la que se está mirando no aparece.
 */
export function BranchCommandItems({ onDone }: { onDone: () => void }) {
  const context = useBranchScope()
  if (!context?.scope.multi) return null
  const { scope, switchTo } = context
  const items = [
    ...(scope.canAll && !scope.isAll
      ? [
          {
            id: 'all',
            label: 'Ver todas las sucursales',
            colors: scope.branches.map((branch) => branch.color),
          },
        ]
      : []),
    ...scope.branches
      .filter((branch) => scope.isAll || branch.id !== scope.currentId)
      .map((branch) => ({ id: branch.id, label: `Ver ${branch.name}`, colors: [branch.color] })),
  ]
  if (items.length === 0) return null
  return (
    <>
      <CommandSeparator />
      <CommandGroup heading="Sucursal">
        {items.map((item) => (
          <CommandItem
            key={item.id}
            value={`${item.label} sucursal cambiar local`}
            onSelect={() => {
              onDone()
              switchTo(item.id)
            }}
          >
            {item.colors.length > 0 ? (
              <BranchAwning colors={item.colors} className="h-3 w-[1.15rem]" />
            ) : (
              <Store className="size-4 text-muted-foreground" aria-hidden />
            )}
            <span>{item.label}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  )
}
