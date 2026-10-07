import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

/**
 * «Anterior · Página X de Y · Siguiente», igual que la lista de Clientes. Los
 * links conservan los demás parámetros de la pantalla (`hrefFor` los arma).
 * Server-safe.
 */
export function ListPagination({
  page,
  totalPages,
  hrefFor,
}: {
  page: number
  totalPages: number
  hrefFor: (page: number) => string
}) {
  if (totalPages <= 1) return null
  const hasPrev = page > 1
  const hasNext = page < totalPages
  return (
    <nav aria-label="Páginas" className="flex items-center justify-between gap-3">
      <Button
        variant="outline"
        size="sm"
        disabled={!hasPrev}
        className="h-11 gap-1.5 md:h-8"
        asChild={hasPrev}
      >
        {hasPrev ? (
          <Link href={hrefFor(page - 1)} scroll={false}>
            <ChevronLeft className="size-3.5" aria-hidden />
            Anterior
          </Link>
        ) : (
          <span>
            <ChevronLeft className="size-3.5" aria-hidden />
            Anterior
          </span>
        )}
      </Button>
      <span className="text-xs tabular-nums text-muted-foreground">
        Página {page} de {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={!hasNext}
        className="h-11 gap-1.5 md:h-8"
        asChild={hasNext}
      >
        {hasNext ? (
          <Link href={hrefFor(page + 1)} scroll={false}>
            Siguiente
            <ChevronRight className="size-3.5" aria-hidden />
          </Link>
        ) : (
          <span>
            Siguiente
            <ChevronRight className="size-3.5" aria-hidden />
          </span>
        )}
      </Button>
    </nav>
  )
}
