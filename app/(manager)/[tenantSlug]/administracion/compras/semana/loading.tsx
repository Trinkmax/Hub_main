import { Skeleton } from '@/components/ui/skeleton'
import {
  BarSkeleton,
  PlanillaLoading,
  SheetSkeleton,
  TotalizerSkeleton,
} from '../_components/planilla-skeleton'

/** El Plan de la semana mientras carga: la semana, el totalizador, la barra y las filas. */
export default function WeekPlanLoading() {
  return (
    <PlanillaLoading label="Cargando el Plan de la semana…">
      <BarSkeleton widths={['w-56']} />
      <TotalizerSkeleton items={3} />
      <Skeleton className="h-1.5 w-full rounded-full" />
      <SheetSkeleton rows={8} columns={5} />
    </PlanillaLoading>
  )
}
