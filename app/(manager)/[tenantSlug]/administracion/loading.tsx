import { SimplePage } from '@/components/administracion/planilla'
import { ResumenSkeleton } from './_resumen/skeletons'

/**
 * Carga del Resumen (todas las demás pantallas de Administración traen su propio `loading.tsx`): la
 * fecha, el panel verde y «Para hoy» con su forma real, la misma que después usa cada `Suspense` de la
 * página. Nunca un spinner, y nada salta de lugar cuando llegan los datos.
 */
export default function AdministracionLoading() {
  return (
    <SimplePage>
      <ResumenSkeleton />
    </SimplePage>
  )
}
