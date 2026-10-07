import { Skeleton } from '@/components/ui/skeleton'

// Espejo del ClubEditor: cabecera (eyebrow + título + descripción + 2 botones),
// la tira de tabs y bloques de formulario verticales. NO es el viejo dashboard
// de KPIs — así no hay salto de layout al hidratar.
export default function Loading() {
  return (
    <div className="space-y-6">
      {/* CABECERA */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-32" />
        </div>
      </div>

      {/* TABS */}
      <Skeleton className="h-9 w-full max-w-md rounded-full" />

      {/* CONTENIDO — bloques de formulario del programa */}
      <div className="space-y-10">
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3 w-72 max-w-full" />
            </div>
          </div>
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-3 w-80 max-w-full" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  )
}
