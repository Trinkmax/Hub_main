import { Skeleton } from '@/components/ui/skeleton'

/**
 * La planilla de gastos fijos mientras carga, con la forma real: las dos
 * píldoras de mes y una hoja con la cabecera (el número alto, la barra y la
 * caja de «Lo que sigue») y seis renglones con el margen del día a la
 * izquierda. Nunca dice «no hay gastos fijos» mientras carga.
 */

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-border/60 px-3 py-3.5 last:border-b-0 sm:px-4">
      <Skeleton className="size-6 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-4 w-44 max-w-full" />
        <Skeleton className="h-3 w-28 max-w-full" />
      </div>
      <Skeleton className="hidden h-3 w-24 lg:block" />
      <Skeleton className="h-4 w-20" />
      <Skeleton className="hidden h-6 w-36 rounded-full lg:block" />
      <Skeleton className="hidden h-9 w-20 rounded-full sm:block" />
    </div>
  )
}

function GroupSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex border-b border-border/60 last:border-b-0">
      <div className="hidden w-16 shrink-0 flex-col items-center gap-1.5 border-r border-border/60 py-3 sm:flex">
        <Skeleton className="h-2.5 w-6" />
        <Skeleton className="h-6 w-8" />
        <Skeleton className="h-2.5 w-6" />
      </div>
      <div className="min-w-0 flex-1">
        {Array.from({ length: rows }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: relleno fijo, sin identidad
          <RowSkeleton key={index} />
        ))}
      </div>
    </div>
  )
}

export function SheetSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          <Skeleton className="h-11 w-28 rounded-full md:h-9" />
          <Skeleton className="h-11 w-32 rounded-full md:h-9" />
        </div>
        <Skeleton className="h-4 w-36" />
      </div>
      <div className="card-hairline rounded-2xl border bg-card shadow-xs">
        <div className="grid gap-x-8 gap-y-5 p-5 sm:p-6 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-7">
            <Skeleton className="h-3 w-56 max-w-full" />
            <Skeleton className="h-12 w-64 max-w-full sm:h-14" />
            <Skeleton className="h-4 w-full max-w-md" />
            <Skeleton className="mt-4 h-3 w-full rounded-full" />
            <div className="space-y-2 pt-1">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
          <div className="space-y-3 rounded-xl bg-secondary/50 p-4 lg:col-span-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-48 max-w-full" />
            <Skeleton className="h-6 w-36 rounded-full" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        </div>
        <div className="border-t border-border/60">
          <GroupSkeleton rows={2} />
          <GroupSkeleton rows={1} />
          <GroupSkeleton rows={3} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3.5 sm:px-5">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-72 max-w-full" />
        </div>
      </div>
    </div>
  )
}
