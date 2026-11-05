import { Planilla } from '@/components/administracion/planilla'
import { Skeleton } from '@/components/ui/skeleton'
import type { RoomKey } from '../_lib/rooms'

/**
 * Los esqueletos de Ajustes, con la forma real de cada pantalla (nada de
 * spinner ni de un bloque genérico): al cargar, lo que aparece ocupa el lugar
 * de lo que estaba. Sin hooks: sirven en el servidor (el `fallback` de cada
 * habitación) y en el `loading.tsx` de la ruta.
 */

const SURFACE = 'card-hairline rounded-2xl border bg-card p-4 shadow-xs sm:p-5'

function Lines({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: renglones iguales, sin estado
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
          <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  )
}

function Fields({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-5">
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: renglones iguales, sin estado
        <div key={index} className="space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-11 w-full md:h-10" />
        </div>
      ))}
    </div>
  )
}

/** El encabezado de una pantalla: (volver), título y una oración. */
export function HeaderSkeleton({ back = false }: { back?: boolean }) {
  return (
    <div className="space-y-3">
      {back ? <Skeleton className="h-4 w-20" /> : null}
      <div className="space-y-2.5">
        <Skeleton className="h-9 w-52 max-w-full" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </div>
    </div>
  )
}

const PORTADA_ROWS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as const

/** La portada: la puesta en marcha y una fila por habitación. */
export function PortadaSkeleton() {
  return (
    <div aria-hidden className="grid gap-3.5">
      <div className="flex min-h-11 items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2 shadow-xs">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-1.5 flex-1 rounded-full" />
      </div>
      <Planilla>
        <ul>
          {PORTADA_ROWS.map((k) => (
            <li
              key={k}
              className="flex min-h-12 items-center gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0 sm:min-h-0"
            >
              <Skeleton className="h-4 w-36 shrink-0 sm:w-44" />
              <Skeleton className="h-4 flex-1 max-sm:hidden" />
              <Skeleton className="h-6 w-24 rounded-full max-sm:hidden" />
            </li>
          ))}
        </ul>
      </Planilla>
    </div>
  )
}

/** El contenido de una habitación mientras carga, con su forma. */
export function RoomSkeleton({ room }: { room: RoomKey }) {
  switch (room) {
    // «Calcular solos» y la planilla de cuatro renglones.
    case 'impuestos':
      return (
        <div className="grid gap-3.5">
          <Skeleton className="h-6 w-40" />
          <Planilla>
            <div className="border-b border-border bg-secondary/50 px-3 py-2">
              <Skeleton className="h-3 w-full max-w-md" />
            </div>
            {['a', 'b', 'c', 'd'].map((k) => (
              <div
                key={k}
                className="flex items-center gap-4 border-b border-border/60 px-3 py-2.5 last:border-b-0"
              >
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-8 w-44 max-sm:hidden" />
                <Skeleton className="h-4 w-24 max-sm:hidden" />
              </div>
            ))}
          </Planilla>
        </div>
      )
    // El número y las llaves, y las dos listas.
    case 'accesos':
      return (
        <div className="space-y-6">
          <div
            className={`${SURFACE} grid gap-5 md:grid-cols-[minmax(0,1fr)_20rem] md:items-center`}
          >
            <div className="space-y-3">
              <Skeleton className="h-14 w-72 max-w-full" />
              <Skeleton className="h-4 w-96 max-w-full" />
            </div>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 18 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: puntos iguales, sin estado
                <Skeleton key={index} className="size-3 rounded-full" />
              ))}
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className={SURFACE}>
              <Skeleton className="mb-4 h-5 w-24" />
              <Lines rows={4} />
            </div>
            <div className={SURFACE}>
              <Skeleton className="mb-4 h-5 w-40" />
              <Lines rows={4} />
            </div>
          </div>
        </div>
      )
    // Tres tarjetas de billetera.
    case 'cajas':
      return (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {['a', 'b', 'c'].map((k) => (
            <li key={k} className={`${SURFACE} min-h-[11.5rem] space-y-4`}>
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-5 w-36 max-w-full" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-3 w-44 max-w-full" />
              <div className="flex gap-2 border-t border-border/60 pt-3">
                <Skeleton className="h-9 w-24 rounded-full" />
                <Skeleton className="h-9 w-28 rounded-full" />
              </div>
            </li>
          ))}
        </ul>
      )
    // Los bloques de medios y, a la derecha, el papel de la columna.
    case 'medios':
      return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className={`${SURFACE} space-y-4`}>
            <Skeleton className="h-6 w-[26rem] max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
            {['a', 'b', 'c'].map((k) => (
              <div key={k} className="space-y-3 rounded-xl bg-secondary/50 p-4">
                <Skeleton className="h-4 w-40" />
                {['x', 'y'].map((j) => (
                  <div key={j} className="flex items-center gap-4">
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-48 max-w-full" />
                    </div>
                    <Skeleton className="hidden h-6 w-36 sm:block" />
                    <Skeleton className="h-6 w-10 rounded-full" />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <Skeleton className="hidden h-96 rounded-sm lg:block" />
        </div>
      )
    // La hoja de la constancia y, al lado, «Los libros».
    case 'sas':
      return (
        <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
          <div className="space-y-5 rounded-[3px] border border-border/70 bg-card p-5 sm:p-6 lg:col-span-7">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-14 w-full" />
            <Fields rows={4} />
          </div>
          <div className={`${SURFACE} space-y-5 lg:col-span-5`}>
            <Skeleton className="h-5 w-28" />
            <Fields rows={2} />
          </div>
        </div>
      )
    // El papel de la factura y los talonarios.
    case 'puntos-de-venta':
      return (
        <div className="space-y-6">
          <div className={`${SURFACE} grid gap-5 md:grid-cols-[19rem_minmax(0,1fr)]`}>
            <Skeleton className="h-32 w-full rounded-[3px]" />
            <div className="space-y-4">
              {['a', 'b'].map((k) => (
                <div key={k} className="flex items-center gap-4">
                  <Skeleton className="h-7 w-16" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-6 w-10 rounded-full" />
                </div>
              ))}
            </div>
          </div>
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      )
    // El cable y los cuatro datos.
    case 'arca':
      return (
        <div className={`${SURFACE} space-y-6 sm:p-6`}>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-center">
            <div className="space-y-2.5">
              <Skeleton className="h-8 w-[28rem] max-w-full" />
              <Skeleton className="h-4 w-96 max-w-full" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="size-11 shrink-0 rounded-full" />
              <Skeleton className="h-1 flex-1" />
              <Skeleton className="size-11 shrink-0 rounded-full" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {['a', 'b', 'c', 'd'].map((k) => (
              <div key={k} className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
        </div>
      )
    // La tira de meses y los tres campos.
    case 'ejercicio':
      return (
        <div className="space-y-4">
          <div className={`${SURFACE} space-y-4`}>
            <Skeleton className="h-6 w-80 max-w-full" />
            <div className="grid grid-cols-4 gap-2">
              {['a', 'b', 'c', 'd'].map((k) => (
                <Skeleton key={k} className="h-16 rounded-t-xl rounded-b-md" />
              ))}
            </div>
          </div>
          <div className={`${SURFACE} space-y-5`}>
            <Skeleton className="h-5 w-48" />
            <div className="grid gap-5 sm:grid-cols-3">
              {['a', 'b', 'c'].map((k) => (
                <div key={k} className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-11 w-24 md:h-10" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )
    case 'integridad':
      return (
        <div className={`${SURFACE} space-y-4`}>
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-[30rem] max-w-full" />
          <Skeleton className="h-11 w-32" />
        </div>
      )
  }
}
