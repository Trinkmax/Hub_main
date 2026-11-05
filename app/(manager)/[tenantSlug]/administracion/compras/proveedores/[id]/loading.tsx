import { Skeleton } from '@/components/ui/skeleton'
import {
  BarSkeleton,
  PlanillaLoading,
  SheetSkeleton,
  TotalizerSkeleton,
} from '../../_components/planilla-skeleton'

/**
 * La cuenta corriente mientras carga, con su forma real: la vuelta y los botones, el nombre, el
 * totalizador y la tabla.
 */
export default function SupplierLoading() {
  return (
    <PlanillaLoading label="Cargando el proveedor…">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-28" />
        <div className="flex gap-1.5">
          {['w-14', 'w-20', 'w-16'].map((width) => (
            <Skeleton key={width} className={`h-8 rounded-md ${width}`} />
          ))}
        </div>
      </div>
      <Skeleton className="h-8 w-80 max-w-full" />
      <TotalizerSkeleton items={3} />
      <BarSkeleton widths={['w-96']} />
      <SheetSkeleton rows={6} columns={3} />
    </PlanillaLoading>
  )
}
