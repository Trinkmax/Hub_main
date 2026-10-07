import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonKPIGroup,
  SkeletonPageHeader,
  SkeletonStatus,
} from '@/components/ui/skeleton'

/** Anchos de las cinco pestañas (Visión general · Clientes · Eventos · Comunicación · Mozos). */
const TAB_WIDTHS = [
  ['general', 'w-24'],
  ['clientes', 'w-16'],
  ['eventos', 'w-14'],
  ['comunicacion', 'w-24'],
  ['mozos', 'w-12'],
] as const

// Copia la «Visión general»: encabezado con tres accesos, la fila de pestañas,
// los cuatro KPIs y el gráfico de 90 días. Mismo `PageShell` que la página.
export default function Loading() {
  return (
    <PageShell aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader actions={3} />
      <div className="flex flex-col gap-6">
        <div aria-hidden="true" className="flex h-10 items-center gap-6 border-b border-border">
          {TAB_WIDTHS.map(([key, w]) => (
            <Skeleton key={key} className={`h-3 ${w}`} />
          ))}
        </div>
        <SkeletonKPIGroup count={4} columns={4} />
        <div aria-hidden="true" className="flex flex-col gap-4">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </div>
    </PageShell>
  )
}
