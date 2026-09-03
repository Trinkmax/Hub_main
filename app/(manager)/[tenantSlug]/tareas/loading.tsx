import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Skeleton NEUTRO a propósito. `/tareas` renderiza dos layouts muy distintos
 * según `?seccion=` (la lista agrupada por fecha o el checklist semanal) y este
 * archivo no recibe searchParams: prometer una de las dos formas hace que la
 * pantalla se transforme delante del usuario cuando entra por el link de
 * Orgánico que deja el WeekBar. Reservamos el chrome que SIEMPRE está —
 * encabezado con acciones y solapas — y filas genéricas debajo.
 */
export default function Loading() {
  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow="Organización de contenido"
        title="Tareas de marketing"
        description={<Skeleton className="h-4 w-[26rem] max-w-full" />}
        actions={
          <>
            <Skeleton className="h-9 w-full sm:w-56" />
            <Skeleton className="h-9 w-32" />
          </>
        }
      />
      <Skeleton className="h-10 w-full max-w-lg rounded-full" />
      <div className="space-y-3">
        <Skeleton className="h-16 w-full rounded-xl" />
        {['a', 'b', 'c'].map((row) => (
          <Skeleton key={row} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    </PageShell>
  )
}
