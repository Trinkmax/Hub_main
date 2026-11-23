import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { ACTION_PARAM, ACTION_PARAM_KEYS } from '@/components/administracion/acciones/types'
import { SimplePage } from '@/components/administracion/planilla'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  accountingAllows,
  isPurchasesOnly,
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
 * La hoja que traía el link (`?accion=pagar&proveedor=…`, lo que arma ⌘K desde otra sección), para no
 * perderla al mandar a Compras a quien no tiene Resumen. Solo esos parámetros: nada más viaja.
 */
function actionQuery(sp: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams()
  for (const key of [ACTION_PARAM, ...ACTION_PARAM_KEYS]) {
    const raw = sp[key]
    const value = Array.isArray(raw) ? raw[0] : raw
    if (value) query.set(key, value)
  }
  const text = query.toString()
  return text ? `?${text}` : ''
}

/**
 * Resumen de Administración: cuánta plata hay, lo que se debe, lo que se vendió y qué hay que hacer
 * hoy. Nada más: «a veces menos es más» (reunión del 29/10/2026).
 *
 * La página pide todas las lecturas juntas y no espera ninguna (`loadHome`): cada bloque va en su
 * `Suspense`, con un esqueleto de su forma. Así la fecha sale al instante y lo que falla lo dice ahí.
 *
 * La contadora no ve este Resumen: entra directo a donde trabaja, Sumas y saldos. Quien tiene el nivel
 * «solo compras y pagos» tampoco: va a Compras (con la hoja que traía el link, si era de compras).
 */
export default async function AdministracionResumenPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const base = `/${tenantSlug}/administracion`

  let access: TenantAccess
  try {
    // La puerta más abierta de la sección, para poder mandar a cada uno a lo suyo; el Resumen en sí
    // pide el nivel completo, más abajo.
    access = await requireAccountingAccess(tenantSlug, 'buy_read')
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

  if (isPurchasesOnly(access.accounting)) {
    redirect(`${base}/compras${actionQuery(await searchParams)}`)
  }
  if (!accountingAllows(access.accounting, 'read')) notFound()
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
