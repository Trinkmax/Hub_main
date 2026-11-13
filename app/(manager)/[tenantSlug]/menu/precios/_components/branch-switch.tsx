'use client'

import { Pill } from '@/components/administracion/kit/pill'
import type { PriceBranch, ViewId } from '@/lib/menu/prices/types'
import { cn } from '@/lib/utils'

/** El punto con el color de la sucursal: el mismo con el que se la reconoce en toda la app. */
export function BranchDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full ring-1 ring-background/70',
        className,
      )}
      style={{ backgroundColor: color }}
    />
  )
}

/**
 * Qué precios se están mirando: los de la carta (valen en todas las sucursales) o los de una
 * sucursal. La elegida va rellena y debajo UNA oración dice qué pasa con lo que se cambie.
 */
export function BranchSwitch({
  branches,
  view,
  onChange,
}: {
  branches: ReadonlyArray<PriceBranch>
  view: ViewId
  onChange: (view: ViewId) => void
}) {
  const current = view === null ? null : (branches.find((branch) => branch.id === view) ?? null)
  // En el celular las píldoras miden 44 px; en la compu, lo de siempre.
  const size = 'h-11 px-4 text-sm sm:h-9 sm:px-3 sm:text-[13px]'

  return (
    <div className="space-y-2">
      {/* biome-ignore lint/a11y/useSemanticElements: un grupo de botones que alternan, no un formulario. */}
      <div
        role="group"
        aria-label="Qué precios estás viendo"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
      >
        <Pill
          active={view === null}
          className={size}
          data-testid="view-carta"
          onClick={() => onChange(null)}
        >
          Toda la carta
        </Pill>
        {branches.map((branch) => (
          <Pill
            key={branch.id}
            active={view === branch.id}
            className={size}
            data-testid={`view-${branch.slug}`}
            onClick={() => onChange(branch.id)}
          >
            <span className="inline-flex items-center gap-1.5">
              <BranchDot color={branch.color} />
              {branch.name}
            </span>
          </Pill>
        ))}
      </div>
      <p aria-live="polite" className="max-w-2xl text-sm text-muted-foreground text-pretty">
        {current
          ? `Un precio que cambies acá queda como precio propio de ${current.name} y deja de seguir a la carta. El interruptor de cada producto dice si se vende ahí.`
          : 'Valen en todas las sucursales, salvo en los productos con precio propio.'}
      </p>
    </div>
  )
}
