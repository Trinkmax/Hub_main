import { type ReactNode, Suspense } from 'react'
import { PeriodError } from '@/components/administracion/cajas-ventas/block-error'
import { requireAdminPage } from '@/components/administracion/cajas-ventas/page-access'
import { MonthStepper } from '@/components/administracion/cajas-ventas/period-filters'
import {
  firstParam,
  type PageSearchParams,
  resolveMonth,
} from '@/components/administracion/cajas-ventas/periods'
import { PlanillaBar, SimplePage } from '@/components/administracion/planilla'
import { projectionUsesPos } from '@/lib/accounting/access'
import { monthOf, serviceDayInCordoba, todayInCordoba } from '@/lib/dates'
import { CollectionsView } from './_components/collections-view'
import { InvoicesView } from './_components/invoices-view'
import { loadMonth, MonthBody } from './_components/month-view'
import { NetView } from './_components/net-view'
import { ReceivablesView } from './_components/receivables-view'
import {
  CollectionsSkeleton,
  InvoicesSkeleton,
  MonthSkeleton,
  NetSkeleton,
  ReceivablesSkeleton,
} from './_components/skeletons'
import { parseDetail, parseTab, tabHref, VIEW_TITLES, ventasView } from './_lib/ventas-view'

export const metadata = { title: 'Ventas' }

/**
 * Ventas: la planilla del mes, «Por cobrar» y «Lo que llegó» (las solapas las dibuja `AdmNav`), y
 * «Facturas» y «Cobros», a las que se llega desde el «⋯» de la planilla.
 *
 * Los siete `?tab=` de siempre siguen valiendo tal cual (los citan el Resumen, la guía, Libros, los
 * comprobantes y ⌘K): `ventasView` dice a qué vista lleva cada uno. No se renombra ni se redirige
 * nada.
 *
 * Cada vista pide lo suyo y va en su `Suspense`, con un esqueleto de su forma.
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
  const shared = { tenantId, tenantSlug, base, today, sp, canWrite }

  let body: ReactNode
  if (view === 'mes') {
    const month = resolveMonth(sp, today)
    if (!month.ok) {
      body = (
        <>
          <PlanillaBar>
            <MonthStepper month={monthOf(today)} today={today} />
          </PlanillaBar>
          <PeriodError message={month.message} />
        </>
      )
    } else {
      const serviceDay = serviceDayInCordoba()
      const range = { month: month.month, from: month.from, to: month.to }
      const data = loadMonth({
        tenantId,
        range,
        serviceDay,
        canWrite,
        // La contadora no lee el calendario del bar (está aislada de todo lo que no es
        // Administración): para ella la planilla va sin los eventos.
        canReadCalendar: access.role !== 'accountant',
        pos: projectionUsesPos(access),
      })
      body = (
        <Suspense fallback={<MonthSkeleton />}>
          <MonthBody
            data={data}
            tenantId={tenantId}
            tenantSlug={tenantSlug}
            base={base}
            today={today}
            serviceDay={serviceDay}
            range={range}
            monthParam={firstParam(sp.mes)}
            requestedDay={firstParam(sp.dia)}
            focus={focus}
            initialDetail={parseDetail(firstParam(sp.detalle), focus)}
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
  } else if (view === 'llego') {
    body = (
      <Suspense fallback={<NetSkeleton />}>
        <NetView {...shared} />
      </Suspense>
    )
  } else if (view === 'cobros') {
    body = (
      <Suspense fallback={<CollectionsSkeleton />}>
        <CollectionsView {...shared} />
      </Suspense>
    )
  } else {
    body = (
      <Suspense fallback={<InvoicesSkeleton />}>
        <InvoicesView {...shared} />
      </Suspense>
    )
  }

  return (
    <SimplePage>
      <h1 className="sr-only">{VIEW_TITLES[view]}</h1>
      {body}
    </SimplePage>
  )
}
