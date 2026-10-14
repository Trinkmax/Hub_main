import { ArrowLeft, Monitor } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { cn } from '@/lib/utils'
import type { BookKey, BookPeriod } from '../_lib/book-nav'
import { BookSwitcher } from './book-switcher'
import { ExportButton, type ExportItem, ExportMenuButton } from './export-button'

/**
 * La fila del período en el celular: el mes y sus atajos en UN renglón que se
 * desliza de costado (antes eran tres, y con el título y «Exportar» dejaban la
 * primera pantalla sin un solo dato). Se le pasa a `RangePicker` / `MonthPicker`
 * por `className`; desde `sm` no cambia nada (baja de renglón como siempre).
 */
export const PERIOD_ROW =
  'max-sm:-mx-4 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-4 max-sm:py-1 max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden max-sm:[&>*]:shrink-0'

/**
 * El marco de cada libro, igual para todos: el encabezado de la sección (el
 * «‹ Libros» chico, el título, «Solo lectura» para la contadora y «Exportar» a
 * la derecha), la fila para pasar a otro libro con el mismo período, la banda
 * de período y filtros (queda pegada en la compu mientras se baja por la tabla)
 * y, si el libro los tiene, sus totales en una banda. Después, la tabla.
 *
 * En el celular el encabezado se achica para que el primer dato entre en la
 * primera pantalla: «Exportar» es un ícono en la línea del título y la bajada
 * (que repite el período y la cuenta que ya dicen los filtros) no se muestra.
 *
 * En los libros el diseño es sacar estorbos, no agregar forma: acá no hay
 * héroes, gráficos ni tarjetas. Server-safe.
 */
export function BookPage({
  backHref,
  backLabel = 'Libros',
  title,
  description,
  exports,
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
  /** Los archivos que se exportan desde el encabezado (uno o dos). */
  exports?: readonly ExportItem[]
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
  const hasExports = Boolean(exports && exports.length > 0)
  // En el celular la bajada y los botones no se dibujan, pero sus lugares quedan vacíos en el
  // encabezado (8 y 16 px de separación): se le descuentan al margen de abajo (24 px).
  const mobileTrim =
    description && hasExports
      ? 'max-sm:mb-0'
      : hasExports
        ? 'max-sm:mb-2'
        : description
          ? 'max-sm:mb-4'
          : undefined
  return (
    <AdmPage width={width}>
      <AdmHeader
        back={{ href: backHref, label: backLabel }}
        title={title}
        className={mobileTrim}
        badge={
          <>
            <ReadOnlyBadge className="ml-0" />
            {badge}
            {exports && hasExports ? (
              <span className="ml-auto flex shrink-0 items-center sm:hidden">
                <ExportMenuButton items={exports} />
              </span>
            ) : null}
          </>
        }
        description={description ? <span className="max-sm:hidden">{description}</span> : undefined}
        actions={
          exports && hasExports ? (
            <div className="contents max-sm:hidden">
              {exports.map((item) => (
                <ExportButton
                  key={item.href}
                  href={item.href}
                  fileName={item.fileName}
                  label={item.label}
                />
              ))}
            </div>
          ) : undefined
        }
      />
      {booksPath && period ? (
        <BookSwitcher booksPath={booksPath} active={book} period={period} />
      ) : null}
      {toolbar ? (
        // Pegada solo en la compu: en el celular una banda fija se come un cuarto de la pantalla.
        <div className="z-10 -mx-2 rounded-2xl px-2 py-2 max-sm:py-0 lg:sticky lg:top-14 lg:bg-background/85 lg:backdrop-blur">
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
