'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { BranchAwning } from '@/components/branches/awning'
import { type BranchRef, branchShortLabel } from '@/lib/branches/types'
import type { TenantRole } from '@/lib/tenant/types'
import { cn } from '@/lib/utils'
import { setMemberBranches } from './actions'

/**
 * Dónde trabaja cada persona (docs/features/sucursales.md): una ficha por sucursal, que se prende y se apaga y queda
 * guardada. Quien no tiene ninguna marcada trabaja en la principal. Un dueño o la contadora ven todas: no se les
 * asigna. Con una sola sucursal no se muestra nada.
 */
export function MemberBranches({
  tenantSlug,
  userId,
  role,
  branches,
  assigned,
}: {
  tenantSlug: string
  userId: string
  role: TenantRole
  /** Las sucursales activas del bar, la principal primero. */
  branches: ReadonlyArray<BranchRef>
  /** Las que tiene marcadas hoy (vacío = solo la principal). */
  assigned: ReadonlyArray<string>
}) {
  const principal = branches.find((branch) => branch.isDefault) ?? branches[0]
  const initial = assigned.filter((id) => branches.some((branch) => branch.id === id))
  const [selected, setSelected] = useState<string[]>(
    initial.length > 0 ? initial : principal ? [principal.id] : [],
  )
  const [pending, startTransition] = useTransition()

  if (branches.length < 2) return null

  if (role === 'owner' || role === 'accountant') {
    return (
      <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <BranchAwning colors={branches.map((branch) => branch.color)} className="h-2.5 w-4" />
        Todas las sucursales
      </p>
    )
  }

  const toggle = (branchId: string) => {
    const next = selected.includes(branchId)
      ? selected.filter((id) => id !== branchId)
      : [...selected, branchId]
    if (next.length === 0) {
      toast.error('Tiene que trabajar en al menos una sucursal.')
      return
    }
    const previous = selected
    setSelected(next)
    startTransition(async () => {
      const result = await setMemberBranches(tenantSlug, userId, next)
      if (!result.ok) {
        setSelected(previous)
        toast.error(result.message)
      }
    })
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: un grupo de fichas que se prenden y apagan; un <fieldset> rompe el renglón
    <div
      role="group"
      aria-label="Sucursales donde trabaja"
      className="mt-1.5 flex flex-wrap items-center gap-1.5"
    >
      <span className="text-[11px] text-muted-foreground">Trabaja en</span>
      {branches.map((branch) => {
        const on = selected.includes(branch.id)
        return (
          <button
            key={branch.id}
            type="button"
            aria-pressed={on}
            disabled={pending}
            onClick={() => toggle(branch.id)}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60',
              on
                ? 'border-transparent text-white'
                : 'border-dashed border-border bg-transparent text-muted-foreground hover:bg-muted/60',
            )}
            style={on ? { backgroundColor: branch.color } : undefined}
            title={on ? `Sacar de ${branch.name}` : `Sumar a ${branch.name}`}
          >
            <BranchAwning
              colors={[on ? 'var(--awning-cream)' : branch.color]}
              className="h-2.5 w-4"
            />
            {branchShortLabel(branch)}
          </button>
        )
      })}
    </div>
  )
}
