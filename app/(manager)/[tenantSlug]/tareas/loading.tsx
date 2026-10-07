import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonPageHeader,
  SkeletonStatus,
  SkeletonTable,
} from '@/components/ui/skeleton'

/** Eventos · Promociones · Impresiones · Orgánico · Mis tareas. */
const TAB_WIDTHS = [
  { id: 'eventos', width: 'w-14' },
  { id: 'promociones', width: 'w-24' },
  { id: 'impresiones', width: 'w-20' },
  { id: 'organico', width: 'w-16' },
  { id: 'mias', width: 'w-20' },
] as const

/**
 * Esqueleto NEUTRO a propósito. `/tareas` renderiza dos layouts según
 * `?seccion=` (la lista agrupada por fecha o el checklist semanal) y este
 * archivo no recibe searchParams: prometer una de las dos formas hace que la
 * pantalla se transforme delante del usuario cuando entra por el link de
 * Orgánico. Reserva lo que SIEMPRE está —encabezado con su acción, pestañas y
 * una barra arriba de la lista— y filas de tabla genéricas debajo.
 */
export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus />
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <SkeletonPageHeader actions={1} />
          {/* Pestañas: 40 px con el pelo de abajo, como `TabsList`. */}
          <div
            aria-hidden="true"
            className="flex min-h-10 items-center gap-6 shadow-[inset_0_-1px_0_0_var(--border)]"
          >
            {TAB_WIDTHS.map((tab) => (
              <Skeleton key={tab.id} className={`h-3 ${tab.width}`} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton aria-hidden="true" className="h-(--control-sm) w-full max-w-sm" />
          <SkeletonTable rows={6} columns={5} />
        </div>
      </div>
    </PageShell>
  )
}
