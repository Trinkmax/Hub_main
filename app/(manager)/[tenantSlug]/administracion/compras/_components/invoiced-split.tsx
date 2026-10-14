import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { INVOICED_SWATCH, NOT_INVOICED_SWATCH } from '@/components/administracion/charts/palette'
import { SplitBar } from '@/components/administracion/charts/split-bar'
import { Explain, LegendPill, Panel, PillLink } from '@/components/administracion/kit'
import { Skeleton } from '@/components/ui/skeleton'
import { invoicedSplit } from '@/lib/accounting/home'
import type { InvoiceFilter } from '@/lib/accounting/invoiced'
import { getMonthSpending, settleQuery } from '@/lib/accounting/queries'
import { daysBetween } from '@/lib/dates'
import { formatCentsShort, NBSP } from '@/lib/money'
import { administracionHref } from '../_lib/links'

/** Hasta cuántos días se pide el total: más que eso cuesta demasiados viajes a la base. */
export const SPLIT_MAX_DAYS = 92

const TITLE = 'Con factura y sin factura'
const PILL_SIZE = 'h-11 md:pointer-fine:h-9'

type Amounts = {
  invoiced: string
  notInvoiced: string
  invoicedShare: string
  notInvoicedShare: string
}

/**
 * Las tres píldoras «Todo · Con factura · Sin factura»: son el FILTRO de la
 * lista (`?factura=`) y, cuando hay total, también la leyenda de la barra. Van
 * siempre, con o sin importes: la guía manda a filtrar «Con factura» acá.
 *
 * El porcentaje va escrito al lado del importe («$ 1.094.700 · 95 %»), no en
 * una pastilla adentro de la píldora: una pastilla dentro de otra es ruido.
 */
function InvoicePills({
  invoice,
  hrefFor,
  amounts,
}: {
  invoice: InvoiceFilter
  hrefFor: (invoice: InvoiceFilter) => string
  amounts: Amounts | null
}) {
  return (
    <nav aria-label="Con factura o sin factura">
      <ul className="flex flex-wrap items-center gap-1.5">
        <li>
          <PillLink
            href={hrefFor('todos')}
            scroll={false}
            active={invoice === 'todos'}
            className={PILL_SIZE}
          >
            Todo
          </PillLink>
        </li>
        <li className="max-w-full">
          <LegendPill
            swatchClassName={INVOICED_SWATCH}
            label="Con factura"
            value={amounts ? `${amounts.invoiced} · ${amounts.invoicedShare}` : ''}
            href={hrefFor(invoice === 'con' ? 'todos' : 'con')}
            active={invoice === 'con'}
            className={`max-w-full ${PILL_SIZE}`}
          />
        </li>
        <li className="max-w-full">
          <LegendPill
            swatchClassName={NOT_INVOICED_SWATCH}
            label="Sin factura"
            value={amounts ? `${amounts.notInvoiced} · ${amounts.notInvoicedShare}` : ''}
            href={hrefFor(invoice === 'sin' ? 'todos' : 'sin')}
            active={invoice === 'sin'}
            className={`max-w-full ${PILL_SIZE}`}
          />
        </li>
      </ul>
    </nav>
  )
}

/** Mientras llega el total: el mismo bloque, con el filtro ya usable. */
export function InvoicedSplitFallback({
  invoice,
  hrefFor,
}: {
  invoice: InvoiceFilter
  hrefFor: (invoice: InvoiceFilter) => string
}) {
  return (
    <Panel title={TITLE}>
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-3 w-full rounded-full" />
        <InvoicePills invoice={invoice} hrefFor={hrefFor} amounts={null} />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
    </Panel>
  )
}

/**
 * B1 · «Con factura y sin factura» de Comprobantes: cuánta plata fue con
 * factura y cuánta sin, en el período elegido. Es EL MISMO número de la barra
 * del Resumen (`getMonthSpending` + `invoicedSplit`), y su leyenda es el filtro
 * de la lista: antes había un filtro, no un número.
 *
 * Un solo libro: ninguno de los dos colores es alarma y las dos partes quedan
 * registradas igual; lo único que cambia es que lo sin factura no entra al
 * Libro IVA.
 *
 * El filtro nunca desaparece: si el total no se puede dibujar (período largo,
 * nada cargado, falló la lectura) quedan las tres píldoras sin importes.
 */
