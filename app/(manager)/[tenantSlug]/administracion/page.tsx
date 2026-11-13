import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { SimplePage } from '@/components/administracion/planilla'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  projectionUsesPos,
  requireAccountingAccess,
} from '@/lib/accounting/access'
import { serviceDayInCordoba, todayInCordoba } from '@/lib/dates'
import {
  RoleRequiredError,
  type TenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { HeroBlock } from './_resumen/hero-block'
import { loadHome } from './_resumen/home-data'
import { ParaHoyBlock } from './_resumen/para-hoy-block'
import { HeroSkeleton, ParaHoySkeleton } from './_resumen/skeletons'
import { headerDateLine } from './_resumen/summary-copy'

/**
 * Resumen de Administración: cuánta plata hay, lo que se debe, lo que se vendió y qué hay que hacer
 * hoy. Nada más: «a veces menos es más» (reunión del 29/10/2026).
 *
 * La página pide todas las lecturas juntas y no espera ninguna (`loadHome`): cada bloque va en su
 * `Suspense`, con un esqueleto de su forma. Así la fecha sale al instante y lo que falla lo dice ahí.
 *
 * La contadora no ve este Resumen: entra directo a donde trabaja, Sumas y saldos.
 */
export default async function AdministracionResumenPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const base = `/${tenantSlug}/administracion`

  let access: TenantAccess
  try {
    access = await requireAccountingAccess(tenantSlug, 'read')
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=session&redirectTo=${encodeURIComponent(base)}`)
    }
    if (
      error instanceof AccountingDisabledError ||
      error instanceof AccountingForbiddenError ||
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError
    ) {
      notFound()
    }
    throw error
  }

  if (access.role === 'accountant') redirect(`${base}/libros/sumas-y-saldos`)

  const today = todayInCordoba()
  const data = loadHome({
    tenantId: access.tenant.id,
    tenantSlug,
    today,
    serviceDay: serviceDayInCordoba(),
    canWrite: access.accounting.write,
    pos: projectionUsesPos(access),
  })

  return (
    <SimplePage>
      <h1 className="font-serif text-2xl font-semibold tracking-tight">
        <span className="sr-only">Resumen: </span>
        {headerDateLine(today) || 'Hoy'}
      </h1>
      <Suspense fallback={<HeroSkeleton />}>
        <HeroBlock data={data} />
      </Suspense>
      <Suspense fallback={<ParaHoySkeleton />}>
        <ParaHoyBlock data={data} />
      </Suspense>
    </SimplePage>
  )
}
