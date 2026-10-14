import { ArrowLeft, Monitor } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { cn } from '@/lib/utils'
import type { BookKey, BookPeriod } from '../_lib/book-nav'
import { BookSwitcher } from './book-switcher'

/**
 * El marco de cada libro, igual para todos: el encabezado de la sección (el
 * «‹ Libros» chico, el título, «Solo lectura» para la contadora y «Exportar» a
 * la derecha), la fila para pasar a otro libro con el mismo período, la banda
 * de período y filtros (queda pegada en la compu mientras se baja por la tabla)
 * y, si el libro los tiene, sus totales en una banda. Después, la tabla.
 *
 * En los libros el diseño es sacar estorbos, no agregar forma: acá no hay
 * héroes, gráficos ni tarjetas. Server-safe.
 */
export function BookPage({
  backHref,
  backLabel = 'Libros',
  title,
  description,
  actions,
  badge,
  booksPath,
  book = null,
  period,
  toolbar,
  totals,
  width = 'default',
  children,
}: {
  backHref: string
  backLabel?: string
  title: ReactNode
  description?: ReactNode
  /** Botones del encabezado (Exportar). */
  actions?: ReactNode
  /** Un estado al lado del título («Mes abierto: puede cambiar»). */
  badge?: ReactNode
  /** `/<bar>/administracion/libros`: con `period`, dibuja la fila «entre libros». */
  booksPath?: string
  /** El libro abierto, para marcarlo en la fila. */
  book?: BookKey | null
  /** El período que se está mirando: viaja al cambiar de libro. */
  period?: BookPeriod | null
  /** El período y los filtros, en una sola banda. */
  toolbar?: ReactNode
  /** Los totales del libro (`BookTotals`). */
  totals?: ReactNode
  width?: 'default' | 'comfortable' | 'compact'
  children: ReactNode
}) {
  return (
    <AdmPage width={width}>
      <AdmHeader
        back={{ href: backHref, label: backLabel }}
        title={title}
        badge={
          <>
            <ReadOnlyBadge className="ml-0" />
            {badge}
          </>
        }
        description={description}
        actions={actions}
      />
      {booksPath && period ? (
        <BookSwitcher booksPath={booksPath} active={book} period={period} />
      ) : null}
      {toolbar ? (
        // Pegada solo en la compu: en el celular una banda fija se come un cuarto de la pantalla.
        <div className="z-10 -mx-2 rounded-2xl px-2 py-2 lg:sticky lg:top-14 lg:bg-background/85 lg:backdrop-blur">
          {toolbar}
        </div>
      ) : null}
      {totals}
      {children}
    </AdmPage>
  )
}

/** «‹ Volver a …» arriba del encabezado; en el celular deja 44 px para el dedo. */
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
        'inline-flex min-h-11 items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0',
        className,
      )}
    >
      <ArrowLeft className="size-3" aria-hidden />
      {children}
    </Link>
  )
}

/** Los libros anchos en el celular (H.12): se pueden leer, pero se leen mejor en la compu. */
export function WideBookHint({ children }: { children?: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground sm:hidden">
      <Monitor className="size-3.5 shrink-0" aria-hidden />
      {children ?? 'Los libros se leen mejor en la compu. Deslizá la tabla para ver todo.'}
    </p>
  )
}
