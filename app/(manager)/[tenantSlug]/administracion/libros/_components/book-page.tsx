import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { PlanillaBar, SimplePage } from '@/components/administracion/planilla'
import { cn } from '@/lib/utils'
import { ExportButton, type ExportItem } from './export-button'

/**
 * El marco de cada libro, igual para todos: `SimplePage` › la barra (el período y los filtros a la
 * izquierda; el sello y las exportaciones, chicos, a la derecha) › lo que tenga arriba de la planilla
 * › la planilla. Las solapas las dibuja `AdmNav`: el título del libro es la solapa, y acá va solo para
 * lectores de pantalla.
 *
 * Subdiarios e Historia no son solapas: se llega desde Cierre de mes. Esas dos llevan `back`, y con
 * eso el título a la vista y la vuelta. Server-safe.
 */
export function BookPage({
  title,
  back,
  description,
  toolbar,
  aside,
  exports,
  below,
  width = 'default',
  children,
}: {
  title: string
  /** «‹ Cierre de mes»: la pantalla no es una solapa. */
  back?: { href: string; label: string }
  /** Una línea debajo del título (solo con `back`). */
  description?: ReactNode
  /** El período y los filtros. */
  toolbar?: ReactNode
  /** Antes de las exportaciones: el sello «Debe = Haber». */
  aside?: ReactNode
  /** Los archivos que se bajan desde la barra. */
  exports?: readonly ExportItem[]
  /** Otra fila de la barra (filtros que no entran al lado del período). */
  below?: ReactNode
  width?: 'default' | 'narrow'
  children: ReactNode
}) {
  return (
    // `minmax(0, 1fr)`: nada de adentro ensancha la columna. Lo que no entra se desliza en su lugar.
    <SimplePage width={width} className="grid-cols-[minmax(0,1fr)]">
      {back ? (
        <div className="grid gap-1">
          <BackLink href={back.href}>{back.label}</BackLink>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
      ) : (
        <h1 className="sr-only">{title}</h1>
      )}
      <PlanillaBar>
        {toolbar}
        {aside || exports?.length ? (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {aside}
            {exports?.map((item) => (
              <BookExport key={item.href} item={item} />
            ))}
          </div>
        ) : null}
      </PlanillaBar>
      {below}
      {children}
    </SimplePage>
  )
}

/**
 * Para la `Planilla` de una tabla que se desliza. Un texto `sr-only` se ubica contra el primer ancestro
 * con `position`: sin esto, el de una columna fuera de pantalla se escapa del scroll de la tabla y
 * ensancha toda la página en el celular.
 */
export const SLIDING_SHEET = 'relative'

/** Un botón chico de exportar: baja un CSV, que es lo que abre Excel. */
export function BookExport({ item, className }: { item: ExportItem; className?: string }) {
  return (
    <ExportButton
      href={item.href}
      fileName={item.fileName}
      label={item.label ?? 'Excel'}
      size="sm"
      className={cn('h-11 gap-1.5 md:pointer-fine:h-8', className)}
    />
  )
}

/** «‹ Volver a …» arriba de una pantalla que no es solapa; en el celular deja 44 px para el dedo. */
export function BackLink({
  href,
  children,
  className,
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-11 w-fit items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0',
        className,
      )}
    >
      <ArrowLeft className="size-3" aria-hidden />
      {children}
    </Link>
  )
}
