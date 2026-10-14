import { Download } from 'lucide-react'
import Link from 'next/link'
import { Panel } from '@/components/administracion/kit/panel'
import { Button } from '@/components/ui/button'
import { PanelLink } from './block-states'
import type { HomeData } from './home-data'
import { lastClosedLine, monthWord, openMonthLine } from './summary-copy'

/**
 * «Estado de los libros», arriba de todo para la contadora: hasta qué mes está
 * cerrado, cómo viene el abierto y el paquete del último mes cerrado para
 * bajar. Descargar no es cargar: es lo único con botón que ve quien solo lee.
 */
export async function BooksBlock({ data }: { data: HomeData }) {
  const summaryResult = await data.summary
  // Sin resumen, el héroe ya dice el error y ofrece reintentar.
  if (!summaryResult.ok) return null

  const { books } = summaryResult.data
  const openMonthText = openMonthLine(books)
  const packageMonth = books.lastClosedMonth?.slice(0, 7) ?? null

  return (
    <Panel
      title="Estado de los libros"
      action={<PanelLink href={`${data.base}/libros`}>Ver los libros</PanelLink>}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1 text-sm">
          <p className="text-pretty">{lastClosedLine(books)}</p>
          {openMonthText ? (
            <p className="text-muted-foreground text-pretty">{openMonthText}</p>
          ) : null}
        </div>
        {packageMonth && books.lastClosedMonth ? (
          <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
            <Link href={`${data.base}/libros?mes=${packageMonth}#paquete-del-mes`}>
              <Download className="size-4" aria-hidden />
              Descargar el paquete de {monthWord(books.lastClosedMonth).toLowerCase()}
            </Link>
          </Button>
        ) : null}
      </div>
    </Panel>
  )
}
