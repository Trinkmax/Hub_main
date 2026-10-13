import { AdmPage } from '@/components/administracion/kit/adm-page'
import { ResumenSkeleton } from './_resumen/skeletons'

/**
 * Carga del Resumen (todas las demás pantallas de Administración traen su
 * propio `loading.tsx`): el héroe, «Hoy te toca» y los paneles con su forma
 * real, la misma que después usa cada `Suspense` de la página. Nunca un
 * spinner, y nada salta de lugar cuando llegan los datos.
 */
export default function AdministracionLoading() {
  return (
    <AdmPage>
      <ResumenSkeleton />
    </AdmPage>
  )
}
