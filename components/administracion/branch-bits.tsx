'use client'

import { BranchAwning } from '@/components/branches/awning'
import { useDefaultBranchId } from '@/components/branches/branch-field'
import { useBranchScope } from '@/components/branches/branch-scope-provider'
import { BranchSplit } from '@/components/branches/branch-split'
import { BranchTag } from '@/components/branches/branch-tag'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import '@/components/branches/branches.css'

/**
 * Las piezas de sucursal de Administración: las mismas de Reservas (la etiqueta, la barrita de «Todas»), con lo
 * que Administración suma: la plata en la barrita y la marca «Todo el bar» de una caja que no es de ningún local.
 */

/** La parte de cada sucursal en un número de plata de «Todas» (centavos por id de sucursal). */
export function MoneyBranchSplit({
  values,
  className,
}: {
  values: Readonly<Record<string, number>>
  className?: string
}) {
  return (
    <BranchSplit
      values={values}
      format={(cents) => formatCentsShort(cents)}
      className={className}
    />
  )
}

/**
 * De qué sucursal es un renglón: la de su sucursal (solo mirando «Todas») o «Todo el bar» si no tiene (una caja
 * de todo el bar, un comprobante de la empresa), que se ve siempre que el bar tiene más de una sucursal.
 */
export function AccBranchTag({
  branchId,
  when = 'all',
  label,
  className,
}: {
  branchId: string | null | undefined
  /** `always`: también mirando una sola sucursal (la ficha de una caja o de un comprobante). */
  when?: 'all' | 'always'
  /** Lo que dice sin sucursal («Todo el bar»; en un comprobante, «De todo el bar»). */
  label?: string
  className?: string
}) {
  if (branchId) return <BranchTag branchId={branchId} when={when} className={className} />
  return <BarWideTag label={label} className={className} />
}

/**
 * «Todo el bar»: la etiqueta de lo que no es de un local (una billetera o un banco que se ve en todas las
 * sucursales con un solo saldo). Con una sola sucursal no hace falta y no aparece.
 */
export function BarWideTag({
  label = 'Todo el bar',
  className,
}: {
  label?: string
  className?: string
}) {
  const context = useBranchScope()
  if (!context?.scope.multi) return null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border border-border/70 bg-background/60 py-0.5 pr-1.5 pl-1 align-middle text-[11px] leading-none font-medium text-muted-foreground',
        className,
      )}
      title="Se ve en todas las sucursales, con un solo saldo"
    >
      <BranchAwning
        colors={context.scope.branches.map((branch) => branch.color)}
        muted
        className="h-2.5 w-[0.95rem]"
      />
      <span>{label}</span>
    </span>
  )
}

/**
 * La sucursal de una caja de efectivo nueva: la que se mira; mirando «Todas», la principal (el efectivo siempre
 * es de un local). `null` solo si el bar no tiene ninguna sucursal.
 */
export function useCashBoxBranchId(): string | null {
  const viewed = useDefaultBranchId()
  const context = useBranchScope()
  if (viewed) return viewed
  const branches = context?.scope.branches ?? []
  return (branches.find((branch) => branch.isDefault) ?? branches[0])?.id ?? null
}
