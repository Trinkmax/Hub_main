import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonForm,
  SkeletonPageHeader,
  SkeletonStatus,
} from '@/components/ui/skeleton'

/** Copia «Nuevo cliente»: volver a Clientes, el formulario en una columna y sus acciones. */
export default function Loading() {
  return (
    <PageShell width="compact" aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader context />
      <div className="flex flex-col gap-4">
        <Skeleton aria-hidden="true" className="h-4 w-20" />
        <SkeletonForm fields={5} />
      </div>
    </PageShell>
  )
}
