import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
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
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={
          <Link
            href={`/${tenantSlug}/eventos/programados`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Volver al calendario
          </Link>
        }
        title="Programar evento"
        description="Sushi Libre el sábado 27, Pizza Libre el lunes 9, etc. Cada instancia tiene su cupo."
      />
      <ScheduledEventForm
        tenantSlug={tenantSlug}
        mode="create"
        templates={templates}
        presetDate={presetDate}
      />
    </div>
  )
}
