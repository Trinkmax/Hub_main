import { PlanillaLoading } from './_components/planilla-skeleton'
import { LibretaSkeleton } from './_components/suppliers-tab'

/** Compras y pagos mientras carga, con la forma real: el totalizador y las filas de la planilla. */
export default function ComprasLoading() {
  return (
    <PlanillaLoading label="Cargando Compras y pagos…">
      <LibretaSkeleton />
    </PlanillaLoading>
  )
}
