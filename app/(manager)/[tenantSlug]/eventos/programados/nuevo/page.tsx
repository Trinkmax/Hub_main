import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { FormTemplate } from '@/components/ui/page-templates'
import { listScheduledTemplates } from '@/lib/salon/queries'
import {
  RESERVATION_STAFF_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { ScheduledEventForm } from '../_components/scheduled-event-form'

export const metadata = { title: 'Programar evento' }
export const dynamic = 'force-dynamic'

export default async function NuevoEventoProgramadoPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const presetDate = typeof sp.date === 'string' ? sp.date : undefined
  // Desde el celular no se puede arrastrar un formato al calendario, así que el
  // chip del rail linkea acá con el formato ya elegido.
  const presetTemplateId = typeof sp.template === 'string' ? sp.template : undefined

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, RESERVATION_STAFF_ROLES)
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const templates = await listScheduledTemplates({
    tenantId: access.tenant.id,
    onlyActive: true,
  })

  return (
    <FormTemplate
      header={
        <PageHeader
          back={{ href: `/${tenantSlug}/eventos/programados`, label: 'Calendario' }}
          title="Programar evento"
          description="Sushi Libre el sábado 27, Pizza Libre el lunes 9… Cada fecha tiene su propio cupo."
        />
      }
    >
      <ScheduledEventForm
        tenantSlug={tenantSlug}
        mode="create"
        templates={templates}
        presetDate={presetDate}
        presetTemplateId={presetTemplateId}
      />
    </FormTemplate>
  )
}
