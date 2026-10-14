import { Banknote, CalendarDays, HandCoins, type LucideIcon, ReceiptText } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  hrefWith,
  type PageSearchParams,
  periodParams,
  type RangeValue,
  resolveRange,
} from '@/components/administracion/cajas-ventas/periods'
import { type ViewPillItem, ViewPills } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import { monthName, monthOf } from '@/lib/dates'
import {
  type VentasTab,
  type VentasViewKey,
  VIEW_COPY,
  VIEW_ORDER,
  viewHref,
} from '../_lib/ventas-view'

const VIEW_ICONS: Readonly<Record<VentasViewKey, LucideIcon>> = {
  mes: CalendarDays,
  cobrar: HandCoins,
  llego: Banknote,
  facturas: ReceiptText,
}

/**
 * La fila de vistas de Ventas: «El mes · Plata por cobrar · Lo que llegó ·
 * Facturas», con la elegida rellena en tinta (el verde queda para la barra de
 * la sección). A la derecha va el período de la vista (`aside`), que baja solo
 * a su renglón cuando no entra.
 *
 * Los links son los `?tab=` de siempre, y conservan el `?mes=` elegido entre
 * las vistas que miran un mes.
 */
export function VentasViews({
  base,
  view,
  month,
  aside,
}: {
  /** `/<bar>/administracion`. */
  base: string
  view: VentasViewKey
  /** El `?mes=` de la URL, si hay. */
  month: string | null
  aside?: ReactNode
}) {
  const items: ViewPillItem[] = VIEW_ORDER.map((key) => ({
    key,
    label: VIEW_COPY[key].label,
    shortLabel: VIEW_COPY[key].shortLabel,
    href: viewHref(base, key, month),
    icon: VIEW_ICONS[key],
    active: key === view,
  }))
  return <ViewPills label="Vistas de Ventas" items={items} aside={aside} />
}

/** El período de una vista con rango: el de la URL o, si está roto, el mes en curso para elegir de nuevo. */
export function rangeOrError(sp: PageSearchParams, today: string) {
  const range = resolveRange(sp, today)
  const picker: RangeValue = range.ok
    ? range
    : { kind: 'month', month: monthOf(today), from: today, to: today, label: '' }
  return { range, picker }
}

/** El período dicho de corrido: «en octubre» / «en ese período», «de octubre» / «del 01/10 – 15/10/2026». */
export function periodWords(range: RangeValue): { in: string; of: string } {
  if (range.kind === 'month' && range.month) {
    const name = monthName(Number(range.month.slice(5, 7)))
    return { in: `en ${name}`, of: `de ${name}` }
  }
  return { in: 'en ese período', of: `del ${range.label}` }
}

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
    <div className="flex flex-wrap items-center justify-between gap-3">
      {!isFirst ? (
        <Button asChild variant="outline" size="sm" className="h-11 md:pointer-fine:h-9">
          <Link href={hrefWith(path, { tab, ...periodParams(range) })}>Volver al principio</Link>
        </Button>
      ) : (
        <span />
      )}
      {nextCursor ? (
        <Button asChild variant="outline" size="sm" className="h-11 md:pointer-fine:h-9">
          <Link href={hrefWith(path, { tab, ...periodParams(range), despues: nextCursor })}>
            Ver los siguientes
          </Link>
        </Button>
      ) : null}
    </div>
  )
}
