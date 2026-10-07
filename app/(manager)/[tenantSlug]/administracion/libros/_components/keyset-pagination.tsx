import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { KeysetPageInfo } from '../_lib/keyset'

/**
 * «Primera página · Página 2 de 5 · Siguiente», como la paginación de
 * Clientes. Con keyset no hay «Anterior» directo: la primera página está a un
 * toque y el «atrás» del navegador vuelve a la anterior. Server-safe.
 */
export function KeysetPagination({
  info,
  firstHref,
  nextHref,
  noun,
}: {
  info: KeysetPageInfo
  /** La misma pantalla sin `?despues=`. */
  firstHref: string
  /** `null` si no hay más. */
  nextHref: string | null
  /** «asientos», «movimientos», «comprobantes». */
  noun: string
}) {
  if (info.isFirst && !nextHref) return null
  return (
    <nav aria-label="Páginas" className="flex items-center justify-between gap-3">
      {info.isFirst ? (
        <Button variant="outline" size="sm" disabled className="h-11 gap-1.5 md:h-8">
          <ChevronLeft className="size-3.5" aria-hidden />
          Primera página
        </Button>
      ) : (
        <Button asChild variant="outline" size="sm" className="h-11 gap-1.5 md:h-8">
          <Link href={firstHref} scroll>
            <ChevronLeft className="size-3.5" aria-hidden />
            Primera página
          </Link>
        </Button>
      )}
      <span className="text-center text-xs tabular-nums text-muted-foreground">
        Página {info.page} de {info.totalPages}
        <span className="hidden sm:inline">
          {' '}
          · {info.firstRow}–{info.lastRow} de los {noun}
        </span>
      </span>
      {nextHref ? (
        <Button asChild variant="outline" size="sm" className="h-11 gap-1.5 md:h-8">
          <Link href={nextHref} scroll>
            Siguiente
            <ChevronRight className="size-3.5" aria-hidden />
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled className="h-11 gap-1.5 md:h-8">
          Siguiente
          <ChevronRight className="size-3.5" aria-hidden />
        </Button>
      )}
    </nav>
  )
}
