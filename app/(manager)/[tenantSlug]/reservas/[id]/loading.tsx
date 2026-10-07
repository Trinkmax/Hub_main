import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonForm,
  SkeletonPageHeader,
  SkeletonStatus,
} from '@/components/ui/skeleton'

/**
 * La ficha de una reserva: el formulario y, al costado (o abajo), el estado y
 * sus datos. Copia las columnas de `FormTemplate` (formulario de 34 a 48 rem,
 * costado desde 20 rem) para que nada salte al llegar la página.
 */
export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus label="Cargando la reserva…" />
      <SkeletonPageHeader context description={false} />
      <div
        aria-hidden
        className="flex min-w-0 flex-col gap-8 lg:flex-row lg:flex-wrap lg:items-start"
      >
        <SkeletonForm
          fields={7}
          className="w-full min-w-0 max-w-3xl lg:w-auto lg:min-w-[34rem] lg:flex-[999_1_0%]"
        />
        <div className="flex w-full max-w-3xl flex-col gap-4 lg:w-auto lg:flex-[1_1_20rem]">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </div>
    </PageShell>
  )
}
