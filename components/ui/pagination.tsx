import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import type * as React from 'react'
import { buttonVariants } from '@/components/ui/button'
import { formatNumber } from '@/lib/format/number-kind'
import { clampPage, pageCount, paginationItems, rangeLabel } from '@/lib/table/pagination'
import { cn } from '@/lib/utils'

export type PaginationProps = Omit<React.ComponentProps<'nav'>, 'children'> & {
  /** La página actual, desde 1 (`parsePage(sp.page)`). */
  page: number
  pageSize: number
  /** Con `total`: «1–25 de 702» y los números de página. */
  total?: number
  /** Sin `total` (listas por cursor): si hay una página siguiente. */
  hasNextPage?: boolean
  /**
   * El link de cada página: `makePageHref(pathname, searchParams)`. Es una
   * función, así que se usa donde se renderiza (server-safe; nunca como prop
   * de un componente cliente).
   */
  hrefFor: (page: number) => string
  /** Nombre del `<nav>`: «Paginación de clientes». Default «Paginación». */
  label?: string
}

/**
 * Paginación por URL (kit HUB §3.6). Server-safe.
 *
 * - Con `total`: «1–25 de 702» en `type-small tabular-nums`, números de
 *   página en escritorio y «Página 2 de 29» en el celular.
 * - «Anterior» y «Siguiente» son `<Link rel="prev|next">`. Deshabilitados son
 *   un `<span aria-disabled="true">`, nunca un link: un `<Button asChild
 *   disabled>` alrededor de un `<Link>` deja el link clickeable igual (era el
 *   bug del paginador de reservas).
 * - La página actual lleva `aria-current="page"` y relleno verde (vocabulario
 *   de selección, §3.0). Los botones miden 32 px y agrandan su área táctil a
 *   44 con el dedo (`hit-area`).
 */
function Pagination({
  page,
  pageSize,
  total,
  hasNextPage = false,
  hrefFor,
  label = 'Paginación',
  className,
  ...props
}: PaginationProps) {
  const knownTotal = total !== undefined && Number.isFinite(total) ? total : undefined
  const count = knownTotal !== undefined ? pageCount(knownTotal, pageSize) : undefined
  const current =
    count !== undefined
      ? clampPage(page, count)
      : Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1)
  const hasPrev = current > 1
  const hasNext = count !== undefined ? current < count : hasNextPage
  const numbers = count !== undefined && count > 1 ? paginationItems(current, count) : []

  return (
    <nav
      aria-label={label}
      data-slot="pagination"
      className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2', className)}
      {...props}
    >
      {knownTotal !== undefined ? (
        <p data-slot="pagination-range" className="type-small tabular-nums text-muted-foreground">
          {rangeLabel(current, pageSize, knownTotal)}
        </p>
      ) : null}
      <div className="ms-auto flex items-center gap-1">
        <PageStep direction="prev" href={hasPrev ? hrefFor(current - 1) : undefined} />
        {numbers.length > 0 ? (
          <ul className="hidden items-center gap-1 sm:flex">
            {numbers.map((item) =>
              typeof item === 'number' ? (
                <li key={item}>
                  <Link
                    href={hrefFor(item)}
                    aria-label={`Página ${formatNumber(item)}`}
                    aria-current={item === current ? 'page' : undefined}
                    data-slot="pagination-page"
                    className={cn(
                      buttonVariants({ variant: 'ghost', size: 'sm' }),
                      'min-w-(--control-sm) px-1.5 tabular-nums',
                      item === current &&
                        'bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground',
                    )}
                  >
                    {formatNumber(item)}
                  </Link>
                </li>
              ) : (
                <li
                  key={item}
                  aria-hidden="true"
                  className="px-1 type-small text-muted-foreground select-none"
                >
                  …
                </li>
              ),
            )}
          </ul>
        ) : null}
        <span
          data-slot="pagination-status"
          className={cn(
            'px-2 type-small tabular-nums whitespace-nowrap text-muted-foreground',
            // Con los números a la vista, el texto queda para el celular.
            numbers.length > 0 && 'sm:hidden',
          )}
        >
          {count !== undefined
            ? `Página ${formatNumber(current)} de ${formatNumber(count)}`
            : `Página ${formatNumber(current)}`}
        </span>
        <PageStep direction="next" href={hasNext ? hrefFor(current + 1) : undefined} />
      </div>
    </nav>
  )
}

/** «Anterior» / «Siguiente»: un link, o un `<span aria-disabled>` en el extremo. */
function PageStep({ direction, href }: { direction: 'prev' | 'next'; href: string | undefined }) {
  const previous = direction === 'prev'
  const Icon = previous ? ChevronLeft : ChevronRight
  const text = previous ? 'Anterior' : 'Siguiente'
  const classes = cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'gap-1 px-2')
  // En el celular se ve solo la flecha; el texto sigue para el lector.
  const content = previous ? (
    <>
      <Icon aria-hidden="true" />
      <span className="max-sm:sr-only">{text}</span>
    </>
  ) : (
    <>
      <span className="max-sm:sr-only">{text}</span>
      <Icon aria-hidden="true" />
    </>
  )

  if (href === undefined) {
    return (
      // Un link deshabilitado no existe en HTML: role="link" + aria-disabled se
      // anuncia «link, no disponible», sin href ni parada de Tab (un extremo
      // muerto en el orden de Tab sería ruido).
      // biome-ignore lint/a11y/useSemanticElements: no hay un <a> deshabilitado nativo; ver arriba
      // biome-ignore lint/a11y/useFocusableInteractive: deshabilitado a propósito, no tiene que recibir foco
      <span
        role="link"
        aria-disabled="true"
        data-slot={`pagination-${direction}`}
        className={cn(classes, 'pointer-events-none')}
      >
        {content}
      </span>
    )
  }
  return (
    <Link href={href} rel={direction} data-slot={`pagination-${direction}`} className={classes}>
      {content}
    </Link>
  )
}

export { Pagination }
