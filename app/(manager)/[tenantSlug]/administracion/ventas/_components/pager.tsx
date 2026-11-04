import Link from 'next/link'
import {
  hrefWith,
  periodParams,
  type RangeValue,
} from '@/components/administracion/cajas-ventas/periods'
import { Button } from '@/components/ui/button'
import type { VentasTab } from '../_lib/ventas-view'

/** «Ver los siguientes» / «Volver al principio» de una lista con cursor (`?despues=`). */
export function Pager({
  base,
  tab,
  range,
  nextCursor,
  isFirst,
}: {
  base: string
  tab: VentasTab
  range: RangeValue
  nextCursor: string | null
  isFirst: boolean
}) {
  if (!nextCursor && isFirst) return null
  const path = `${base}/ventas`
  return (
    <>
      {!isFirst ? (
        <Button asChild variant="outline" size="sm" className="pointer-coarse:h-10">
          <Link href={hrefWith(path, { tab, ...periodParams(range) })}>Volver al principio</Link>
        </Button>
      ) : null}
      {nextCursor ? (
        <Button asChild variant="outline" size="sm" className="pointer-coarse:h-10">
          <Link href={hrefWith(path, { tab, ...periodParams(range), despues: nextCursor })}>
            Ver los siguientes
          </Link>
        </Button>
      ) : null}
    </>
  )
}