export async function InvoicedSplitPanel({
  tenantId,
  tenantSlug,
  from,
  to,
  lead,
  invoice,
  narrowed,
  hrefFor,
}: {
  tenantId: string
  tenantSlug: string
  from: string
  to: string
  /** El período como arranque de la oración: «En octubre». */
  lead: string
  invoice: InvoiceFilter
  /** Hay búsqueda o estado elegidos: el total es de todo el período, no de lo filtrado. */
  narrowed: boolean
  hrefFor: (invoice: InvoiceFilter) => string
}) {
  const guide = (
    <Link
      href={`${administracionHref(tenantSlug)}/guias/con-y-sin-factura`}
      className="inline-flex min-h-11 items-center gap-1 rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
    >
      ¿Qué cambia con cada papel?
      <ArrowRight aria-hidden className="size-3" />
    </Link>
  )

  const quiet = (message: string) => (
    <Panel title={TITLE}>
      <div className="space-y-3">
        <InvoicePills invoice={invoice} hrefFor={hrefFor} amounts={null} />
        <p className="text-sm text-muted-foreground text-pretty">{message}</p>
        {guide}
      </div>
    </Panel>
  )

  if (daysBetween(from, to) + 1 > SPLIT_MAX_DAYS) {
    return quiet(
      'Elegí un mes o los últimos 90 días para ver cuánta plata fue con factura y cuánta sin.',
    )
  }

  const outcome = await settleQuery(getMonthSpending(tenantId, { from, to }))
  if (!outcome.ok) {
    return quiet('No pudimos sumar el período. El filtro anda igual; probá de nuevo en un rato.')
  }
  const spending = outcome.data
  if (spending.truncated) {
    return quiet('Son muchos comprobantes: achicá el período para ver el total.')
  }
  const split = invoicedSplit(spending.vouchers)
  if (split.isEmpty) {
    // Que no hay nada ya lo dice la lista de abajo, con su botón: acá, solo para qué sirve.
    return quiet('Cuando cargues compras o gastos, acá ves cuánto fue con factura y cuánto sin.')
  }

  const invoicedShare = Math.round(split.invoicedPercent)
  const amounts: Amounts = {
    invoiced: formatCentsShort(split.invoicedCents),
    notInvoiced: formatCentsShort(split.notInvoicedCents),
    invoicedShare: `${invoicedShare}${NBSP}%`,
    notInvoicedShare: `${100 - invoicedShare}${NBSP}%`,
  }

  return (
    <Panel
      title={
        <>
          {lead} compraste y gastaste{' '}
          <span className="whitespace-nowrap tabular-nums">
            {formatCentsShort(split.totalCents)}
          </span>
        </>
      }
    >
      <div className="space-y-4">
        <SplitBar
          showLegend={false}
          ariaLabel={`Con factura ${amounts.invoiced} (${amounts.invoicedShare}) y sin factura ${amounts.notInvoiced} (${amounts.notInvoicedShare})`}
          segments={[
            {
              key: 'con',
              label: 'Con factura',
              cents: split.invoicedCents,
              swatch: INVOICED_SWATCH,
            },
            {
              key: 'sin',
              label: 'Sin factura',
              cents: split.notInvoicedCents,
              swatch: NOT_INVOICED_SWATCH,
            },
          ]}
        />
        <InvoicePills invoice={invoice} hrefFor={hrefFor} amounts={amounts} />
        <div className="space-y-1.5 text-sm text-muted-foreground">
          <p className="text-pretty">
            {split.sentence} Con factura o sin factura, todo queda registrado en los libros.
          </p>
          {split.otherNote ? <p className="text-pretty">{split.otherNote}</p> : null}
          {narrowed ? (
            <p className="text-xs text-pretty">Es de todo el período, no solo de lo filtrado.</p>
          ) : null}
        </div>
        <div className="space-y-1">
          <Explain
            label="¿Qué cuenta?"
            note="Por eso puede no coincidir peso por peso con la lista de abajo."
          >
            <p className="text-sm text-muted-foreground text-pretty">
              Compras, gastos y notas de débito, menos las notas de crédito, con IVA. Suma también
              los gastos del banco que tienen comprobante (esos se ven en Cajas) y no cuenta lo
              anulado ni la factura mensual de comisiones de las tarjetas.
            </p>
          </Explain>
          {guide}
        </div>
      </div>
    </Panel>
  )
}
