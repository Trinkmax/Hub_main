import { type ReactNode, Suspense } from 'react'
import { PeriodError } from '@/components/administracion/cajas-ventas/block-error'
import { requireAdminPage } from '@/components/administracion/cajas-ventas/page-access'
import { MonthStepper, RangeFilter } from '@/components/administracion/cajas-ventas/period-filters'
import {
  firstParam,
  type PageSearchParams,
  resolveMonth,
} from '@/components/administracion/cajas-ventas/periods'
import { AdmHeader, AdmPage } from '@/components/administracion/kit'
import { QuickActionsBar } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { monthOf, serviceDayInCordoba, todayInCordoba } from '@/lib/dates'
import { InvoicesView } from './_components/invoices-view'
import { loadMonth, MonthAsideSlot, MonthBody } from './_components/month-view'
import { NetView } from './_components/net-view'
import { ReceivablesView } from './_components/receivables-view'
import {
  InvoicesSkeleton,
  MonthSkeleton,
  NetSkeleton,
  ReceivablesSkeleton,
} from './_components/skeletons'
import { rangeOrError, VentasViews } from './_components/ventas-views'
import { parseTab, tabHref, VIEW_COPY, ventasView } from './_lib/ventas-view'

export const metadata = { title: 'Ventas' }

/**
 * Ventas: «el almanaque del mes». Cuatro vistas en una sola página servidor:
 * «El mes» (el almanaque, con «Proyección» y «Ventas contra caja» como
 * bloques), «Plata por cobrar», «Lo que llegó» y «Facturas».
 *
 * Los siete `?tab=` de siempre siguen valiendo tal cual (los citan el Resumen,
 * la guía, Libros, los comprobantes y ⌘K): `ventasView` dice a qué vista lleva
 * cada uno y qué bloque trae a la vista. No se renombra ni se redirige nada.
 *
 * El encabezado y la fila de vistas salen al instante; cada vista pide lo suyo
 * y va en su `Suspense`, con un esqueleto de su forma. La acción de cada vista
 * va al lado de su dato (no hay botones en el encabezado): «＋ Cargar» ya está
 * en la barra de la sección y en el flotante del celular.
 */
export default async function VentasPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<PageSearchParams>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const tab = parseTab(firstParam(sp.tab))
  const { access, canWrite } = await requireAdminPage(tenantSlug, tabHref(base, tab))
  const tenantId = access.tenant.id
  const today = todayInCordoba()
  const { view, focus } = ventasView(tab)
  // El `?mes=` de la URL se conserva entre las vistas que miran un mes.
  const monthParam = firstParam(sp.mes)
  const shared = { tenantId, tenantSlug, base, today, sp, canWrite }

  let aside: ReactNode = null
  let body: ReactNode

  if (view === 'mes') {
    const month = resolveMonth(sp, today)
    if (!month.ok) {
      aside = <MonthStepper month={monthOf(today)} today={today} />
      body = <PeriodError message={month.message} />
    } else {
      const serviceDay = serviceDayInCordoba()
      const range = { month: month.month, from: month.from, to: month.to }
      const data = loadMonth({
        tenantId,
        range,
        serviceDay,
        isCurrentMonth: month.month === monthOf(serviceDay),
        canWrite,
        // La contadora no lee el calendario del bar (está aislada de todo lo que no es
        // Administración): para ella el almanaque va sin los eventos.
        canReadCalendar: access.role !== 'accountant',
      })
      aside = <MonthAsideSlot calendar={data.calendar} month={month.month} today={today} />
      body = (
        <Suspense fallback={<MonthSkeleton />}>
          <MonthBody
            data={data}
            tenantId={tenantId}
            tenantSlug={tenantSlug}
            base={base}
            today={today}
            range={range}
            monthParam={monthParam}
            requestedDay={firstParam(sp.dia)}
            focus={focus}
            canWrite={canWrite}
          />
        </Suspense>
      )
    }
  } else if (view === 'cobrar') {
    body = (
      <Suspense fallback={<ReceivablesSkeleton />}>
        <ReceivablesView {...shared} />
      </Suspense>
    )
  } else {
    const { picker } = rangeOrError(sp, today)
    aside = <RangeFilter range={picker} today={today} />
    body =
      view === 'llego' ? (
        <Suspense fallback={<NetSkeleton />}>
          <NetView {...shared} focus={focus} />
        </Suspense>
      ) : (
        <Suspense fallback={<InvoicesSkeleton />}>
          <InvoicesView {...shared} />
        </Suspense>
      )
  }

  return (
    <AdmPage>
      <AdmHeader
        title="Ventas"
        badge={<ReadOnlyBadge />}
        description={VIEW_COPY[view].description}
      />
      <VentasViews base={base} view={view} month={monthParam} aside={aside} />
      {body}
      <QuickActionsBar />
    </AdmPage>
  )
}
