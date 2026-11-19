'use client'

import { useId } from 'react'
import { branchShortLabel } from '@/lib/branches/types'
import { cn } from '@/lib/utils'
import { BranchAwning } from './awning'
import { useBranchScope } from './branch-scope-provider'
import './branches.css'

/**
 * En qué sucursal se crea algo (una reserva, un evento, un conteo). Viene elegida la que se está mirando; mirando
 * «Todas» hay que elegir una. Con una sola sucursal no se muestra: va sola en un campo oculto.
 *
 * Controlado: el formulario guarda el valor (`value` / `onChange`) y lo manda con `name` si es un `<form>` común.
 */
export function BranchField({
  value,
  onChange,
  name = 'branch_id',
  label = 'Sucursal',
  error,
  disabled,
  className,
}: {
  value: string | null
  onChange: (branchId: string) => void
  name?: string
  label?: string
  error?: string | null
  disabled?: boolean
  className?: string
}) {
  const context = useBranchScope()
  const groupId = useId()
  const branches = context?.scope.branches ?? []
  if (branches.length <= 1) {
    const only = branches[0]?.id ?? value ?? ''
    return <input type="hidden" name={name} value={only} />
  }

  return (
    <fieldset className={cn('space-y-1.5', className)} disabled={disabled}>
      <legend id={`${groupId}-label`} className="text-sm font-medium">
        {label}
      </legend>
      <div role="radiogroup" aria-labelledby={`${groupId}-label`} className="flex flex-wrap gap-2">
        {branches.map((branch) => {
          const checked = value === branch.id
          return (
            // biome-ignore lint/a11y/useSemanticElements: un control segmentado (role=radio) se dibuja con botones; un <input type="radio"> no se puede estilar así
            <button
              key={branch.id}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(branch.id)}
              className={cn(
                'inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                checked
                  ? 'border-transparent text-white shadow-sm'
                  : 'border-border bg-card text-foreground hover:bg-accent/60',
              )}
              style={checked ? { backgroundColor: branch.color } : undefined}
            >
              <BranchAwning
                colors={[checked ? 'var(--awning-cream)' : branch.color]}
                className="h-3 w-[1.15rem]"
              />
              <span>{branchShortLabel(branch)}</span>
            </button>
          )
        })}
      </div>
      <input type="hidden" name={name} value={value ?? ''} />
      {error ? (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}

/** La sucursal con la que arranca un formulario nuevo: la que se mira, o la única. En «Todas», ninguna. */
export function useDefaultBranchId(): string | null {
  const context = useBranchScope()
  if (!context) return null
  if (context.current) return context.current.id
  const [only] = context.scope.branches
  return context.scope.branches.length === 1 && only ? only.id : null
}
