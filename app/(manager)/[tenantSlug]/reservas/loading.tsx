import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonPageHeader,
  SkeletonStatus,
  SkeletonTable,
} from '@/components/ui/skeleton'

/**
 * La forma final de la lista: encabezado con acciones, chips de período, el
 * día con sus flechas, la barra de filtros y la tabla.
 */
export default function Loading() {
  return (
    <PageShell aria-busy="true">
      <SkeletonStatus label="Cargando las reservas…" />
      {/* Las cinco acciones del día: cómo funciona, pasar lista, exportar,
          panel operativo y nueva reserva (en el celular ocupan tres renglones). */}
      <SkeletonPageHeader actions={5} />
      <div aria-hidden className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {['hoy', 'semana', 'mes', 'rango'].map((k) => (
            <Skeleton key={k} className="h-(--control-sm) w-24 rounded-full" />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-(--control-md) w-56" />
          <Skeleton className="h-(--control-sm) w-40" />
        </div>
      </div>
      <div aria-hidden className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-(--control-sm) min-w-48 flex-1" />
          <Skeleton className="h-(--control-sm) w-40" />
          <Skeleton className="h-(--control-sm) w-40" />
          <Skeleton className="h-(--control-sm) w-32" />
        </div>
        <SkeletonTable rows={8} columns={7} />
      </div>
    </PageShell>
  )
}
