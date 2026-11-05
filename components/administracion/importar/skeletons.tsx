import { Skeleton } from '@/components/ui/skeleton'

/**
 * Las pantallas de «Importar» mientras cargan, con la forma de lo que va a
 * aparecer (así nada salta de lugar al llegar): la bandeja con sus tres
 * bandejas, la subida con su riel y sus tres pasos, y la revisión con la pila,
 * la pregunta y el papel. Server-safe.
 */

const PAGE = 'mx-auto w-full space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8'
const SURFACE = 'card-hairline rounded-2xl border bg-card p-4 shadow-xs sm:p-5'

function HeaderSkeleton({ back = false }: { back?: boolean }) {
  return (
    <div className="space-y-3">
      {back ? <Skeleton className="h-4 w-24" /> : null}
      <div className="space-y-2">
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
    </div>
  )
}

/** «Importar»: la tabla de los orígenes y el historial. */
export function InboxSkeleton() {
  return (
    <div
      className="mx-auto grid w-full max-w-7xl content-start gap-3.5 px-4 pt-3.5 pb-24 sm:px-6 lg:px-8"
      aria-busy="true"
    >
      <span className="sr-only">Cargando Importar…</span>
      {[4, 4].map((rows, block) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: dos bloques fijos, no se reordenan
          key={block}
          className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs"
        >
          <Skeleton className="m-3 h-4 w-28" />
          <div className="divide-y divide-border/60 border-t border-border/70">
            {Array.from({ length: rows }, (_, row) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: filas de relleno
              <div key={row} className="flex items-center gap-4 px-3 py-2.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-32 max-sm:hidden" />
                <Skeleton className="h-8 w-16 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Subir un archivo: volver, encabezado, el riel de pasos y los tres pasos (el segundo, alto). */
export function UploadPageSkeleton({
  label,
  extraCard = false,
}: {
  label: string
  /** Mercado Pago: el bloque «Antes de empezar» arriba de los pasos. */
  extraCard?: boolean
}) {
  return (
    <div className={`${PAGE} max-w-6xl`} aria-busy="true">
      <span className="sr-only">Cargando {label}…</span>
      <HeaderSkeleton back />
      {extraCard ? <Skeleton className="h-16 w-full rounded-2xl" /> : null}
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="flex gap-3 lg:flex-col">
          {['uno', 'dos', 'tres'].map((k) => (
            <div key={k} className="flex flex-1 items-center gap-3 lg:flex-none">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="hidden h-4 w-32 lg:block" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-14 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  )
}

/** Las hojitas de la pila, quietas. */
const PILE = Array.from({ length: 24 }, (_, i) => `hoja-${i}`)

/** Revisar un archivo: encabezado, la pila (número y hojitas), la pregunta y el papel. */
export function ReviewPageSkeleton() {
  return (
    <div className={`${PAGE} max-w-7xl`} aria-busy="true">
      <span className="sr-only">Cargando la revisión…</span>
      <HeaderSkeleton back />
      <div className={`${SURFACE} grid gap-6 sm:p-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]`}>
        <div className="space-y-3">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-12 w-40" />
          <Skeleton className="h-4 w-full max-w-sm" />
        </div>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-[3px]">
            {PILE.map((k) => (
              <Skeleton key={k} className="h-[18px] w-3.5 rounded-[3px]" />
            ))}
          </div>
          <div className="flex gap-2">
            {['a', 'b', 'c', 'd'].map((k) => (
              <Skeleton key={k} className="h-9 w-28 rounded-full" />
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className={`${SURFACE} space-y-4`}>
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-7 w-full max-w-md" />
          <Skeleton className="h-4 w-full max-w-sm" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-11 w-40 rounded-full" />
            <Skeleton className="h-11 w-32 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </div>
  )
}
