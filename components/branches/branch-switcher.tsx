'use client'

import { ChevronDown, Info, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type CSSProperties, type KeyboardEvent, useCallback, useEffect, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { fetchBranchPulses } from '@/lib/branches/actions'
import type { BranchPulses } from '@/lib/branches/pulse-line'
import { barSectionName, branchScopeForPath } from '@/lib/branches/sections'
import { type BranchRef, branchShortLabel } from '@/lib/branches/types'
import { cn } from '@/lib/utils'
import { BranchAwning } from './awning'
import { BranchChoices, branchChoicesOf, choiceForKey } from './branch-choices'
import { useBranchScope } from './branch-scope-provider'
import './branches.css'

/**
 * El selector grande de sucursal, arriba a la izquierda de la barra (en la compu). Se ve siempre, también con el menú
 * lateral plegado. Con una sola sucursal no aparece.
 *
 * - Muestra el toldito y el nombre de la sucursal que se mira; en «Todas», los colores de todas.
 * - En una sección de todo el bar (Mensajería, Club…) se atenúa y dice «Todo el bar»: ahí no filtra nada, y lo
 *   elegido se guarda para las pantallas por sucursal.
 * - `⌥S` lo abre desde cualquier pantalla; adentro, 0 = todas y 1, 2… = cada sucursal.
 */

export type BranchDisplay = {
  mode: 'one' | 'all' | 'bar'
  label: string
  colors: string[]
  current: BranchRef | null
}

/** Qué dice la píldora (y de qué color va el fleco) en esta pantalla. */
export function useBranchDisplay(): BranchDisplay | null {
  const context = useBranchScope()
  const pathname = usePathname()
  if (!context?.scope.multi) return null
  const { scope, byId, pendingChoice } = context
  const allColors = scope.branches.map((branch) => branch.color)
  if (branchScopeForPath(pathname, context.slug) === 'bar') {
    return { mode: 'bar', label: 'Todo el bar', colors: allColors, current: null }
  }
  // Mientras llega la pantalla nueva ya se ve lo elegido.
  const showing = pendingChoice ?? (scope.isAll ? 'all' : scope.currentId)
  if (showing === 'all') return { mode: 'all', label: 'Todas', colors: allColors, current: null }
  const current = showing ? (byId.get(showing) ?? null) : null
  if (!current) return { mode: 'all', label: 'Todas', colors: allColors, current: null }
  return {
    mode: 'one',
    label: current.name.length <= 16 ? current.name : branchShortLabel(current),
    colors: [current.color],
    current,
  }
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function BranchSwitcher({ canManage }: { canManage: boolean }) {
  const context = useBranchScope()
  const display = useBranchDisplay()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [pulses, setPulses] = useState<BranchPulses | null>(null)
  const slug = context?.slug ?? ''

  // ⌥S abre el selector desde cualquier pantalla (fuera de un campo de texto). En macOS ⌥S escribe «ß»: se mira la
  // tecla física, no la letra.
  useEffect(() => {
    if (!display) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.code !== 'KeyS') return
      if (isEditable(event.target)) return
      event.preventDefault()
      setOpen((current) => !current)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [display])

  // Los números de hoy de cada sucursal: se piden al abrir (no frenan ninguna pantalla).
  useEffect(() => {
    if (!open || !slug) return
    let cancelled = false
    void fetchBranchPulses(slug).then((result) => {
      if (!cancelled) setPulses(result)
    })
    return () => {
      cancelled = true
    }
  }, [open, slug])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!context || event.altKey || event.metaKey || event.ctrlKey) return
      const choice = choiceForKey(
        branchChoicesOf(context.scope.branches, context.scope.canAll),
        event.key,
      )
      if (!choice) return
      event.preventDefault()
      context.switchTo(choice.kind === 'all' ? 'all' : choice.branch.id)
      setOpen(false)
    },
    [context],
  )

  if (!context || !display) return null

  const style = {
    '--branch-a': display.colors[0] ?? '#2f5d50',
  } as CSSProperties

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="branch-pill"
          data-mode={display.mode}
          style={style}
          aria-label={`Sucursal: ${display.mode === 'bar' ? 'esta sección es de todo el bar' : display.label}. Cambiar de sucursal (Opción S)`}
          title="Cambiar de sucursal · ⌥S"
        >
          <BranchAwning
            colors={display.colors}
            muted={display.mode === 'bar'}
            className="h-3.5 w-[1.35rem]"
          />
          <span className="branch-pill-name">{display.label}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={10}
        className="w-[min(34rem,calc(100vw-2rem))] rounded-2xl p-3"
        onKeyDown={onKeyDown}
      >
        <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            ¿Qué sucursal mirás?
          </p>
          {canManage ? (
            <Link
              href={`/${slug}/local/sucursales`}
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Settings2 className="size-3.5" aria-hidden />
              Administrar
            </Link>
          ) : null}
        </div>
        {display.mode === 'bar' ? (
          <p className="mb-2.5 flex items-start gap-2 rounded-xl bg-muted/70 px-3 py-2 text-xs leading-snug text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              {barSectionName(pathname, slug)} es de todo el bar: acá no se separa por sucursal. Lo
              que elijas se usa en Reservas, el salón y los números.
            </span>
          </p>
        ) : null}
        <BranchChoices pulses={pulses} onChosen={() => setOpen(false)} />
        <p className="mt-2.5 px-1 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/70">⌥S</span> abre esto desde cualquier
          pantalla. Este equipo se acuerda de lo que elijas.
        </p>
      </PopoverContent>
    </Popover>
  )
}

/**
 * El fleco del toldo que cuelga del borde de abajo de la barra: el color de la sucursal que se mira, en todo el
 * panel, sin ocupar lugar. Va adentro de la barra (que es `sticky`: el fleco se posiciona contra ella).
 */
export function BranchFringe() {
  const context = useBranchScope()
  const display = useBranchDisplay()
  if (!context || !display) return null
  const [first, second] = display.colors
  const style = {
    '--branch-a': first ?? '#2f5d50',
    '--branch-b': (display.mode === 'one' ? first : second) ?? first ?? '#2f5d50',
  } as CSSProperties
  return (
    <span
      aria-hidden
      className="branch-fringe"
      data-mode={display.mode}
      data-switching={context.switching ? '' : undefined}
      style={style}
    />
  )
}

/** El toldito y el nombre corto, para el celular (abre la hoja de sucursales). */
export function BranchChipLabel({ className }: { className?: string }) {
  const display = useBranchDisplay()
  if (!display) return null
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <BranchAwning
        colors={display.colors}
        muted={display.mode === 'bar'}
        className="h-3 w-[1.15rem]"
      />
      <span className="truncate text-[13px] font-semibold">
        {display.current ? branchShortLabel(display.current) : display.label}
      </span>
    </span>
  )
}
