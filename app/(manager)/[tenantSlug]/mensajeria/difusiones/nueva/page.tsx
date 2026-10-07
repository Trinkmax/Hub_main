import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { addDays, todayInCordoba } from '@/lib/dates'
import { visibleTemplates } from '@/lib/meta/template-visibility'
import { listScheduledEventsForDateRange } from '@/lib/salon/queries'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { BroadcastForm } from '../_components/broadcast-form'

export const metadata = { title: 'Nueva difusión' }
export const dynamic = 'force-dynamic'

export default async function NuevaDifusionPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const prefillName = typeof sp.prefillName === 'string' ? sp.prefillName.slice(0, 80) : ''
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const supabase = await createClient()
  // Próximos 90 días del calendario del bar (hora de Córdoba).
  const fromYmd = todayInCordoba()
  const toYmd = addDays(fromYmd, 90)
  const [channelsRes, templatesRes, audiencesRes, scheduled] = await Promise.all([
    supabase
      .from('channels')
      .select('id, type, display_name, status')
      .eq('tenant_id', access.tenant.id)
      .eq('status', 'connected'),
    supabase
      .from('message_templates')
      .select('id, name, language, channel_id, status, components, variable_hints')
      .eq('tenant_id', access.tenant.id)
      .eq('status', 'approved')
      .order('name'),
    supabase
      .from('audiences')
      .select('id, name, customer_count_cached')
      .eq('tenant_id', access.tenant.id)
      .order('updated_at', { ascending: false }),
    listScheduledEventsForDateRange({ tenantId: access.tenant.id, from: fromYmd, to: toYmd }),
  ])

  // Próximos eventos del calendario para el dropdown "anunciar un evento".
  const events = scheduled.map((e) => ({
    id: e.id,
    name: e.name_override ?? e.template?.name ?? 'Evento',
    date: e.event_date,
    time: e.starts_at_local.slice(0, 5),
  }))

  return (
    <PageShell width="compact">
      <PageHeader
        back={{ href: `/${tenantSlug}/mensajeria/difusiones`, label: 'Difusiones' }}
        title="Nueva difusión"
        description="Elegís el mensaje, a quién se lo mandás y cuándo. Antes de que salga, ves un resumen para confirmar."
      />
      <BroadcastForm
        tenantSlug={tenantSlug}
        channels={channelsRes.data ?? []}
        templates={visibleTemplates(templatesRes.data ?? [])}
        audiences={audiencesRes.data ?? []}
        events={events}
        initialName={prefillName}
      />
    </PageShell>
  )
}
