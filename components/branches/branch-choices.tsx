'use client'

import { Check } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Kbd } from '@/components/ui/kbd'
import { type BranchPulses, pulseLine } from '@/lib/branches/pulse-line'
import { type BranchRef, branchShortLabel } from '@/lib/branches/types'
import { cn } from '@/lib/utils'
import { useBranchScope } from './branch-scope-provider'
import { Storefront } from './storefront'
import './branches.css'

/**
 * La cuadra: una vidriera por sucursal (y «Todas», la cuadra entera) para elegir qué se mira. La que se está mirando
 * tiene la persiana levantada; las otras, a media altura. La usan la ventana del selector (compu) y la hoja del
 * celular. Teclas: 0 = todas, 1, 2… = cada sucursal (las maneja quien la abre, con `choiceForKey`).
 */

export type BranchChoice =
  | { key: string; kind: 'all' }
  | { key: string; kind: 'branch'; branch: BranchRef }

/** Las opciones en orden, con su tecla: «Todas» (0) y después cada sucursal (1, 2…). */
export function branchChoicesOf(
  branches: ReadonlyArray<BranchRef>,
  canAll: boolean,
): BranchChoice[] {
  const choices: BranchChoice[] = branches.map((branch, index) => ({
    key: String(index + 1),
    kind: 'branch' as const,
    branch,
  }))
  return canAll ? [{ key: '0', kind: 'all' as const }, ...choices] : choices
}

export function choiceForKey(
  choices: ReadonlyArray<BranchChoice>,
  key: string,
): BranchChoice | undefined {
  return choices.find((choice) => choice.key === key)
}

export function BranchChoices({
  pulses,
  layout = 'grid',
  onChosen,
}: {
  pulses: BranchPulses | null
  layout?: 'grid' | 'list'
  /** Después de elegir (para cerrar la ventana). */
  onChosen?: () => void
}) {
  const context = useBranchScope()
  if (!context) return null
  const { scope, switchTo, pendingChoice } = context
  const choices = branchChoicesOf(scope.branches, scope.canAll)
  const selected = pendingChoice ?? (scope.isAll ? 'all' : scope.currentId)

  return (
    <div
      role="radiogroup"
      aria-label="Sucursal"
      className={cn(
        layout === 'grid' ? 'grid gap-2.5' : 'flex flex-col gap-2',
        layout === 'grid' && (choices.length <= 3 ? 'grid-cols-3' : 'grid-cols-4'),
      )}
    >
      {choices.map((choice) => {
        const value = choice.kind === 'all' ? 'all' : choice.branch.id
        const checked = selected === value
        const meta =
          choice.kind === 'all'
            ? allMeta(scope.branches, pulses)
            : (pulseLine(pulses?.[choice.branch.id]) ??
              choice.branch.address ??
              'Sin dirección cargada')
        const style = {
          '--option-color': choice.kind === 'all' ? 'var(--foreground)' : choice.branch.color,
        } as CSSProperties
        return (
          // biome-ignore lint/a11y/useSemanticElements: un control segmentado (role=radio) se dibuja con botones; un <input type="radio"> no se puede estilar así
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-branch-choice={value}
            className={cn('branch-option', layout === 'list' && 'flex-row items-center')}
            style={style}
            onClick={() => {
              if (!checked) switchTo(value)
              onChosen?.()
            }}
          >
            <span
              className={cn('branch-option-art', layout === 'list' && 'w-28 shrink-0')}
              data-street={choice.kind === 'all' ? '' : undefined}
            >
              {choice.kind === 'all' ? (
                scope.branches.map((branch) => (
                  <Storefront
                    key={branch.id}
                    size="mini"
                    label={branchShortLabel(branch)}
                    color={branch.color}
                    open={checked ? 1 : 0.5}
                  />
                ))
              ) : (
                <Storefront
                  size="mini"
                  label={branchShortLabel(choice.branch)}
                  color={choice.branch.color}
                  open={checked ? 1 : 0.5}
                  principal={choice.branch.isDefault}
                />
              )}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="branch-option-name truncate">
                {choice.kind === 'all' ? 'Todas' : choice.branch.name}
              </span>
              <span className="branch-option-meta line-clamp-2">{meta}</span>
            </span>
            {checked ? (
              <span className="branch-option-check" aria-hidden>
                <Check className="size-3.5" strokeWidth={3} />
              </span>
            ) : null}
            {layout === 'grid' ? (
              <span className="branch-option-key" aria-hidden>
                <Kbd>{choice.key}</Kbd>
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

function allMeta(branches: ReadonlyArray<BranchRef>, pulses: BranchPulses | null): string {
  if (!pulses) return `${branches.length} sucursales juntas`
  const total = branches.reduce(
    (sum, branch) => {
      const pulse = pulses[branch.id]
      return pulse
        ? {
            reservations: sum.reservations + pulse.reservations,
            guests: sum.guests + pulse.guests,
            events: sum.events + pulse.events,
          }
        : sum
    },
    { reservations: 0, guests: 0, events: 0 },
  )
  return pulseLine(total) ?? `${branches.length} sucursales juntas`
}
