import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { PanelError } from '@/components/administracion/kit/panel-states'
import { requireFeature } from '@/lib/platform/guards'
import { POS_SETUP_ROLES } from '@/lib/pos/branches/authorize'
import { serviceDayAt } from '@/lib/pos/cash/screen'
import { getToday } from '@/lib/pos/today/queries'
import { isDay } from '@/lib/pos/today/summary'
import type { TodayData } from '@/lib/pos/today/types'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { TodayBoard } from './_components/today-board'

export const metadata: Metadata = { title: 'Hoy en vivo' }

/**
 * «Hoy en vivo» (docs/features/pos.md): cómo va el día en el salón, para los dueños. Sale todo de lo
 * que el salón ya cargó. `?dia=AAAA-MM-DD` mira un día anterior; `?sucursal=<slug>`, una sola.
 *
 * El día es el de servicio: hasta las 5 de la mañana sigue siendo la noche anterior.
 */
export default async function HoyPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ dia?: string | string[]; sucursal?: string | string[] }>
}) {
  const [{ tenantSlug }, query] = await Promise.all([params, searchParams])

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, POS_SETUP_ROLES)
  } catch (error) {
    if (error instanceof TenantNotFoundError || error instanceof RoleRequiredError) notFound()
    throw error
  }
  await requireFeature(access.tenant, 'pos')

  const timeZone = access.tenant.timezone || 'America/Argentina/Cordoba'
  const today =
    serviceDayAt(new Date().toISOString(), timeZone) ?? new Date().toISOString().slice(0, 10)
  // Un día de más adelante no existe todavía: se muestra hoy.
  const day = isDay(query.dia) && query.dia <= today ? query.dia : today

  let data: TodayData
  try {
    data = await getToday(access.tenant.id, day, day === today)
  } catch {
    // La lectura ya dejó el detalle en el log del servidor. La pantalla conserva su lugar.
    return (
      <AdmPage width="comfortable">
        <AdmHeader title="Hoy en vivo" />
        <PanelError
          title="No pudimos leer cómo va el día"
          message="Los cobros están a salvo: es solo esta pantalla la que no cargó. Reintentá en un momento."
        />
      </AdmPage>
    )
  }

  return (
    <TodayBoard
      tenantSlug={tenantSlug}
      data={data}
      branchSlug={typeof query.sucursal === 'string' ? query.sucursal : null}
      today={today}
      timeZone={timeZone}
    />
  )
}
