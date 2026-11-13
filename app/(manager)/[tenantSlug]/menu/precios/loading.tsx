import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { Skeleton } from '@/components/ui/skeleton'

const ROWS = ['a', 'b', 'c', 'd', 'e', 'f', 'g']

/** La silueta de «Precios»: el título ya dicho, el buscador y la lista por llegar. */
export default function Loading() {
  return (
    <AdmPage className="max-w-4xl">
      <AdmHeader
        title="Precios"
        description="Buscá un producto y tocá su precio para cambiarlo. Se guarda solo y lo podés deshacer."
      />
      <div aria-busy="true" className="space-y-4">
        <span className="sr-only">Cargando los precios…</span>
        <Skeleton className="h-12 w-full rounded-2xl sm:h-14" />
        <Skeleton className="h-4 w-56" />
        <div className="overflow-hidden rounded-2xl border bg-card">
          <Skeleton className="h-11 w-full rounded-none" />
          <ul className="divide-y divide-border/60">
            {ROWS.map((row) => (
              <li key={row} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                <Skeleton className="h-4 w-40 max-w-[45%]" />
                <Skeleton className="ml-auto h-11 w-[7.25rem] rounded-lg sm:h-10 sm:w-36" />
                <Skeleton className="size-9 rounded-full" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AdmPage>
  )
}
