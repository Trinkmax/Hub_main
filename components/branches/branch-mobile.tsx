'use client'

import { ChevronDown, Info, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AppSheet } from '@/components/shell/mobile/app-sheet'
import { fetchBranchPulses } from '@/lib/branches/actions'
import type { BranchPulses } from '@/lib/branches/pulse-line'
import { barSectionName } from '@/lib/branches/sections'
import { cn } from '@/lib/utils'
import { BranchChoices } from './branch-choices'
import { useBranchScope } from './branch-scope-provider'
import { BranchChipLabel, useBranchDisplay } from './branch-switcher'

/**
 * El selector de sucursal en el celular: una ficha chica al lado de tu avatar (arriba a la derecha, donde llega el
 * pulgar), que abre una hoja con las vidrieras de cada sucursal. Con una sola sucursal no aparece.
 */
export function BranchMobileButton({
  canManage,
  always = false,
}: {
  canManage: boolean
  /** En el salón se ve también en la compu y la tablet (la caja). En el panel, solo en el celular. */
  always?: boolean
}) {
  const context = useBranchScope()
  const display = useBranchDisplay()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [pulses, setPulses] = useState<BranchPulses | null>(null)
  const slug = context?.slug ?? ''

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

  if (!context || !display) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex h-9 max-w-[8.5rem] items-center gap-1 rounded-full border border-border/70 bg-card/70 pr-2 pl-2.5 backdrop-blur-md active:scale-[0.97]',
          !always && 'lg:hidden',
        )}
        aria-label={`Sucursal: ${display.label}. Cambiar de sucursal`}
      >
        <BranchChipLabel />
        <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
      </button>
      <AppSheet
        open={open}
        onOpenChange={setOpen}
        title="Sucursal"
        description={
          context.surface === 'device'
            ? 'Elegí en qué sucursal trabaja este equipo.'
            : 'Elegí qué sucursal mirás en el panel.'
        }
        headerAction={
          canManage ? (
            <Link
              href={`/${slug}/local/sucursales`}
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground active:bg-accent"
            >
              <Settings2 className="size-3.5" aria-hidden />
              Administrar
            </Link>
          ) : null
        }
      >
        <div className="space-y-3 pb-2">
          {display.mode === 'bar' ? (
            <p className="flex items-start gap-2 rounded-2xl bg-muted/70 px-3 py-2.5 text-[13px] leading-snug text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {barSectionName(pathname, slug)} es de todo el bar: acá no se separa por sucursal.
                Lo que elijas se usa en Reservas, el salón y los números.
              </span>
            </p>
          ) : null}
          <BranchChoices pulses={pulses} layout="list" onChosen={() => setOpen(false)} />
          <p className="px-1 text-xs text-muted-foreground">
            {context.surface === 'device'
              ? 'Este equipo se acuerda: el mapa, la caja y la cocina pasan a ser de la que elijas.'
              : 'Este celular se acuerda de lo que elijas.'}
          </p>
        </div>
      </AppSheet>
    </>
  )
}
