import { PageHeader } from '@/components/ui/page-header'
import { FormTemplate } from '@/components/ui/page-templates'
import { Skeleton, SkeletonStatus } from '@/components/ui/skeleton'
import { AUTO_ACCEPT_DESCRIPTION, AUTO_ACCEPT_TITLE } from './_components/page-copy'

/** Una fila de interruptor (`Field layout="toggle"`): etiqueta y ayuda a la izquierda, switch a la derecha. */
function ToggleRowSkeleton() {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-2.5 w-64 max-w-full" />
      </div>
      <Skeleton className="h-5 w-9 rounded-full" />
    </div>
  )
}

/** Dos campos lado a lado (`FieldRow`): etiqueta, control y ayuda. */
function FieldPairSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {['a', 'b'].map((k) => (
        <div key={k} className="flex flex-col gap-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-(--control-md) w-full" />
          <Skeleton className="h-2.5 w-3/4" />
        </div>
      ))}
    </div>
  )
}

/** El título y la descripción de una `FormSection`. */
function SectionHead() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-3 w-full max-w-md" />
    </div>
  )
}

/** Copia el formulario final: tres secciones (auto-aceptación, cocina, tiempos) y la barra de acciones. */
export default function Loading() {
  return (
    <FormTemplate
      aria-busy="true"
      header={<PageHeader title={AUTO_ACCEPT_TITLE} description={AUTO_ACCEPT_DESCRIPTION} />}
    >
      <SkeletonStatus />
      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-4">
            <SectionHead />
            <ToggleRowSkeleton />
            <FieldPairSkeleton />
          </section>
          <section className="flex flex-col gap-4 border-t border-border pt-6">
            <SectionHead />
            <ToggleRowSkeleton />
          </section>
          <section className="flex flex-col gap-4 border-t border-border pt-6">
            <SectionHead />
            <FieldPairSkeleton />
          </section>
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-(--control-md) w-36" />
        </div>
      </div>
    </FormTemplate>
  )
}
