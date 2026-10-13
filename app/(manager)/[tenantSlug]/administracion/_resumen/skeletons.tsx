import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Los esqueletos del Resumen: cada bloque con SU forma (el héroe verde con su
 * número y su barra, las tarjetas de «Hoy te toca», las columnas del mes), así
 * cuando llega el dato nada salta de lugar. Los usa cada `Suspense` de la
 * página y `loading.tsx`, que arma la pantalla entera con las mismas piezas.
 */

/** La superficie de un `Panel`, vacía. */
function PanelBox({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      aria-hidden
      className={cn('card-hairline rounded-2xl border bg-card p-4 shadow-xs sm:p-5', className)}
    >
      {children}
    </div>
  )
}

/** Un bloque que late sobre el panel verde (ahí el gris crema no se ve). */
function HeroBone({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-white/10 motion-reduce:animate-none', className)}
    />
  )
}

export function HeroSkeleton({ tone = 'bosque' }: { tone?: 'bosque' | 'crema' }) {
  if (tone === 'crema') {
    return (
      <PanelBox className="grid gap-x-8 gap-y-5 p-5 sm:p-6 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-7">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-12 w-64 max-w-full sm:h-14" />
          <Skeleton className="h-4 w-80 max-w-full" />
          <Skeleton className="h-3.5 w-full rounded-full" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-32 rounded-full" />
            <Skeleton className="h-9 w-40 rounded-full" />
          </div>
        </div>
        <Skeleton className="hidden h-44 rounded-2xl lg:col-span-5 lg:block" />
      </PanelBox>
    )
  }
  return (
    <div className="adm-hero grid gap-x-8 gap-y-5 rounded-3xl p-5 sm:p-7 lg:grid-cols-12">
      <span className="sr-only">Cargando el resumen…</span>
      <div aria-hidden className="space-y-4 lg:col-span-7">
        <HeroBone className="h-3 w-40" />
        <HeroBone className="h-12 w-64 max-w-full sm:h-14" />
        <HeroBone className="h-4 w-80 max-w-full" />
        <HeroBone className="h-3.5 w-full rounded-full" />
        <div className="flex gap-2">
          <HeroBone className="h-9 w-32 rounded-full" />
          <HeroBone className="h-9 w-40 rounded-full" />
        </div>
      </div>
      <HeroBone className="hidden h-44 rounded-2xl lg:col-span-5 lg:block" />
    </div>
  )
}

/** «Estado de los libros» (solo la contadora): dos renglones y el botón de descarga. */
export function BooksSkeleton() {
  return (
    <PanelBox className="space-y-3">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-4 w-56 max-w-full" />
    </PanelBox>
  )
}

export function TodaySkeleton() {
  return (
    <div aria-hidden className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-44" />
      </div>
      <div className="flex flex-col gap-3 lg:flex-row">
        {['a', 'b', 'c'].map((k) => (
          <div key={k} className="flex flex-1 gap-3 lg:flex-col lg:gap-2.5">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <PanelBox className="flex-1 space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-11 w-full rounded-md" />
            </PanelBox>
          </div>
        ))}
      </div>
    </div>
  )
}

function PanelHead() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-5 w-3/5" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  )
}

/** Dos semanas de casilleros de la tira de cierres. */
const STRIP_CELLS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'] as const

/** «El mes contra el objetivo»: columnas por día y, abajo, la tira de cierres. */
export function MonthSkeleton({ className }: { className?: string }) {
  // Alturas distintas a propósito: sirven de clave y el dibujo no parece una grilla.
  const heights = ['h-2/5', 'h-3/5', 'h-1/2', 'h-4/5', 'h-3/4', 'h-full', 'h-2/3', 'h-1/3']
  return (
    <PanelBox className={cn('space-y-5', className)}>
      <PanelHead />
      <div className="flex h-40 items-end gap-1.5 sm:h-48">
        {heights.map((h) => (
          <Skeleton key={h} className={cn('flex-1 rounded-t-[4px] rounded-b-none', h)} />
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {STRIP_CELLS.map((k) => (
          <Skeleton key={k} className="h-11 rounded-lg" />
        ))}
      </div>
    </PanelBox>
  )
}

/** «Lo que tenés que pagar»: el número, la barra de tres tramos y los renglones. */
export function PayablesSkeleton({ className }: { className?: string }) {
  return (
    <PanelBox className={cn('space-y-5', className)}>
      <PanelHead />
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-3 w-full rounded-full" />
      <div className="space-y-3">
        {['a', 'b', 'c'].map((k) => (
          <div key={k} className="flex items-center justify-between gap-4">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-9 w-20 rounded-md" />
          </div>
        ))}
      </div>
    </PanelBox>
  )
}

/** «Entró y salió»: barras hacia arriba y hacia abajo del cero. */
export function InOutSkeleton({ className }: { className?: string }) {
  const up = ['h-3/5', 'h-full', 'h-2/3', 'h-4/5', 'h-1/2']
  return (
    <PanelBox className={cn('space-y-5', className)}>
      <PanelHead />
      <div className="flex h-40 items-center gap-4 sm:h-48">
        {up.map((h) => (
          <div key={h} className="flex h-full flex-1 flex-col gap-0.5">
            <div className="flex flex-1 items-end">
              <Skeleton className={cn('w-full rounded-t-[4px] rounded-b-none', h)} />
            </div>
            <div className="flex flex-1 items-start">
              <Skeleton className="h-1/3 w-full rounded-t-none rounded-b-[4px]" />
            </div>
          </div>
        ))}
      </div>
    </PanelBox>
  )
}

/** «En qué se va la plata»: barras horizontales ordenadas. */
export function SpendingSkeleton({ className }: { className?: string }) {
  const widths = ['w-full', 'w-3/5', 'w-2/5', 'w-1/4', 'w-1/6']
  return (
    <PanelBox className={cn('space-y-5', className)}>
      <PanelHead />
      <div className="space-y-4">
        {widths.map((w) => (
          <div key={w} className="space-y-1.5">
            <div className="flex justify-between gap-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className={cn('h-2.5 rounded-l-none rounded-r-[4px]', w)} />
          </div>
        ))}
      </div>
      <Skeleton className="h-3 w-full rounded-full" />
    </PanelBox>
  )
}

/** La pantalla entera, para `loading.tsx`: mismo orden y mismas medidas que la página. */
export function ResumenSkeleton() {
  return (
    <>
      <div
        aria-hidden
        className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 sm:mb-6"
      >
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-40" />
      </div>
      <HeroSkeleton />
      <TodaySkeleton />
      <div className="grid gap-6 lg:grid-cols-12">
        <MonthSkeleton className="lg:col-span-7" />
        <PayablesSkeleton className="lg:col-span-5" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <InOutSkeleton />
        <SpendingSkeleton />
      </div>
    </>
  )
}
