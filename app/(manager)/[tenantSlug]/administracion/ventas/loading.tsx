import { SimplePage } from '@/components/administracion/planilla'
import { MonthSkeleton } from './_components/skeletons'

/** Ventas mientras carga: el mes, sus tres números y un renglón por día. */
export default function VentasLoading() {
  return (
    <SimplePage>
      <MonthSkeleton />
    </SimplePage>
  )
}
